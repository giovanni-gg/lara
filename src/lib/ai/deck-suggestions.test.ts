// The "Add cards" chips inside a deck are written from the deck, in the
// learner's own language. The AI SDK is mocked, nothing is called.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

const calls: { instructions?: string; messages?: ModelMessage[] }[] = [];
let reply: string[] = [];

vi.mock("ai", () => ({
  generateObject: vi.fn(async (options: { instructions?: string; messages?: ModelMessage[] }) => {
    calls.push(options);
    return { object: { suggestions: reply } };
  }),
}));
vi.mock("./model", () => ({ getModel: () => "mock-model", assertAiCredentials: () => {} }));

const { buildSuggestionRequest, suggestForDeck, suggestionsAreStale, tidySuggestions } = await import(
  "./deck-suggestions"
);

const ADJECTIVES = {
  path: ["Swedish", "Adjectives"],
  description: "Common adjectives",
  sourcePrompt: "common Swedish adjectives",
  cards: [
    { target: "stor", source: "big", tags: ["adjectives"] },
    { target: "liten", source: "small", tags: [] },
  ],
};

beforeEach(() => {
  calls.length = 0;
  reply = [];
});

type Part = { type: string; text: string; providerOptions?: unknown };
const partsOf = (messages: ModelMessage[]) => messages[0].content as Part[];

describe("buildSuggestionRequest", () => {
  it("shows the model the deck, then the ask, with no cache write", () => {
    const call = buildSuggestionRequest({
      targetLanguage: "sv",
      sourceLanguage: "en",
      level: "A2",
      deck: ADJECTIVES,
    });
    expect(call.messages).toHaveLength(1);
    const [deck, ask] = partsOf(call.messages);
    // Chips are cached on the deck; a prompt-cache write would rarely be read.
    expect(deck.providerOptions).toBeUndefined();
    expect(deck.text).toContain('The deck: "Swedish::Adjectives"');
    expect(deck.text).toContain("Description: Common adjectives");
    expect(deck.text).toContain("First generated from: common Swedish adjectives");
    expect(deck.text).toContain("stor — big [adjectives]\nliten — small");
    expect(ask.providerOptions).toBeUndefined();
    expect(ask.text).toContain("Suggest 4 requests");
    expect(call.instructions).toContain("fit the deck's theme and word class");
    expect(call.instructions).toContain("doesn't cover yet");
  });

  it("is a small low-effort call through native structured output", () => {
    const call = buildSuggestionRequest({ targetLanguage: "sv", sourceLanguage: "en", level: "A2", deck: ADJECTIVES });
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: "outputFormat", effort: "low" } });
    expect(call).not.toHaveProperty("temperature");
    expect(call.maxOutputTokens).toBe(2_000);
    expect(call.maxRetries).toBe(2);
  });

  it("goes by the name when the deck is empty", () => {
    const call = buildSuggestionRequest({
      targetLanguage: "sv",
      sourceLanguage: "en",
      level: "A2",
      deck: { path: ["Verbs"], cards: [] },
    });
    expect(partsOf(call.messages)[0].text).toContain("The deck has no cards yet");
  });
});

describe.each([
  { name: "Giovanni", targetLanguage: "sv", sourceLanguage: "en", target: "Swedish", source: "English" },
  { name: "Ebba", targetLanguage: "pt", sourceLanguage: "sv", target: "Portuguese", source: "Swedish" },
] as const)("suggestions for $name ($target from $source)", (learner) => {
  it("are about the target language and written in the source", async () => {
    reply = ["cores", "sentimentos"];
    const chips = await suggestForDeck({
      targetLanguage: learner.targetLanguage,
      sourceLanguage: learner.sourceLanguage,
      level: "A2",
      deck: ADJECTIVES,
    });
    expect(chips).toEqual(["cores", "sentimentos"]);
    const { instructions = "" } = calls[0];
    expect(instructions).toContain(`learning ${learner.target} who speaks ${learner.source}`);
    expect(instructions).toContain(`grow a ${learner.target} flashcard deck`);
    expect(instructions).toContain(`Write the suggestions in ${learner.source}, the learner's own language`);
  });
});

describe("tidySuggestions", () => {
  it("trims, drops repeats, blanks and overlong ones, and keeps at most four", () => {
    expect(
      tidySuggestions([" colours ", "Colours", "", "feelings.", "x".repeat(41), "size", "weather", "taste"]),
    ).toEqual(["colours", "feelings", "size", "weather"]);
  });
});

describe("suggestionsAreStale", () => {
  it("is stale when never written, or once the card count moved by 5 or more", () => {
    expect(suggestionsAreStale(null, 0)).toBe(true);
    expect(suggestionsAreStale(10, 14)).toBe(false);
    expect(suggestionsAreStale(10, 6)).toBe(false);
    expect(suggestionsAreStale(10, 15)).toBe(true);
    expect(suggestionsAreStale(10, 5)).toBe(true);
  });
});
