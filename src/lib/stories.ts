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

/**
 * Writing a story end to end: gather the learner's words, have the model write
 * it, save it with its sentences. Audio is a separate step
 * (`synthesizeStoryAudio`) so the route can return before every sentence has
 * been spoken.
 */

/** Bad input the caller should see as a 4xx, e.g. a deck that isn't theirs. */
export class StoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryInputError";
  }
}

export type CreateStoryInput = {
  userId: string;
  profile: {
    id: string;
    targetLanguage: string;
    sourceLanguage: string;
    level: CefrLevel;
  };
  prompt?: string;
  length: StoryLength;
  /** Build the story around this deck (and its subdecks). Omit for all cards. */
  deckId?: string;
};

/** How many of the learner's general known words go in the prompt. */
const BACKGROUND_WORDS = 250;

export async function createStory({
  userId,
  profile,
  prompt,
  length,
  deckId,
}: CreateStoryInput) {
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
  });

  const segments = story.segments.filter((s) => s.target.trim());
  const bodyText = segments.map((s) => s.target.trim()).join(" ");

  return prisma.article.create({
    data: {
      userId,
      profileId: profile.id,
      deckId: deck?.id ?? null,
      kind: ContentKind.STORY,
      title: story.title,
      titleTranslated: story.titleTranslated,
      topic: prompt ?? deck?.label ?? null,
      level,
      status: ArticleStatus.READY,
      body: bodyText,
      wordCount: countWords(bodyText),
      reusedVocabulary: story.reusedVocabulary,
      newVocabulary: story.newVocabulary,
      sourcePrompt: prompt ?? null,
      segments: {
        create: segments.map((segment, index) => ({
          index,
          target: segment.target.trim(),
          translation: segment.translation.trim(),
        })),
      },
    },
    select: { id: true, title: true, level: true, wordCount: true },
  });
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
