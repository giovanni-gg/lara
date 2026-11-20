import { prisma } from "./db";
import { deckPath, subtreeIds } from "./deck-tree";
import { countWords, generateStory, STORY_LENGTHS, type StoryLength } from "./ai/stories";
import {
  backgroundVocabulary,
  sampleDeckVocabulary,
  type DeckVocabulary,
} from "./story-vocabulary";
import { trySynthesize } from "./tts";
import { ArticleStatus, ContentKind, type CefrLevel } from "@/generated/prisma/enums";
import { nextLevelUp } from "./languages";
import { storiesLeftToday } from "./allowance";
import { storyLimitMessage } from "./limits";
import { learnerContext, type AboutFields } from "./learner-context";

/**
 * Writing a story is a server-side job, so leaving the page can't lose it:
 *
 *   queueStory   — validates the request and saves a DRAFT placeholder
 *                  ("Writing…") the library can show immediately.
 *   writeStory   — gathers the learner's words, has the model write the story
 *                  and fills that same row in (READY), or marks it FAILED.
 *   synthesizeStoryAudio — speaks the sentences.
 *
 * The route runs the last two in `after()`, once the response is sent.
 */

/** Where a story is, for the library: kept out of components so render stays pure. */
export function storyState(story: { status: ArticleStatus; createdAt: Date }): "writing" | "failed" | "ready" {
  if (story.status === ArticleStatus.READY) return "ready";
  if (story.status === ArticleStatus.FAILED) return "failed";
  return Date.now() - story.createdAt.getTime() > STORY_STALE_AFTER_MS ? "failed" : "writing";
}

/** How many stories may be in the works at once. */
export const MAX_STORIES_IN_PROGRESS = 3;

/** A DRAFT older than this was lost (crash, timeout) and is shown as failed. */
export const STORY_STALE_AFTER_MS = 10 * 60_000;

/** Bad input the caller should see as a 4xx, e.g. a deck that isn't theirs. */
export class StoryInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 429 = 400,
  ) {
    super(message);
    this.name = "StoryInputError";
  }
}

export type CreateStoryInput = {
  userId: string;
  /** The account's email, which decides its daily cap (limits.ts). */
  email: string;
  profile: {
    id: string;
    targetLanguage: string;
    sourceLanguage: string;
    level: CefrLevel;
  } & AboutFields;
  prompt?: string;
  length: StoryLength;
  /** Build the story around this deck (and its subdecks). Omit for all cards. */
  deckId?: string;
};

/** How many of the learner's general known words go in the prompt. */
const BACKGROUND_WORDS = 250;

/** Saves a "Writing…" placeholder for a story and returns its id. Fast; no AI. */
export async function queueStory(
  { userId, email, profile, prompt, deckId }: CreateStoryInput,
  now: Date = new Date(),
) {
  // The daily cap (the owner has none) comes first: nothing else is worth checking past it.
  if ((await storiesLeftToday({ id: userId, email }, now)) === 0) {
    throw new StoryInputError(storyLimitMessage(), 429);
  }

  let topic: string | null = prompt ?? null;
  if (deckId) {
    const row = await prisma.deck.findFirst({
      where: { id: deckId, userId, profileId: profile.id },
      select: { id: true },
    });
    if (!row) throw new StoryInputError("That deck doesn't exist");
    const cards = await prisma.card.count({ where: { deckId: { in: await subtreeIds(profile.id, row.id) } } });
    if (cards === 0) throw new StoryInputError("That deck has no cards yet");
    topic ??= (await deckPath(row.id)).map((p) => p.name).join(" · ");
  }

  const inProgress = await prisma.article.count({
    where: {
      profileId: profile.id,
      status: ArticleStatus.DRAFT,
      createdAt: { gt: new Date(Date.now() - STORY_STALE_AFTER_MS) },
    },
  });
  if (inProgress >= MAX_STORIES_IN_PROGRESS) {
    throw new StoryInputError(
      `${MAX_STORIES_IN_PROGRESS} stories are already being written — wait for one to finish.`,
    );
  }

  const { id } = await prisma.article.create({
    data: {
      userId,
      profileId: profile.id,
      deckId: deckId ?? null,
      kind: ContentKind.STORY,
      status: ArticleStatus.DRAFT,
      title: "Writing your story…",
      topic,
      level: nextLevelUp(profile.level),
      body: "",
      sourcePrompt: prompt ?? null,
    },
    select: { id: true },
  });
  return id;
}

/**
 * Writes the story for a queued placeholder and fills it in. Never throws: a
 * failure marks the row FAILED so the library can say so.
 */
export async function writeStory(articleId: string, input: CreateStoryInput): Promise<boolean> {
  try {
    const story = await composeStory(input);
    await prisma.$transaction([
      prisma.articleSegment.deleteMany({ where: { articleId } }),
      prisma.article.update({
        where: { id: articleId },
        data: {
          ...story.fields,
          status: ArticleStatus.READY,
          segments: { create: story.segments },
        },
      }),
    ]);
    return true;
  } catch (error) {
    console.error(`[stories] writing ${articleId} failed:`, error);
    await prisma.article
      .update({ where: { id: articleId }, data: { status: ArticleStatus.FAILED } })
      .catch(() => {});
    return false;
  }
}

/** The model call plus everything it needs; returns the row's content. */
async function composeStory({ userId, profile, prompt, length, deckId }: CreateStoryInput) {
  const spec = STORY_LENGTHS[length];

  let deck: (DeckVocabulary & { id: string; label: string }) | undefined;
  if (deckId) {
    const row = await prisma.deck.findFirst({
      where: { id: deckId, userId, profileId: profile.id },
      select: { id: true, archivedAt: true },
    });
    if (!row) throw new StoryInputError("That deck doesn't exist");

    const ids = await subtreeIds(profile.id, row.id);
    const cards = await prisma.card.findMany({
      where: {
        deckId: { in: ids },
        suspended: false,
        // Archived subdecks drop out — unless the archived deck is the one picked.
        ...(row.archivedAt ? {} : { deck: { archivedAt: null } }),
      },
      select: { target: true, source: true, reps: true },
    });
    if (cards.length === 0) throw new StoryInputError("That deck has no cards yet");

    const vocabulary = sampleDeckVocabulary(cards, {
      studied: spec.deckWords,
      unstudied: spec.newWords,
    });
    const path = await deckPath(row.id);
    deck = { id: row.id, label: path.map((p) => p.name).join(" · "), ...vocabulary };
  }

  // Words the learner has actually reviewed — a card never seen isn't known.
  const known = await prisma.card.findMany({
    where: {
      userId,
      suspended: false,
      reps: { gt: 0 },
      deck: { profileId: profile.id, archivedAt: null },
    },
    select: { target: true },
    orderBy: { reps: "desc" },
    take: 600,
  });
  const knownVocabulary = backgroundVocabulary(
    known.map((c) => c.target),
    deck ? [...deck.studied, ...deck.unstudied] : [],
    BACKGROUND_WORDS,
  );

  const { story, level } = await generateStory({
    prompt,
    targetLanguage: profile.targetLanguage,
    sourceLanguage: profile.sourceLanguage,
    level: profile.level,
    length,
    knownVocabulary,
    deck,
    learner: learnerContext(profile),
  });

  const segments = story.segments.filter((s) => s.target.trim());
  const bodyText = segments.map((s) => s.target.trim()).join(" ");

  return {
    fields: {
      title: story.title,
      titleTranslated: story.titleTranslated,
      topic: prompt ?? deck?.label ?? null,
      level,
      body: bodyText,
      wordCount: countWords(bodyText),
      reusedVocabulary: story.reusedVocabulary,
      newVocabulary: story.newVocabulary,
    },
    segments: segments.map((segment, index) => ({
      index,
      target: segment.target.trim(),
      translation: segment.translation.trim(),
    })),
  };
}

/**
 * Speaks every sentence of a story that has no audio yet, in reading order, a
 * few at a time. There is deliberately no whole-story clip: the reader plays
 * the sentences back to back, so one set of clips serves both "play the story"
 * and "hear this sentence" — and a single clip of a long story would blow past
 * MAX_MEDIA_BYTES (4 MB is about four minutes at 128 kbps).
 *
 * Best-effort: a sentence that fails stays null and the reader synthesises it
 * on demand through /api/segments/[id]/audio. `limit` caps how many sentences
 * this call handles, so the first few can be ready before a response goes out.
 */
export async function synthesizeStoryAudio(
  articleId: string,
  { limit, concurrency = 3 }: { limit?: number; concurrency?: number } = {},
): Promise<{ spoken: number; failed: number }> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      profile: { select: { targetLanguage: true, voiceId: true } },
      segments: {
        where: { audioUrl: null },
        orderBy: { index: "asc" },
        take: limit,
        select: { id: true, target: true },
      },
    },
  });
  if (!article) return { spoken: 0, failed: 0 };

  const queue = [...article.segments];
  let spoken = 0;
  let failed = 0;

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const audioUrl = await trySynthesize({
        text: next.target,
        language: article.profile.targetLanguage,
        voiceId: article.profile.voiceId,
      });
      if (!audioUrl) {
        failed += 1;
        continue;
      }
      await prisma.articleSegment.update({
        where: { id: next.id },
        data: { audioUrl },
      });
      spoken += 1;
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { spoken, failed };
}
