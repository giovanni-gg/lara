// Adding cards to an existing deck must give cards that belong in it: the
// model sees the deck's path, description and cards, and never repeats them.
// The request is built by a pure function; the AI SDK is mocked, nothing is called.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

type Call = { instructions?: string; messages?: ModelMessage[]; [key: string]: unknown };
const calls: Call[] = [];
let reply: { cards: unknown[] } = { cards: [] };

vi.mock("ai", () => ({
  generateObject: vi.fn(async (options: Call) => {
    calls.push(options);
    return {
      object: reply,
      usage: { inputTokens: 1, outputTokens: 1, inputTokenDetails: {}, outputTokenDetails: {} },
      finishReason: "stop",
      response: { modelId: "mock-model" },
    };
  }),
}));
vi.mock("./model", () => ({ getModel: () => "mock-model", assertAiCredentials: () => {} }));

const { buildCardRequest, generateCards, newDeckBatch, deckAdditionBatch, cardOutputTokens } = await import(
  "./cards"
);
type GenerateCardsInput = Parameters<typeof buildCardRequest>[0];

const card = (target: string) => ({
  target,
  source: target,
  targetSentence: "",
  sourceSentence: "",
  notes: "",
  tags: [],
});

const ADJECTIVES = {
  path: ["Swedish", "Adjectives"],
  description: "Common adjectives",
  sourcePrompt: "common Swedish adjectives",
  cards: [
    { target: "stor", source: "big", tags: ["adjectives"] },
    { target: "liten", source: "small", tags: ["adjectives", "size"] },
    { target: "snabb", source: "fast", tags: [] },
    { target: "långsam", source: "slow", tags: [] },
    { target: "varm", source: "warm", tags: [] },
    { target: "kall", source: "cold", tags: ["weather"] },
    { target: "ny", source: "new", tags: [] },
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

/** The user message's text parts, in order. */
function parts(messages: ModelMessage[]) {
  expect(messages).toHaveLength(1);
  const [message] = messages;
  expect(message.role).toBe("user");
  return (message.content as { type: string; text: string; providerOptions?: unknown }[]).map((p) => ({
    text: p.text,
    cached: p.providerOptions !== undefined,
    providerOptions: p.providerOptions,
  }));
}

beforeEach(() => {
  calls.length = 0;
  reply = { cards: [card("glad")] };
});

describe("buildCardRequest with a deck", () => {
  it("puts the deck in a cached context part and the ask after it", () => {
    const { call } = buildCardRequest({ ...base, prompt: "colours", deck: ADJECTIVES });
    const [context, ask] = parts(call.messages);
    expect(context.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(ask.cached).toBe(false);

    expect(context.text).toContain('The deck: "Swedish::Adjectives"');
    expect(context.text).toContain("Description: Common adjectives");
    expect(context.text).toContain("First generated from: common Swedish adjectives");
    // The volatile parts stay out of the cached prefix.
    expect(context.text).not.toContain("colours");
    expect(context.text).not.toContain("Create exactly");
    expect(ask.text).toContain("Create exactly 5 new flashcards for this deck.");
    expect(ask.text).toContain("The learner's request: colours");
  });

  it("shows five example cards in full and the rest as bare words", () => {
    const { call } = buildCardRequest({ ...base, deck: ADJECTIVES });
    const [context] = parts(call.messages);
    expect(context.text).toContain("stor — big [adjectives]");
    expect(context.text).toContain("liten — small [adjectives, size]");
    expect(context.text).toContain("varm — warm");
    expect(context.text).toContain("Every other word already in the deck:\nkall, ny");
    expect(context.text).not.toContain("cold");
    expect(context.text).not.toContain("[weather]");
  });

  it("tells the model to match the deck's theme, word class and format", () => {
    const { call } = buildCardRequest({ ...base, deck: ADJECTIVES });
    expect(call.instructions).toContain("adding cards to an existing deck");
    expect(call.instructions).toContain("same word class");
    expect(call.instructions).toContain("same format as the example cards");
    expect(call.instructions).toContain("Never repeat a card the deck already has");
    expect(call.instructions).toContain("does not replace the deck's theme");
  });

  it("works with an empty prompt", () => {
    const { call } = buildCardRequest({ ...base, prompt: "  ", deck: ADJECTIVES });
    const [, ask] = parts(call.messages);
    expect(ask.text).toContain("The learner gave no further request.");
    expect(ask.text).not.toContain("this request:");
  });

  it("asks for cards only, without a deck name or emoji", () => {
    expect(buildCardRequest({ ...base, deck: ADJECTIVES }).call.schema).toBe(deckAdditionBatch);
    expect(Object.keys(deckAdditionBatch.shape)).toEqual(["cards"]);
  });

  it("puts the deck's own cards in the avoid list, ahead of the learner's others", () => {
    const others = Array.from({ length: 400 }, (_, i) => `ord ${i}`);
    const { avoid, call } = buildCardRequest({
      ...base,
      existingTargets: ["Stor", "springa", ...others],
      deck: ADJECTIVES,
    });
    // The deck's words are never crowded out by 400 newer cards elsewhere.
    expect(avoid.slice(0, 3)).toEqual(["stor", "liten", "snabb"]);
    expect(avoid).toContain("springa");
    // "Stor" is already the deck's "stor": listed once, not again among the others.
    expect(avoid.filter((w) => w.toLowerCase() === "stor")).toHaveLength(1);
    expect(avoid).toHaveLength(ADJECTIVES.cards.length + 300);
    const [, ask] = parts(call.messages);
    expect(ask.text).toContain("already has these in other decks, so do not include them:\nspringa, ord 0");
  });

  it("handles an empty deck by its name", () => {
    const { call } = buildCardRequest({ ...base, deck: { path: ["Verbs"], cards: [] } });
    const [context] = parts(call.messages);
    expect(context.text).toContain('The deck: "Verbs"');
    expect(context.text).toContain("The deck has no cards yet");
  });
});

describe("buildCardRequest without a deck", () => {
  it("is the new-deck request, naming the deck too", () => {
    const { call, avoid } = buildCardRequest({ ...base, prompt: "food", existingTargets: ["äpple"] });
    const [context, ask] = parts(call.messages);
    expect(context.text).toBe("The learner already has these, so do not include them:\näpple");
    expect(context.cached).toBe(true);
    expect(ask.text).toBe("Create exactly 5 flashcards for this request: food");
    expect(call.instructions).not.toContain("existing deck");
    expect(call.schema).toBe(newDeckBatch);
    expect(avoid).toEqual(["äpple"]);
  });

  it("has just the ask when the learner has no cards yet", () => {
    const { call } = buildCardRequest({ ...base, prompt: "food" });
    expect(parts(call.messages).map((p) => p.cached)).toEqual([false]);
  });
});

describe("buildCardRequest with a note about the learner", () => {
  const NOTE = "They are moving to Stockholm in May and run marathons.";

  it("puts the note before the deck, inside the cached prefix", () => {
    const { call } = buildCardRequest({ ...base, prompt: "colours", deck: ADJECTIVES, learner: NOTE });
    const [note, deck, ask] = parts(call.messages);
    expect(note.text).toBe(`About the learner (from their profile):\n${NOTE}`);
    // One breakpoint, on the last stable part: the note is cached with the deck.
    expect(note.cached).toBe(false);
    expect(deck.text).toContain('The deck: "Swedish::Adjectives"');
    expect(deck.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(ask.cached).toBe(false);
    expect(ask.text).not.toContain("Stockholm");
  });

  it("tells the model to use it lightly, with the deck's theme first", () => {
    const { call } = buildCardRequest({ ...base, deck: ADJECTIVES, learner: NOTE });
    expect(call.instructions).toContain("especially the example sentences");
    expect(call.instructions).toContain("not every one");
    expect(call.instructions).toContain("background context only");
    expect(call.instructions).toContain("never the same personal fact over and over");
    expect(call.instructions).toContain("Never invent facts about the learner");
    expect(call.instructions).toContain("The deck's theme always comes first");
    // The note itself is not in the system prompt.
    expect(call.instructions).not.toContain("Stockholm");
  });

  it("for a new deck, keeps the request first and caches the note before the avoid list", () => {
    const { call } = buildCardRequest({ ...base, prompt: "food", existingTargets: ["äpple"], learner: NOTE });
    const [note, avoid, ask] = parts(call.messages);
    expect(note.text).toContain(NOTE);
    expect(avoid.text).toContain("äpple");
    expect(avoid.cached).toBe(true);
    expect(ask.text).toBe("Create exactly 5 flashcards for this request: food");
    expect(call.instructions).toContain("The request always comes first");
  });

  it("caches the note on its own when it's the only stable part", () => {
    const { call } = buildCardRequest({ ...base, prompt: "food", learner: NOTE });
    expect(parts(call.messages).map((p) => p.cached)).toEqual([true, false]);
  });

  it("leaves no trace without a note", () => {
    for (const learner of [undefined, null, "  "]) {
      const { call } = buildCardRequest({ ...base, deck: ADJECTIVES, learner });
      expect(call).toEqual(buildCardRequest({ ...base, deck: ADJECTIVES }).call);
      expect(call.instructions).not.toContain("about the learner's life");
      expect(parts(call.messages).map((p) => p.text).join("\n")).not.toContain("About the learner");
    }
  });
});

describe("the call itself", () => {
  it("is low effort through native structured output, with no sampling or thinking settings", () => {
    const { call } = buildCardRequest({ ...base, deck: ADJECTIVES });
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: "outputFormat", effort: "low" } });
    expect(call).not.toHaveProperty("temperature");
    expect(call).not.toHaveProperty("topP");
    expect(call).not.toHaveProperty("topK");
    expect(JSON.stringify(call.providerOptions)).not.toMatch(/thinking|budget/i);
    expect(call.maxRetries).toBe(2);
  });

  it("budgets output for the count, with room for thinking", () => {
    expect(buildCardRequest({ ...base, count: 5 }).call.maxOutputTokens).toBe(cardOutputTokens(5));
    expect(cardOutputTokens(40)).toBeGreaterThan(cardOutputTokens(5));
    expect(cardOutputTokens(5)).toBeGreaterThanOrEqual(4_000 + 5 * 150);
  });

  it("is what generateCards sends", async () => {
    await generateCards({ ...base, prompt: "food" });
    const { call } = buildCardRequest({ ...base, prompt: "food" });
    expect(calls[0]).toEqual({ model: "mock-model", ...call });
  });
});

describe("generateCards results", () => {
  it("returns a short batch as is", async () => {
    reply = { cards: [card("glad"), card("ledsen")] };
    const batch = await generateCards({ ...base, deck: ADJECTIVES });
    expect(batch.cards.map((c) => c.target)).toEqual(["glad", "ledsen"]);
  });

  it("reports an empty batch as an error", async () => {
    reply = { cards: [] };
    await expect(generateCards({ ...base, deck: ADJECTIVES })).rejects.toThrow("returned no cards");
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
    const { instructions = "", messages = [] } = calls[0];
    expect(instructions).toContain(`learning ${learner.target} who speaks ${learner.source}`);
    expect(instructions).toContain(`"target" and "targetSentence" are in ${learner.target}`);
    expect(instructions).toContain(
      `"source", "sourceSentence", "notes" and the deck title are in ${learner.source}`,
    );
    const [context] = parts(messages);
    expect(context.text).toContain('The deck: "Adjetivos"');
    expect(context.text).toContain("grande — stor");
  });
});
