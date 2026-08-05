import { generateObject } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { getLanguage, nextLevelUp } from "../languages";
import type { CefrLevel } from "@/generated/prisma/enums";

/**
 * Immersion articles. The core idea (Krashen's i+1): a text is most useful when
 * it sits just above the learner's current level — mostly words they know, with
 * a controlled amount of new material they can infer from context.
 */

const segment = z.object({
  target: z
    .string()
    .describe("One sentence of the article, in the target language"),
  translation: z
    .string()
    .describe("A natural translation of that sentence in the source language"),
});

const generatedArticle = z.object({
  title: z.string().describe("The article title in the target language"),
  titleTranslated: z.string().describe("The title in the source language"),
  segments: z
    .array(segment)
    .describe("The article, split one entry per sentence, in reading order"),
  reusedVocabulary: z
    .array(z.string())
    .describe("Words from the learner's known list that this text reuses"),
  newVocabulary: z
    .array(z.string())
    .describe(
      "The new words this text deliberately introduces — the '+1'. Keep this short.",
    ),
});

export type GeneratedArticle = z.infer<typeof generatedArticle>;

export type GenerateArticleInput = {
  topic: string;
  targetLanguage: string;
  sourceLanguage: string
  /** The learner's own level; the text is written one step above it. */
  level: CefrLevel;
  /** Roughly how long the piece should be. */
  wordCount?: number;
  /** Vocabulary the learner has cards for, so the text can lean on it. */
  knownVocabulary?: string[];
};

export async function generateArticle({
  topic,
  targetLanguage,
  sourceLanguage,
  level,
  wordCount = 180,
  knownVocabulary = [],
}: GenerateArticleInput): Promise<{
  article: GeneratedArticle;
  level: CefrLevel;
}> {
  assertAiCredentials();

  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;
  const writeAt = nextLevelUp(level);
  const known = knownVocabulary.slice(0, 400);

  const { object } = await generateObject({
    model: getModel(),
    schema: generatedArticle,
    instructions: [
      `You write short immersion texts in ${target} for a learner whose native language is ${source}.`,
      `The learner is at CEFR ${level}. Write at CEFR ${writeAt} — one step above them.`,
      "The point is comprehensible input: the learner should follow the text without a dictionary, while meeting some new language.",
      "Roughly 90-95% of the content words should be within reach at their level; introduce a handful of new ones and make each inferable from its context.",
      "Write real prose with a thread to follow — a small story, a slice of life, an opinion. Not a list of facts and not a grammar drill.",
      "Use short paragraphs and natural sentence rhythm. Vary sentence length.",
      "Split the output one entry per sentence. Translations should read naturally, not word-for-word.",
    ].join(" "),
    prompt: [
      `Write an immersion text of about ${wordCount} words on: ${topic}`,
      known.length > 0
        ? `\nThe learner already knows these words — build the text mostly out of them:\n${known.join(", ")}`
        : "",
    ].join(""),
  });

  return { article: object, level: writeAt };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
