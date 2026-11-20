// Adding cards to an existing deck must give cards that belong in it: the
// model sees the deck's path, description and cards, and never repeats them.
// The prompt is built by a pure function; the AI SDK is mocked, nothing is called.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { instructions?: string; prompt?: string }[] = [];

vi.mock("ai", () => ({
  generateObject: vi.fn(async (options: { instructions?: string; prompt?: string }) => {
    calls.push(options);
    return { object: { deckName: "x", emoji: "x", cards: [] } };
  }),
}));
vi.mock("./model", () => ({ getModel: () => "mock-model", assertAiCredentials: () => {} }));

const { buildCardRequest, generateCards } = await import("./cards");
type GenerateCardsInput = Parameters<typeof buildCardRequest>[0];

const ADJECTIVES = {
  path: ["Swedish", "Adjectives"],
  description: "Common adjectives",
  sourcePrompt: "common Swedish adjectives",
  cards: [
    { target: "stor", source: "big", tags: ["adjectives"] },
    { target: "liten", source: "small", tags: ["adjectives", "size"] },
    { target: "snabb", source: "fast", tags: [] },
  ],
};

const base: GenerateCardsInput = {
  prompt: "",
  targetLanguage: "sv",
  sourceLanguage: "en",
  level: "A2",
  count: 5,
  existingTargets: [],
};

beforeEach(() => {
  calls.length = 0;
});

describe("buildCardRequest with a deck", () => {
  it("shows the model the deck's path, description, origin and cards", () => {
    const { prompt } = buildCardRequest({ ...base, deck: ADJECTIVES });
    expect(prompt).toContain('Create exactly 5 new flashcards for the deck "Swedish::Adjectives"');
    expect(prompt).toContain("Deck description: Common adjectives");
    expect(prompt).toContain("first generated from: common Swedish adjectives");
    expect(prompt).toContain("stor — big [adjectives]");
    expect(prompt).toContain("liten — small [adjectives, size]");
    expect(prompt).toContain("snabb — fast");
  });

  it("tells the model to match the deck's theme, word class and format", () => {
    const { instructions } = buildCardRequest({ ...base, deck: ADJECTIVES });
    expect(instructions).toContain("adding cards to an existing deck");
    expect(instructions).toContain("same word class");
    expect(instructions).toContain("same format");
    expect(instructions).toContain("Never repeat a card the deck already has");
  });

  it("works with an empty prompt", () => {
    const { prompt } = buildCardRequest({ ...base, prompt: "  ", deck: ADJECTIVES });
    expect(prompt).toContain("The learner gave no further request.");
    expect(prompt).not.toContain("this request:");
  });

  it("treats the prompt as a refinement within the deck", () => {
    const { prompt, instructions } = buildCardRequest({ ...base, prompt: "colours", deck: ADJECTIVES });
    expect(prompt).toContain("The learner's request: colours");
    expect(instructions).toContain("does not replace the deck's theme");
  });

  it("puts the deck's own cards in the avoid list, ahead of the learner's others", () => {
    const others = Array.from({ length: 400 }, (_, i) => `ord ${i}`);
    const { avoid, prompt } = buildCardRequest({
      ...base,
      existingTargets: ["Stor", "springa", ...others],
      deck: ADJECTIVES,
    });
    // The deck's words are never crowded out by 400 newer cards elsewhere.
    expect(avoid.slice(0, 3)).toEqual(["stor", "liten", "snabb"]);
    expect(avoid).toContain("springa");
    // "Stor" is already the deck's "stor": listed once, not again among the others.
    expect(avoid.filter((w) => w.toLowerCase() === "stor")).toHaveLength(1);
    expect(avoid).toHaveLength(3 + 300);
    expect(prompt).toContain("already has these in other decks, so do not include them:\nspringa, ord 0");
  });

  it("handles an empty deck by its name", () => {
    const { prompt } = buildCardRequest({ ...base, deck: { path: ["Verbs"], cards: [] } });
    expect(prompt).toContain('for the deck "Verbs"');
    expect(prompt).toContain("The deck has no cards yet");
  });
});

describe("buildCardRequest without a deck", () => {
  it("is the plain new-deck request", () => {
    const { prompt, instructions, avoid } = buildCardRequest({
      ...base,
      prompt: "food",
      existingTargets: ["äpple"],
    });
    expect(prompt).toContain("Create exactly 5 flashcards for this request: food");
    expect(prompt).toContain("The learner already has these, so do not include them:\näpple");
    expect(instructions).not.toContain("existing deck");
    expect(avoid).toEqual(["äpple"]);
  });
});

describe.each([
  { name: "Giovanni", targetLanguage: "sv", sourceLanguage: "en", target: "Swedish", source: "English" },
  { name: "Ebba", targetLanguage: "pt", sourceLanguage: "sv", target: "Portuguese", source: "Swedish" },
] as const)("adding to a deck for $name ($target from $source)", (learner) => {
  it("keeps the target and source languages in their roles", async () => {
    await generateCards({
      ...base,
      targetLanguage: learner.targetLanguage,
      sourceLanguage: learner.sourceLanguage,
      deck: { path: ["Adjetivos"], cards: [{ target: "grande", source: "stor", tags: [] }] },
    });
    const { instructions = "", prompt = "" } = calls[0];
    expect(instructions).toContain(`learning ${learner.target} who speaks ${learner.source}`);
    expect(instructions).toContain(`"target" and "targetSentence" are in ${learner.target}`);
    expect(instructions).toContain(
      `"source", "sourceSentence", "notes" and the deck title are in ${learner.source}`,
    );
    expect(prompt).toContain('for the deck "Adjetivos"');
    expect(prompt).toContain("grande — stor");
  });
});
