import { generateObject } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { getLanguage, nextLevelUp } from "../languages";
import type { VocabularyWord } from "../story-vocabulary";
import type { CefrLevel } from "@/generated/prisma/enums";

/**
 * Stories — the app's one kind of immersion text (Listen & Read).
 *
 * The core idea (Krashen's i+1): input is most useful just above the learner's
 * level — mostly words they know, plus a controlled handful of new ones they
 * can infer from context. Narrative rather than expository, because volume of
 * *engaging* input is what actually gets consumed: a story you want to finish
 * is worth more than a factual passage you abandon halfway.
 */

const segment = z.object({
  target: z
    .string()
    .describe("One sentence of the story, in the target language"),
  translation: z
    .string()
    .describe("A natural translation of that sentence in the source language"),
});

const generatedStory = z.object({
  title: z.string().describe("The story's title, in the target language"),
  titleTranslated: z.string().describe("The title in the source language"),
  segments: z
    .array(segment)
    .describe("The full story, one entry per sentence, in reading order"),
  reusedVocabulary: z
    .array(z.string())
    .describe("Words from the learner's lists that this story uses"),
  newVocabulary: z
    .array(z.string())
    .describe(
      "The new words this story deliberately teaches — the '+1'. Keep it short.",
    ),
});

export type GeneratedStory = z.infer<typeof generatedStory>;

export const STORY_LENGTH_KEYS = ["short", "medium", "long", "epic"] as const;
export type StoryLength = (typeof STORY_LENGTH_KEYS)[number];

/**
 * Word counts are paired with structural guidance — a 1,500-word story needs a
 * different shape from a 200-word one, not just more sentences. The vocabulary
 * budget scales too: how many deck words to offer, and how many new words the
 * story may introduce.
 */
export const STORY_LENGTHS: Record<
  StoryLength,
  {
    label: string;
    words: number;
    shape: string;
    deckWords: number;
    newWords: number;
  }
> = {
  short: {
    label: "Short",
    words: 250,
    shape:
      "A single scene. One or two characters, one small moment of change. Get in late and out early.",
    deckWords: 15,
    newWords: 4,
  },
  medium: {
    label: "Medium",
    words: 550,
    shape:
      "Two or three scenes. Give a character something they want and something in the way of it.",
    deckWords: 25,
    newWords: 6,
  },
  long: {
    label: "Long",
    words: 1100,
    shape:
      "A complete arc across several scenes. Room for a subplot, a reversal, and a real ending.",
    deckWords: 45,
    newWords: 10,
  },
  epic: {
    label: "Very long",
    words: 2000,
    shape:
      "A substantial piece with chapters' worth of development. Let time pass between scenes and let characters change over it.",
    deckWords: 70,
    newWords: 14,
  },
};

export type GenerateStoryInput = {
  /** What the learner asked for. Optional: without it the model picks a premise. */
  prompt?: string;
  targetLanguage: string;
  sourceLanguage: string;
  /** The learner's own level; the story is written one step above it. */
  level: CefrLevel;
  length: StoryLength;
  /** Vocabulary the learner has studied, so the story can lean on it. */
  knownVocabulary?: string[];
  /** A deck to build the story around, with a sample of its words. */
  deck?: {
    label: string;
    studied: VocabularyWord[];
    unstudied: VocabularyWord[];
  };
};

const listWords = (words: VocabularyWord[]) =>
  words
    .map((w) => (w.source ? `- ${w.target} — ${w.source}` : `- ${w.target}`))
    .join("\n");

/** The user-turn prompt. Exported so the wording can be checked without a model call. */
export function storyPrompt({
  prompt,
  length,
  knownVocabulary = [],
  deck,
}: Pick<GenerateStoryInput, "prompt" | "length" | "knownVocabulary" | "deck">): string {
  const spec = STORY_LENGTHS[length];
  const known = knownVocabulary.slice(0, 400);
  const lines = [`Write a story of about ${spec.words} words.`, `Shape: ${spec.shape}`, ""];

  if (prompt) {
    lines.push(`The reader asked for: ${prompt}`);
  } else {
    lines.push(
      deck
        ? "The reader didn't ask for anything in particular. Pick a premise these words suit naturally — an everyday situation with a small problem in it works well."
        : "The reader didn't ask for anything in particular. Pick an everyday premise with a small problem in it.",
    );
  }

  if (deck) {
    lines.push(
      "",
      `This story is built around a deck the reader is studying: "${deck.label}".`,
    );
    if (deck.studied.length > 0) {
      const aim = Math.max(1, Math.round(deck.studied.length * 0.6));
      lines.push(
        "",
        `Words from this deck they have studied. They are the backbone of the story: work in as many as fit naturally (aim for at least ${aim}), each in a sentence that makes its meaning clear. Inflect them as the sentence needs.`,
        listWords(deck.studied),
      );
    }
    if (deck.unstudied.length > 0) {
      lines.push(
        "",
        "Words from this deck they haven't studied yet. Take your new words from here first:",
        listWords(deck.unstudied),
      );
    }
  }

  if (known.length > 0) {
    lines.push(
      "",
      deck
        ? `Other words they know — lean on these for the rest of the text:\n${known.join(", ")}`
        : `They already know these words — build the story mostly out of them:\n${known.join(", ")}`,
    );
  }

  return lines.join("\n");
}

export async function generateStory(input: GenerateStoryInput): Promise<{
  story: GeneratedStory;
  level: CefrLevel;
  targetWords: number;
}> {
  assertAiCredentials();

  const { targetLanguage, sourceLanguage, level, length } = input;
  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;
  const writeAt = nextLevelUp(level);
  const spec = STORY_LENGTHS[length];

  const { object } = await generateObject({
    model: getModel(),
    schema: generatedStory,
    instructions: [
      `You write short fiction in ${target} for a learner whose native language is ${source}.`,
      `Every sentence ("target") and the title are in ${target}. Every "translation" and "titleTranslated" is in ${source} — never English unless ${source} is English.`,
      `The learner is at CEFR ${level}. Write at CEFR ${writeAt} — one step above them.`,
      "The story is read on screen and listened to as audio, sentence by sentence, so it must sound natural read aloud.",
      "",
      "This is a story, not a lesson. The reader should want to know what happens next.",
      "Give characters something they want. Let them speak in dialogue. Put concrete detail on the page — a smell, a sound, an object — rather than summarising events.",
      "Do not moralise, and do not end on a stated lesson. Let the ending land on an image or a line of dialogue.",
      "",
      "Because the reader is a learner:",
      "- Roughly 90-95% of content words should be within reach at their level.",
      `- Introduce about ${spec.newWords} new words and make each one inferable from its context — a new word in a vague sentence is a dead end.`,
      "- Repeat a new word two or three times across the story, in different sentences. Repetition in context is what makes it stick.",
      "- Vary sentence length. A run of identical structures reads as a drill.",
      "- Keep tense use consistent enough to follow; a narrative past is usually right.",
      "",
      "Split the output one entry per sentence. Treat a line of dialogue as its own sentence. Translations should read naturally, not word-for-word.",
    ].join("\n"),
    prompt: storyPrompt(input),
  });

  return { story: object, level: writeAt, targetWords: spec.words };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
