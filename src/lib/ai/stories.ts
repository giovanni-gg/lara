import { generateObject } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { getLanguage, nextLevelUp } from "../languages";
import type { CefrLevel } from "@/generated/prisma/enums";

/**
 * Prompted short stories.
 *
 * Same i+1 principle as articles — written one CEFR level above the learner —
 * but narrative rather than expository, because volume of *engaging* input is
 * what actually gets consumed. A story you want to finish is worth more than a
 * factual passage you abandon halfway.
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
    .describe("Words from the learner's known list that this story reuses"),
  newVocabulary: z
    .array(z.string())
    .describe(
      "The new words this story deliberately teaches — the '+1'. Keep it short.",
    ),
});

export type GeneratedStory = z.infer<typeof generatedStory>;

export type StoryLength = "short" | "medium" | "long" | "epic";

/**
 * Word counts are paired with structural guidance — a 1,500-word story needs a
 * different shape from a 200-word one, not just more sentences.
 */
export const STORY_LENGTHS: Record<
  StoryLength,
  { label: string; words: number; shape: string }
> = {
  short: {
    label: "Short",
    words: 250,
    shape:
      "A single scene. One or two characters, one small moment of change. Get in late and out early.",
  },
  medium: {
    label: "Medium",
    words: 550,
    shape:
      "Two or three scenes. Give a character something they want and something in the way of it.",
  },
  long: {
    label: "Long",
    words: 1100,
    shape:
      "A complete arc across several scenes. Room for a subplot, a reversal, and a real ending.",
  },
  epic: {
    label: "Very long",
    words: 2000,
    shape:
      "A substantial piece with chapters' worth of development. Let time pass between scenes and let characters change over it.",
  },
};

export type GenerateStoryInput = {
  prompt: string;
  targetLanguage: string;
  sourceLanguage: string;
  /** The learner's own level; the story is written one step above it. */
  level: CefrLevel;
  length: StoryLength;
  /** Vocabulary the learner has cards for, so the story can lean on it. */
  knownVocabulary?: string[];
};

export async function generateStory({
  prompt,
  targetLanguage,
  sourceLanguage,
  level,
  length,
  knownVocabulary = [],
}: GenerateStoryInput): Promise<{
  story: GeneratedStory;
  level: CefrLevel;
  targetWords: number;
}> {
  assertAiCredentials();

  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;
  const writeAt = nextLevelUp(level);
  const spec = STORY_LENGTHS[length];
  const known = knownVocabulary.slice(0, 400);

  const { object } = await generateObject({
    model: getModel(),
    schema: generatedStory,
    instructions: [
      `You write short fiction in ${target} for a learner whose native language is ${source}.`,
      `The learner is at CEFR ${level}. Write at CEFR ${writeAt} — one step above them.`,
      "",
      "This is a story, not a lesson. The reader should want to know what happens next.",
      "Give characters something they want. Let them speak in dialogue. Put concrete detail on the page — a smell, a sound, an object — rather than summarising events.",
      "Do not moralise, and do not end on a stated lesson. Let the ending land on an image or a line of dialogue.",
      "",
      "Because the reader is a learner:",
      "- Roughly 90-95% of content words should be within reach at their level.",
      "- Introduce a handful of new words and make each one inferable from its context — a new word in a vague sentence is a dead end.",
      "- Repeat a new word two or three times across the story, in different sentences. Repetition in context is what makes it stick.",
      "- Vary sentence length. A run of identical structures reads as a drill.",
      "- Keep tense use consistent enough to follow; a narrative past is usually right.",
      "",
      "Split the output one entry per sentence. Treat a line of dialogue as its own sentence. Translations should read naturally, not word-for-word.",
    ].join("\n"),
    prompt: [
      `Write a story of about ${spec.words} words.`,
      `Shape: ${spec.shape}`,
      "",
      `The reader asked for: ${prompt}`,
      known.length > 0
        ? `\nThey already know these words — build the story mostly out of them:\n${known.join(", ")}`
        : "",
    ].join("\n"),
  });

  return { story: object, level: writeAt, targetWords: spec.words };
}
