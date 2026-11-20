// The deck page's "Add cards" chips: written by the AI from the deck, cached
// on the Deck row, and rewritten only once the deck's card count has moved by
// 5 or more. The AI is mocked; what's real is the route and the Deck row.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/decks/[deckId]/suggestions/route";
import { suggestForDeck } from "@/lib/ai/deck-suggestions";
import { hasAiCredentials } from "@/lib/ai/model";
import { createCard, createCards, createDeck, createProfile, createUser } from "../factories";

vi.mock("@/lib/ai/deck-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/deck-suggestions")>()),
  suggestForDeck: vi.fn(),
}));
vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/model")>()),
  hasAiCredentials: vi.fn(),
}));

async function suggestions(deckId: string) {
  const res = await GET(new Request(`http://t/api/decks/${deckId}/suggestions`), {
    params: Promise.resolve({ deckId }),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.mocked(hasAiCredentials).mockReturnValue(true);
  vi.mocked(suggestForDeck).mockResolvedValue(["colours", "feelings", "personality traits"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function adjectives() {
  const user = await createUser();
  const profile = await createProfile(user);
  const deck = await createDeck(profile, { name: "Adjectives", description: "Common adjectives" });
  const sub = await createDeck(profile, { name: "Size", parent: deck });
  await createCard(deck, { target: "glad", source: "happy" });
  await createCard(sub, { target: "stor", source: "big" });
  return { user, profile, deck, sub };
}

describe("GET /api/decks/[deckId]/suggestions", () => {
  it("writes them from the deck the first time, and caches them with the card count", async () => {
    const { deck } = await adjectives();

    const { status, body } = await suggestions(deck.id);
    expect(status).toBe(200);
    expect(body.suggestions).toEqual(["colours", "feelings", "personality traits"]);

    const input = vi.mocked(suggestForDeck).mock.calls[0][0];
    expect(input).toMatchObject({ targetLanguage: "sv", sourceLanguage: "en", level: "A2" });
    expect(input.deck.path).toEqual(["Adjectives"]);
    expect(input.deck.description).toBe("Common adjectives");
    expect(input.deck.cards.map((c) => c.target).sort()).toEqual(["glad", "stor"]);

    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row).toMatchObject({ suggestions: body.suggestions, suggestionsCardCount: 2 });
  });

  it("serves the cache until the subtree has 5 more (or fewer) cards", async () => {
    const { deck, sub } = await adjectives();
    await suggestions(deck.id);

    await createCards(sub, 4);
    expect((await suggestions(deck.id)).body.suggestions).toEqual(["colours", "feelings", "personality traits"]);
    expect(suggestForDeck).toHaveBeenCalledTimes(1);

    vi.mocked(suggestForDeck).mockResolvedValue(["weather", "taste"]);
    await createCard(sub);
    expect((await suggestions(deck.id)).body.suggestions).toEqual(["weather", "taste"]);
    expect(suggestForDeck).toHaveBeenCalledTimes(2);
    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row).toMatchObject({ suggestions: ["weather", "taste"], suggestionsCardCount: 7 });

    await prisma.card.deleteMany({ where: { deckId: sub.id } });
    await suggestions(deck.id);
    expect(suggestForDeck).toHaveBeenCalledTimes(3);
  });

  it("without AI, answers with what's cached, or nothing", async () => {
    const { deck } = await adjectives();
    vi.mocked(hasAiCredentials).mockReturnValue(false);

    expect((await suggestions(deck.id)).body).toEqual({ suggestions: [] });

    await prisma.deck.update({ where: { id: deck.id }, data: { suggestions: ["old"], suggestionsCardCount: 50 } });
    expect((await suggestions(deck.id)).body).toEqual({ suggestions: ["old"] });
    expect(suggestForDeck).not.toHaveBeenCalled();
  });

  it("when the model fails, answers with the stale cache and leaves it in place", async () => {
    const { deck } = await adjectives();
    await prisma.deck.update({ where: { id: deck.id }, data: { suggestions: ["old"], suggestionsCardCount: 50 } });
    vi.mocked(suggestForDeck).mockRejectedValue(new Error("model down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await suggestions(deck.id)).body).toEqual({ suggestions: ["old"] });
    const row = await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } });
    expect(row.suggestionsCardCount).toBe(50);
  });

  it("answers 404 for another user's deck", async () => {
    await adjectives();
    const other = await createUser({ email: "other@lara.local" });
    const theirs = await createDeck(await createProfile(other), { name: "Theirs" });

    expect((await suggestions(theirs.id)).status).toBe(404);
    expect(suggestForDeck).not.toHaveBeenCalled();
  });
});
