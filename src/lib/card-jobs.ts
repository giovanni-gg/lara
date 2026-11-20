import { prisma } from "./db";
import { generateCards } from "./ai/cards";
import { MissingAiCredentialsError } from "./ai/model";
import { loadDeckContext } from "./deck-context";
import { newCardState } from "./srs";
import { trySynthesize, ttsAvailable } from "./tts";
import { cardTypesFor } from "./card-direction";
import { generateCardImage, imagesAvailable } from "./images";
import {
  CARD_JOB_STALE_AFTER_MS,
  cardJobLimitReached,
  IN_PROGRESS_STATUSES,
  MAX_CARD_JOBS_IN_PROGRESS,
  STALE_ERROR,
  toCardJobView,
  type CardJobView,
} from "./card-job-status";
import { CardJobStatus, CardType, type CardDirection, type CefrLevel } from "@/generated/prisma/enums";

/**
 * "Generate with AI" is a server-side job, so leaving the page can't lose it
 * (the same shape as stories, src/lib/stories.ts):
 *
 *   queueCardJob — checks the request and records a QUEUED job. Fast; no AI.
 *   runCardJob   — the model call, the cards with their audio, then the
 *                  pictures, moving the job through WRITING → AUDIO →
 *                  PICTURES → DONE (or FAILED). Never throws.
 *
 * The route runs the second in `after()`; the status pill polls the job.
 */

/** Bad input the caller should see as a 4xx. */
export class CardJobInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 429 = 400,
  ) {
    super(message);
    this.name = "CardJobInputError";
  }
}

export type CardJobInput = {
  userId: string;
  profile: {
    id: string;
    targetLanguage: string;
    sourceLanguage: string;
    level: CefrLevel;
    voiceId: string | null;
  };
  /** Required for a new deck; adding to a deck it only refines, and may be empty. */
  prompt: string;
  count: number;
  /** Add to this deck instead of making a new one. */
  deckId?: string;
  /** Which side faces first; defaults to the deck's own setting. */
  direction?: CardDirection;
  withAudio: boolean;
};

/** The learner's most recent other cards, so the model doesn't repeat them. */
const OTHER_CARDS_LIMIT = 300;
/** Pictures drawn at once: Gemini takes several seconds per image. */
const IMAGE_CONCURRENCY = 3;
/** The most pictures one job draws (the form offers up to 40 cards). */
const MAX_IMAGES = 40;
/**
 * No new picture starts after this point in the request. One image, retries
 * included, takes at most ~100 s, so the last ones still land before 300 s.
 */
const IMAGE_START_DEADLINE_MS = 180_000;
/** Keeps a model error readable in the pill. */
const MAX_ERROR_LENGTH = 160;

export const CARD_JOB_FIELDS = {
  id: true,
  status: true,
  createdAt: true,
  deckId: true,
  deckName: true,
  prompt: true,
  count: true,
  direction: true,
  done: true,
  total: true,
  created: true,
  error: true,
} as const;

/** Records a job for the request and returns it. Throws CardJobInputError for bad input. */
export async function queueCardJob(input: CardJobInput, now: Date = new Date()): Promise<CardJobView> {
  const { userId, profile, deckId } = input;
  const deck = deckId
    ? await prisma.deck.findFirst({
        where: { id: deckId, userId, profileId: profile.id },
        select: { id: true, name: true },
      })
    : null;
  if (deckId && !deck) throw new CardJobInputError("Deck not found", 404);

  // A job the server lost never finishes on its own: close it, so it neither
  // spins in the pill nor holds a slot.
  await prisma.cardJob.updateMany({
    where: {
      userId,
      status: { in: [...IN_PROGRESS_STATUSES] },
      createdAt: { lte: new Date(now.getTime() - CARD_JOB_STALE_AFTER_MS) },
    },
    data: { status: CardJobStatus.FAILED, error: STALE_ERROR },
  });

  const running = await prisma.cardJob.findMany({
    where: { userId, status: { in: [...IN_PROGRESS_STATUSES] } },
    select: { status: true, createdAt: true },
  });
  if (cardJobLimitReached(running, now)) {
    throw new CardJobInputError(
      `${MAX_CARD_JOBS_IN_PROGRESS} batches of cards are already being made — wait for one to finish.`,
      429,
    );
  }

  const job = await prisma.cardJob.create({
    data: {
      userId,
      profileId: profile.id,
      deckId: deck?.id ?? null,
      deckName: deck?.name ?? null,
      prompt: input.prompt,
      count: input.count,
      direction: input.direction ?? null,
      total: input.count,
    },
    select: CARD_JOB_FIELDS,
  });
  return toCardJobView(job, now);
}

/**
 * Makes the cards for a queued job. Never throws: a failure marks the job
 * FAILED with a short reason. `started` is when the request began, which the
 * picture deadline counts from (all of this shares the route's 300 s).
 */
export async function runCardJob(
  jobId: string,
  input: CardJobInput,
  { started = Date.now() }: { started?: number } = {},
): Promise<boolean> {
  try {
    await makeCards(jobId, input, started);
    return true;
  } catch (error) {
    console.error(`[card-jobs] ${jobId} failed:`, error);
    await prisma.cardJob
      .update({ where: { id: jobId }, data: { status: CardJobStatus.FAILED, error: reasonFor(error) } })
      .catch(() => {});
    return false;
  }
}

function reasonFor(error: unknown): string {
  if (error instanceof MissingAiCredentialsError) return "AI isn't configured on the server";
  const message = error instanceof Error && error.message ? error.message : "Couldn't make the cards";
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

async function makeCards(jobId: string, input: CardJobInput, started: number) {
  const { userId, profile, prompt, count, deckId, withAudio, direction: requested } = input;
  const setJob = (data: Parameters<typeof prisma.cardJob.update>[0]["data"]) =>
    prisma.cardJob.update({ where: { id: jobId }, data });

  await setJob({ status: CardJobStatus.WRITING });

  // Adding to a deck: load it first, so the model sees what the deck is and
  // what it already holds. Queries run one after another (see AGENTS.md).
  const existingDeck = deckId
    ? await prisma.deck.findFirst({ where: { id: deckId, userId, profileId: profile.id } })
    : null;
  if (deckId && !existingDeck) throw new Error("The deck was deleted");

  const deckContext = existingDeck ? await loadDeckContext(profile.id, existingDeck) : undefined;

  // The learner's other words, so the model doesn't repeat itself across decks.
  const others = await prisma.card.findMany({
    where: { userId, deck: { profileId: profile.id } },
    select: { target: true },
    orderBy: { createdAt: "desc" },
    take: OTHER_CARDS_LIMIT,
  });
  // Everything to skip afterwards: the deck's own cards always count, however
  // many newer cards the learner has made elsewhere.
  const existing = [...(deckContext?.cards ?? []), ...others].map((c) => c.target);

  const batch = await generateCards({
    prompt,
    targetLanguage: profile.targetLanguage,
    sourceLanguage: profile.sourceLanguage,
    level: profile.level,
    count,
    existingTargets: others.map((c) => c.target),
    deck: deckContext,
  });

  // A new deck is made only now that the model has named it: a failed job
  // leaves no empty "New deck" behind.
  const deck =
    existingDeck ??
    (await prisma.deck.create({
      data: {
        userId,
        profileId: profile.id,
        name: batch.deckName || "New deck",
        emoji: batch.emoji || null,
        description: prompt,
        sourcePrompt: prompt,
        direction: requested ?? "RECOGNITION",
      },
    }));
  if (!existingDeck) await setJob({ deckId: deck.id, deckName: deck.name });

  // Skip anything that slipped through as a duplicate of an existing card,
  // or that the model repeated within the batch.
  const seen = new Set(existing.map((t) => t.trim().toLowerCase()));
  const fresh = batch.cards.filter((c) => {
    const key = c.target.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const shouldSpeak = withAudio && ttsAvailable();
  const cardTypes = cardTypesFor(requested ?? deck.direction);
  if (shouldSpeak) await setJob({ status: CardJobStatus.AUDIO, done: 0, total: fresh.length });

  // Sequential on purpose. Fanning these out hammers the ElevenLabs rate limit
  // (the original Python script capped itself at 4 workers for the same
  // reason), and the local `prisma dev` Postgres rejects parallel bursts.
  const created: { id: string; target: string; source: string }[] = [];

  for (const [index, card] of fresh.entries()) {
    let audioUrl: string | null = null;
    let sentenceAudioUrl: string | null = null;

    if (shouldSpeak) {
      audioUrl = await trySynthesize({
        text: card.target,
        language: profile.targetLanguage,
        voiceId: profile.voiceId,
      });
      if (card.targetSentence) {
        sentenceAudioUrl = await trySynthesize({
          text: card.targetSentence,
          language: profile.targetLanguage,
          voiceId: profile.voiceId,
        });
      }
    }

    // "Both" is one card per direction, sharing the same audio.
    for (const cardType of cardTypes) {
      created.push(
        await prisma.card.create({
          data: {
            userId,
            deckId: deck.id,
            target: card.target,
            source: card.source,
            targetSentence: card.targetSentence || null,
            sourceSentence: card.sourceSentence || null,
            notes: card.notes || null,
            tags: card.tags,
            cardType,
            audioUrl,
            sentenceAudioUrl,
            ...newCardState(),
          },
          select: { id: true, target: true, source: true },
        }),
      );
    }
    if (shouldSpeak) await setJob({ done: index + 1, created: created.length });
  }

  // Picture cards are studied right away (they fall back to the translation
  // until their picture lands); the pictures follow.
  const wantsPictures = cardTypes.includes(CardType.PICTURE);
  if (wantsPictures && !imagesAvailable()) {
    console.warn("[card-jobs] GEMINI_API_KEY is not set: picture cards created without pictures");
  }
  if (wantsPictures && imagesAvailable() && created.length > 0) {
    const queue = created.slice(0, MAX_IMAGES);
    await setJob({ status: CardJobStatus.PICTURES, done: 0, total: queue.length, created: created.length });
    const languages = { targetLanguage: profile.targetLanguage, sourceLanguage: profile.sourceLanguage };
    const worker = async () => {
      for (let card = queue.shift(); card; card = queue.shift()) {
        if (Date.now() - started > IMAGE_START_DEADLINE_MS) {
          console.warn(`[card-jobs] out of time: ${queue.length + 1} pictures not drawn`);
          queue.length = 0;
          return;
        }
        const imageUrl = await generateCardImage({ ...languages, target: card.target, source: card.source });
        // updateMany: the card may have been deleted while its picture was drawn.
        if (imageUrl) await prisma.card.updateMany({ where: { id: card.id }, data: { imageUrl } });
        await setJob({ done: { increment: 1 } });
      }
    };
    await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
  }

  await setJob({ status: CardJobStatus.DONE, created: created.length });
}

/** How far back the status endpoint looks: past the stale limit, so a lost job still shows as failed. */
const RECENT_MS = CARD_JOB_STALE_AFTER_MS + 5 * 60_000;

/**
 * The learner's recent jobs, oldest first, for the status pill. One indexed
 * query (userId, createdAt), no aggregates: it runs every 2 s while a job is going.
 */
export async function recentCardJobs(userId: string, now: Date = new Date()): Promise<CardJobView[]> {
  const jobs = await prisma.cardJob.findMany({
    where: { userId, createdAt: { gt: new Date(now.getTime() - RECENT_MS) } },
    select: CARD_JOB_FIELDS,
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return jobs.map((job) => toCardJobView(job, now));
}
