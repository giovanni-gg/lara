import { generateObject } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { getLanguage } from "../languages";
import type { CefrLevel } from "@/generated/prisma/enums";

const generatedCard = z.object({
  target: z
    .string()
    .describe("The word or phrase in the target language, correctly inflected"),
  source: z
    .string()
    .describe("Its translation in the source language, no extra commentary"),
  targetSentence: z
    .string()
    .describe("A natural example sentence in the target language using it"),
  sourceSentence: z
    .string()
    .describe("That example sentence translated into the source language"),
  notes: z
    .string()
    .describe(
      "One short usage or grammar note: gender, irregular form, register, false-friend warning. Empty string if there is nothing worth saying.",
    ),
  tags: z
    .array(z.string())
    .describe("One to three lowercase topic tags, e.g. ['verbs','travel']"),
});

const cardBatch = z.object({
  deckName: z.string().describe("A short deck title, 2-4 words, no emoji"),
  emoji: z.string().describe("A single emoji that fits the deck topic"),
  cards: z.array(generatedCard),
});

export type GeneratedCard = z.infer<typeof generatedCard>;
export type GeneratedCardBatch = z.infer<typeof cardBatch>;

export type GenerateCardsInput = {
  prompt: string;
  targetLanguage: string;
  sourceLanguage: string;
  level: CefrLevel;
  count: number;
  /** Words the learner already has, so the model doesn't hand back duplicates. */
  existingTargets?: string[];
};

export async function generateCards({
  prompt,
  targetLanguage,
  sourceLanguage,
  level,
  count,
  existingTargets = [],
}: GenerateCardsInput): Promise<GeneratedCardBatch> {
  assertAiCredentials();

  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;

  // Cap the exclusion list: a few hundred words is enough to stop duplicates
  // without paying for the learner's whole collection on every request.
  const avoid = existingTargets.slice(0, 300);

  const { object } = await generateObject({
    model: getModel(),
    schema: cardBatch,
    instructions: [
      `You build vocabulary flashcards for someone learning ${target} who speaks ${source}.`,
      `Their level is CEFR ${level}. Pitch the vocabulary and the example sentences at that level.`,
      "Give the single most useful, most frequent form of each item — not obscure synonyms.",
      "Example sentences must be things a real speaker would say, not textbook filler.",
      "For nouns in languages with grammatical gender, include the article in the target field where that is the natural dictionary form.",
      "Never repeat an item within the batch.",
    ].join(" "),
    prompt: [
      `Create exactly ${count} flashcards for this request: ${prompt}`,
      avoid.length > 0
        ? `\nThe learner already has these, so do not include them:\n${avoid.join(", ")}`
        : "",
    ].join(""),
  });

  return object;
}
