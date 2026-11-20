import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { assertAiCredentials, getModel } from "./model";
import { anthropicOptions, CACHE_BREAKPOINT, loggedCall, MAX_RETRIES } from "./call";
import { getLanguage } from "../languages";
import { learnerContextRules, learnerNoteBlock } from "../learner-context";
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

/** A new deck: the model names it too. */
export const newDeckBatch = z.object({
  deckName: z.string().describe("A short deck title, 2-4 words, no emoji"),
  emoji: z.string().describe("A single emoji that fits the deck topic"),
  cards: z.array(generatedCard),
});

/** Cards for an existing deck: it already has a name, so only the cards. */
export const deckAdditionBatch = z.object({ cards: z.array(generatedCard) });

export type GeneratedCard = z.infer<typeof generatedCard>;
/** `deckName`/`emoji` only come back for a new deck. */
export type GeneratedCardBatch = {
  deckName?: string;
  emoji?: string;
  cards: GeneratedCard[];
};

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
  /** The note about the learner's life ("About you"), from `learnerContext`. */
  learner?: string | null;
};

/**
 * Cap on the learner's other words in the exclusion list: a few hundred is
 * enough to stop duplicates without paying for the whole collection. The
 * deck's own cards come on top and are never crowded out.
 */
const OTHER_AVOID_LIMIT = 300;
/** Deck cards shown in full, so the model copies their format. The rest go as bare words. */
export const DECK_EXAMPLES = 5;

/**
 * Output budget: ~150 tokens per card of JSON plus headroom for Opus 5.5's
 * (low-effort) thinking, which counts against the same limit. Generous on
 * purpose: a cut-off answer is broken JSON and the whole batch is lost.
 */
export function cardOutputTokens(count: number): number {
  return 4_000 + count * 300;
}

const uniqueCaseless = (words: string[]): string[] => {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Header, a few full example cards, then every other word, compactly. */
export function describeDeck(deck: DeckContext): string {
  const lines = [`The deck: "${deck.path.join("::")}"`];
  if (deck.description?.trim()) lines.push(`Description: ${deck.description.trim()}`);
  if (deck.sourcePrompt?.trim() && deck.sourcePrompt.trim() !== deck.description?.trim()) {
    lines.push(`First generated from: ${deck.sourcePrompt.trim()}`);
  }
  if (deck.cards.length === 0) {
    lines.push("The deck has no cards yet: go by its name and description.");
    return lines.join("\n");
  }
  const examples = deck.cards.slice(0, DECK_EXAMPLES);
  lines.push(
    `Example cards from the deck (target — source [tags]):\n${examples
      .map((c) => `${c.target} — ${c.source}${c.tags.length > 0 ? ` [${c.tags.join(", ")}]` : ""}`)
      .join("\n")}`,
  );
  const rest = uniqueCaseless(deck.cards.slice(DECK_EXAMPLES).map((c) => c.target));
  if (rest.length > 0) lines.push(`Every other word already in the deck:\n${rest.join(", ")}`);
  return lines.join("\n");
}

/**
 * Everything one generation sends, without calling the model.
 *
 * Ordered stable → volatile for the prompt cache: the fixed instructions
 * (system), then the note about the learner (it changes only when they edit
 * "About you"), then the context (the deck; or, for a new deck, the learner's
 * words), the last of these marked as the cache breakpoint, then the ask.
 * `avoid` is every word
 * the model was told not to repeat: the deck's own first, then up to
 * OTHER_AVOID_LIMIT of the learner's others.
 */
export function buildCardRequest({
  prompt,
  targetLanguage,
  sourceLanguage,
  level,
  count,
  existingTargets = [],
  deck,
  learner,
}: GenerateCardsInput) {
  const target = getLanguage(targetLanguage).name;
  const source = getLanguage(sourceLanguage).name;
  const note = learner?.trim() || null;

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
          "Work out what the deck is from its name, its path and its existing cards, then match it: the same theme, the same word class (a deck of adjectives gets only adjectives, a deck of verbs only verbs), the same format as the example cards (bare words, phrases or full expressions; with or without articles; translations written the same way) and the same difficulty.",
          "The learner's request, if there is one, narrows what to add within the deck; it does not replace the deck's theme. With no request, add the next most useful items that fit.",
          "Never repeat a card the deck already has, nor a near-duplicate of one (another inflection of the same word, or the same meaning reworded). Reuse the deck's tags where they fit.",
        ]
      : []),
    ...(note
      ? [
          learnerContextRules("the choice of words and especially the example sentences"),
          deck
            ? "The deck's theme always comes first: never add a word that doesn't belong in the deck just because it fits the learner's life."
            : "The request always comes first: never add a word outside it just because it fits the learner's life.",
        ]
      : []),
  ].join(" ");

  const request = prompt.trim();
  const avoidLine = (words: string[], where: string) =>
    `The learner already has these${where}, so do not include them:\n${words.join(", ")}`;

  let context: string | null;
  const ask: string[] = [];
  if (deck) {
    context = describeDeck(deck);
    if (others.length > 0) ask.push(avoidLine(others, " in other decks"));
    ask.push(`Create exactly ${count} new flashcards for this deck.`);
    ask.push(request ? `The learner's request: ${request}` : "The learner gave no further request.");
  } else {
    context = others.length > 0 ? avoidLine(others, "") : null;
    ask.push(`Create exactly ${count} flashcards for this request: ${request}`);
  }

  // The parts that stay the same between calls; the last carries the breakpoint.
  const stable = [note ? learnerNoteBlock(note) : null, context].filter((text): text is string => Boolean(text));
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        ...stable.map((text, index) => ({
          type: "text" as const,
          text,
          ...(index === stable.length - 1 ? { providerOptions: CACHE_BREAKPOINT } : {}),
        })),
        { type: "text" as const, text: ask.join("\n") },
      ],
    },
  ];

  return {
    /** generateObject's options, bar the model. */
    call: {
      schema: deck ? deckAdditionBatch : newDeckBatch,
      instructions,
      messages,
      maxOutputTokens: cardOutputTokens(count),
      maxRetries: MAX_RETRIES,
      // Picking and writing a handful of words is simple: low effort, little thinking.
      providerOptions: anthropicOptions("low"),
    },
    avoid: [...deckTargets, ...others],
  };
}

export async function generateCards(input: GenerateCardsInput): Promise<GeneratedCardBatch> {
  assertAiCredentials();
  const { call } = buildCardRequest(input);
  const { object } = await loggedCall("cards", () => generateObject({ model: getModel(), ...call }));
  if (object.cards.length === 0) {
    throw new Error("The model returned no cards. Try again, or reword the request.");
  }
  if (object.cards.length < input.count) {
    console.warn(`[ai] cards: asked for ${input.count}, got ${object.cards.length}`);
  }
  return object;
}
