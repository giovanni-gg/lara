// The "Add cards" chips inside a deck are written from the deck, in the
// learner's own language. The AI SDK is mocked, nothing is called.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { instructions?: string; prompt?: string }[] = [];
let reply: string[] = [];

vi.mock("ai", () => ({
  generateObject: vi.fn(async (options: { instructions?: string; prompt?: string }) => {
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

describe("buildSuggestionRequest", () => {
  it("shows the model the deck's path, description and cards", () => {
    const { prompt, instructions } = buildSuggestionRequest({
      targetLanguage: "sv",
      sourceLanguage: "en",
      level: "A2",
      deck: ADJECTIVES,
    });
    expect(prompt).toContain('The deck: "Swedish::Adjectives"');
    expect(prompt).toContain("Description: Common adjectives");
    expect(prompt).toContain("First generated from: common Swedish adjectives");
    expect(prompt).toContain("stor — big\nliten — small");
    expect(instructions).toContain("fit the deck's theme and word class");
    expect(instructions).toContain("doesn't cover yet");
  });

  it("goes by the name when the deck is empty", () => {
    const { prompt } = buildSuggestionRequest({
      targetLanguage: "sv",
      sourceLanguage: "en",
      level: "A2",
      deck: { path: ["Verbs"], cards: [] },
    });
    expect(prompt).toContain("It has no cards yet");
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
    const { instructions = "", prompt = "" } = calls[0];
    expect(instructions).toContain(`learning ${learner.target} who speaks ${learner.source}`);
    expect(instructions).toContain(`Write the suggestions in ${learner.source}, the learner's own language`);
    expect(prompt).toContain(`(${learner.target} — ${learner.source})`);
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
