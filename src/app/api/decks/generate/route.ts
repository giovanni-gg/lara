import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveProfile } from "@/lib/session";
import { generateCards } from "@/lib/ai/cards";
import { loadDeckContext } from "@/lib/deck-context";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { newCardState } from "@/lib/srs";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { cardTypesFor } from "@/lib/card-direction";
import { generateCardImage, imagesAvailable } from "@/lib/images";
import { CardType } from "@/generated/prisma/enums";

const body = z
  .object({
    /** Required for a new deck; adding to a deck it only refines, and may be empty. */
    prompt: z.string().trim().max(500).default(""),
    count: z.number().int().min(1).max(50).default(15),
    /** Add to an existing deck instead of creating one. */
    deckId: z.string().optional(),
    withAudio: z.boolean().default(true),
    /** Which side faces first. Defaults to the deck's own setting. */
    direction: z.enum(["RECOGNITION", "PRODUCTION", "BOTH", "PICTURE"]).optional(),
  })
  .refine((b) => b.deckId || b.prompt.length >= 3, { path: ["prompt"] });

/** The learner's most recent other cards, so the model doesn't repeat them. */
const OTHER_CARDS_LIMIT = 300;

// Audio is recorded before the response; pictures are drawn in `after()`,
// inside the same budget.
export const maxDuration = 300;

/** Pictures drawn at once: Gemini takes several seconds per image. */
const IMAGE_CONCURRENCY = 3;
/** The most pictures one request draws (the form offers up to 40 cards). */
const MAX_IMAGES = 40;
/**
 * No new picture starts after this point in the request. One image, retries
 * included, takes at most ~100 s, so the last ones still land before 300 s.
 */
const IMAGE_START_DEADLINE_MS = 180_000;

export async function POST(request: Request) {
  const started = Date.now();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { prompt, count?, deckId?, withAudio?, direction? }; prompt may be empty only with deckId" },
      { status: 400 },
    );
  }
  const { prompt, count, deckId, withAudio, direction: requested } = parsed.data;

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json(
      { error: "Create a language profile first" },
      { status: 400 },
    );
  }

  // Adding to a deck: load it first, so the model sees what the deck is and
  // what it already holds. Queries run one after another (see AGENTS.md).
  const existingDeck = deckId
    ? await prisma.deck.findFirst({
        where: { id: deckId, userId: user.id, profileId: profile.id },
      })
    : null;
  if (deckId && !existingDeck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const deckContext = existingDeck ? await loadDeckContext(profile.id, existingDeck) : undefined;

  // The learner's other words, so the model doesn't repeat itself across decks.
  const others = await prisma.card.findMany({
    where: { userId: user.id, deck: { profileId: profile.id } },
    select: { target: true },
    orderBy: { createdAt: "desc" },
    take: OTHER_CARDS_LIMIT,
  });
  // Everything to skip afterwards: the deck's own cards always count, however
  // many newer cards the learner has made elsewhere.
  const existing = [...(deckContext?.cards ?? []), ...others].map((c) => c.target);

  let batch;
  try {
    batch = await generateCards({
      prompt,
      targetLanguage: profile.targetLanguage,
      sourceLanguage: profile.sourceLanguage,
      level: profile.level,
      count,
      existingTargets: others.map((c) => c.target),
      deck: deckContext,
    });
  } catch (error) {
    if (error instanceof MissingAiCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const deck =
    existingDeck ??
    (await prisma.deck.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        name: batch.deckName || "New deck",
        emoji: batch.emoji || null,
        description: prompt,
        sourcePrompt: prompt,
        direction: requested ?? "RECOGNITION",
      },
    }));

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

  // Sequential on purpose. Fanning these out hammers the ElevenLabs rate limit
  // (the original Python script capped itself at 4 workers for the same
  // reason), and the local `prisma dev` Postgres rejects parallel bursts.
  const created: { id: string; target: string; source: string }[] = [];

  for (const card of fresh) {
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
            userId: user.id,
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
  }

  // Picture cards are studied right away (they fall back to the translation
  // until their picture lands), so drawing never holds up the response.
  const wantsPictures = cardTypes.includes(CardType.PICTURE);
  const drawing = wantsPictures && imagesAvailable();
  if (wantsPictures && !drawing) {
    console.warn("[decks/generate] GEMINI_API_KEY is not set: picture cards created without pictures");
  }
  if (drawing) {
    const languages = {
      targetLanguage: profile.targetLanguage,
      sourceLanguage: profile.sourceLanguage,
    };
    const queue = created.slice(0, MAX_IMAGES);
    after(async () => {
      const worker = async () => {
        for (let card = queue.shift(); card; card = queue.shift()) {
          if (Date.now() - started > IMAGE_START_DEADLINE_MS) {
            console.warn(`[decks/generate] out of time: ${queue.length + 1} pictures not drawn`);
            queue.length = 0;
            return;
          }
          const imageUrl = await generateCardImage({ ...languages, target: card.target, source: card.source });
          // updateMany: the card may have been deleted while its picture was drawn.
          if (imageUrl) await prisma.card.updateMany({ where: { id: card.id }, data: { imageUrl } });
        }
      };
      await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
    });
  }

  return NextResponse.json({
    deck: { id: deck.id, name: deck.name, emoji: deck.emoji },
    created: created.length,
    skipped: batch.cards.length - fresh.length,
    audio: shouldSpeak,
    /** "drawing" while pictures are drawn after the response; null for word cards. */
    pictures: wantsPictures ? (drawing ? "drawing" : "unavailable") : null,
    cards: created,
  });
}
