import { generateObject } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { getLanguage } from "../languages";
import type { DeckContext } from "./cards";
import type { CefrLevel } from "@/generated/prisma/enums";

/**
 * The "Add cards" chips inside a deck: a few short requests that fit the
 * deck's theme and point at what it doesn't cover yet ("colours", "feelings"
 * in Adjectives). Tapping one fills the prompt that `generateCards` refines
 * the deck with, so they're written in the learner's own language.
 */

export const SUGGESTION_COUNT = 4;
/** Cards shown to the model: plenty to see what's covered, cheap to send. */
const CARDS_SHOWN = 150;
/** Chips stay one short line on a phone. */
const MAX_LENGTH = 40;

const suggestionList = z.object({
  suggestions: z
    .array(z.string())
    .describe(`${SUGGESTION_COUNT} short requests, 1-4 words each, lowercase, no numbering or punctuation`),
});

export type SuggestDeckInput = {
  targetLanguage: string;
  sourceLanguage: string;
  level: CefrLevel;
  deck: DeckContext;
};

export function buildSuggestionRequest({ targetLanguage, sourceLanguage, level, deck }: SuggestDeckInput): {
  instructions: string;
  prompt: string;
} {
  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;

  const instructions = [
    `You help someone learning ${target} who speaks ${source} grow a ${target} flashcard deck. Their level is CEFR ${level}.`,
    `Suggest ${SUGGESTION_COUNT} short requests they could make for the next cards in this deck.`,
    "Each must fit the deck's theme and word class exactly (in a deck of adjectives, kinds of adjectives) and point at something the deck doesn't cover yet. Make them different from each other.",
    `Write the suggestions in ${source}, the learner's own language: 1-4 words each, lowercase, no numbering or punctuation.`,
  ].join(" ");

  const lines = [`The deck: "${deck.path.join("::")}".`];
  if (deck.description?.trim()) lines.push(`Description: ${deck.description.trim()}`);
  if (deck.sourcePrompt?.trim() && deck.sourcePrompt.trim() !== deck.description?.trim()) {
    lines.push(`First generated from: ${deck.sourcePrompt.trim()}`);
  }
  const shown = deck.cards.slice(0, CARDS_SHOWN);
  lines.push(
    shown.length > 0
      ? `Its cards so far (${target} — ${source}):\n${shown.map((c) => `${c.target} — ${c.source}`).join("\n")}`
      : "It has no cards yet: go by its name.",
  );

  return { instructions, prompt: lines.join("\n") };
}

/** Cached chips are rewritten once the deck's card count has moved this far. */
export const SUGGESTIONS_STALE_AFTER = 5;

/** Whether a deck's cached chips should be rewritten for its current card count. */
export function suggestionsAreStale(cachedForCount: number | null, cardCount: number): boolean {
  return cachedForCount === null || Math.abs(cardCount - cachedForCount) >= SUGGESTIONS_STALE_AFTER;
}

/** Cleans what the model hands back into at most SUGGESTION_COUNT distinct chips. */
export function tidySuggestions(raw: string[]): string[] {
  const seen = new Set<string>();
  return raw
    .map((s) => s.trim().replace(/[.!]+$/, ""))
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || s.length > MAX_LENGTH || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SUGGESTION_COUNT);
}

export async function suggestForDeck(input: SuggestDeckInput): Promise<string[]> {
  assertAiCredentials();
  const { instructions, prompt } = buildSuggestionRequest(input);
  const { object } = await generateObject({
    model: getModel(),
    schema: suggestionList,
    instructions,
    prompt,
  });
  return tidySuggestions(object.suggestions);
}
