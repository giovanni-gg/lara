import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { anthropicOptions, loggedCall, MAX_RETRIES } from "./call";
import { describeDeck, type DeckContext } from "./cards";
import { getLanguage } from "../languages";
import { learnerNoteBlock } from "../learner-context";
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
  /** The note about the learner's life ("About you"), from `learnerContext`. */
  learner?: string | null;
};

/**
 * Everything one suggestion call sends, without calling the model: fixed
 * instructions, then the deck (the same compact form card generation uses),
 * then the ask.
 */
export function buildSuggestionRequest({ targetLanguage, sourceLanguage, level, deck, learner }: SuggestDeckInput) {
  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;
  const note = learner?.trim() || null;

  const instructions = [
    `You help someone learning ${target} who speaks ${source} grow a ${target} flashcard deck. Their level is CEFR ${level}.`,
    `Suggest ${SUGGESTION_COUNT} short requests they could make for the next cards in this deck.`,
    "Each must fit the deck's theme and word class exactly (in a deck of adjectives, kinds of adjectives) and point at something the deck doesn't cover yet. Make them different from each other.",
    `Write the suggestions in ${source}, the learner's own language: 1-4 words each, lowercase, no numbering or punctuation.`,
    "Leave out the word class the deck already implies: in a deck of adjectives say \"colours\", not \"colour adjectives\".",
    ...(note
      ? [
          "You also get a short note about the learner's life. One or two suggestions may tie the deck's theme to it (in a deck of verbs, \"training\" for a marathon runner) when that fits naturally; the rest stay general. The deck's theme still comes first, and never invent facts about the learner.",
        ]
      : []),
  ].join(" ");

  // No prompt-cache breakpoint here: the chips are cached on the deck, so the
  // same prompt practically never comes back within the cache's 5 minutes,
  // and a cache write costs more than plain input.
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        ...(note ? [{ type: "text" as const, text: learnerNoteBlock(note) }] : []),
        { type: "text", text: describeDeck({ ...deck, cards: deck.cards.slice(0, CARDS_SHOWN) }) },
        { type: "text", text: `Suggest ${SUGGESTION_COUNT} requests for the next cards in this deck.` },
      ],
    },
  ];

  return {
    schema: suggestionList,
    instructions,
    messages,
    // A few words of JSON plus low-effort thinking.
    maxOutputTokens: 2_000,
    maxRetries: MAX_RETRIES,
    providerOptions: anthropicOptions("low"),
  };
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
  const call = buildSuggestionRequest(input);
  const { object } = await loggedCall("suggestions", () => generateObject({ model: getModel(), ...call }));
  return tidySuggestions(object.suggestions);
}
