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

/** The deck new cards are added to, so they fit it rather than just the prompt. */
export type DeckContext = {
  /** Root-first deck names, e.g. ["Swedish", "Adjectives"]. */
  path: string[];
  description?: string | null;
  /** The prompt the deck was first generated from, if it was. */
  sourcePrompt?: string | null;
  /** Its cards across the subtree, most recent first, already capped. */
  cards: { target: string; source: string; tags: string[] }[];
};

export type GenerateCardsInput = {
  /** What to make. With a deck it only refines, and may be empty. */
  prompt: string;
  targetLanguage: string;
  sourceLanguage: string;
  level: CefrLevel;
  count: number;
  /** Words the learner already has, so the model doesn't hand back duplicates. */
  existingTargets?: string[];
  /** Set when adding to an existing deck. */
  deck?: DeckContext;
};

/**
 * Cap on the learner's other words in the exclusion list: a few hundred is
 * enough to stop duplicates without paying for the whole collection. The
 * deck's own cards come on top and are never crowded out.
 */
const OTHER_AVOID_LIMIT = 300;

const uniqueCaseless = (words: string[]): string[] => {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The instructions and prompt for one generation, without calling the model.
 * `avoid` is every word the model was told not to repeat: the deck's own
 * cards first, then up to OTHER_AVOID_LIMIT of the learner's others.
 */
export function buildCardRequest({
  prompt,
  targetLanguage,
  sourceLanguage,
  level,
  count,
  existingTargets = [],
  deck,
}: GenerateCardsInput): { instructions: string; prompt: string; avoid: string[] } {
  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;

  const deckTargets = uniqueCaseless(deck?.cards.map((c) => c.target) ?? []);
  const inDeck = new Set(deckTargets.map((t) => t.toLowerCase()));
  const others = uniqueCaseless(existingTargets)
    .filter((t) => !inDeck.has(t.trim().toLowerCase()))
    .slice(0, OTHER_AVOID_LIMIT);

  const instructions = [
    `You build vocabulary flashcards for someone learning ${target} who speaks ${source}.`,
    // Spelled out: the schema says "target"/"source", and the model must never
    // guess which is which (e.g. Portuguese for a Swedish speaker).
    `The target language is ${target}: "target" and "targetSentence" are in ${target}. The source language is ${source}: "source", "sourceSentence", "notes" and the deck title are in ${source}.`,
    `Their level is CEFR ${level}. Pitch the vocabulary and the example sentences at that level.`,
    "Give the single most useful, most frequent form of each item — not obscure synonyms.",
    "Example sentences must be things a real speaker would say, not textbook filler.",
    "For nouns in languages with grammatical gender, include the article in the target field where that is the natural dictionary form.",
    "Never repeat an item within the batch.",
    ...(deck
      ? [
          "You are adding cards to an existing deck, and every new card must belong in it.",
          "Work out what the deck is from its name, its path and its existing cards, then match it: the same theme, the same word class (a deck of adjectives gets only adjectives, a deck of verbs only verbs), the same format (bare words, phrases or full expressions; with or without articles; translations written the same way) and the same difficulty.",
          "The learner's request, if there is one, narrows what to add within the deck; it does not replace the deck's theme. With no request, add the next most useful items that fit.",
          "Never repeat a card the deck already has, nor a near-duplicate of one (another inflection of the same word, or the same meaning reworded). Reuse the deck's tags where they fit.",
        ]
      : []),
  ].join(" ");

  const request = prompt.trim();
  const lines: string[] = [];
  if (deck) {
    lines.push(`Create exactly ${count} new flashcards for the deck "${deck.path.join("::")}".`);
    if (deck.description?.trim()) lines.push(`Deck description: ${deck.description.trim()}`);
    if (deck.sourcePrompt?.trim() && deck.sourcePrompt.trim() !== deck.description?.trim()) {
      lines.push(`The deck was first generated from: ${deck.sourcePrompt.trim()}`);
    }
    lines.push(
      deck.cards.length > 0
        ? `Cards already in the deck (target — source [tags]), none of which may be repeated:\n${deck.cards
            .map((c) => `${c.target} — ${c.source}${c.tags.length > 0 ? ` [${c.tags.join(", ")}]` : ""}`)
            .join("\n")}`
        : "The deck has no cards yet: go by its name and description.",
    );
    lines.push(request ? `The learner's request: ${request}` : "The learner gave no further request.");
  } else {
    lines.push(`Create exactly ${count} flashcards for this request: ${request}`);
  }
  if (others.length > 0) {
    lines.push(
      `The learner already has these${deck ? " in other decks" : ""}, so do not include them:\n${others.join(", ")}`,
    );
  }

  return { instructions, prompt: lines.join("\n"), avoid: [...deckTargets, ...others] };
}

export async function generateCards(input: GenerateCardsInput): Promise<GeneratedCardBatch> {
  assertAiCredentials();
  const { instructions, prompt } = buildCardRequest(input);
  const { object } = await generateObject({
    model: getModel(),
    schema: cardBatch,
    instructions,
    prompt,
  });
  return object;
}
