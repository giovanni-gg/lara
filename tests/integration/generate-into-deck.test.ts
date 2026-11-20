// Generating cards INTO an existing deck: the route loads the deck first and
// hands the model its path, description and cards (subdecks included), so
// "5 more" in Adjectives gives adjectives, not verbs. The AI is mocked; what's
// real is the route and the rows it reads and writes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/decks/generate/route";
import { generateCards } from "@/lib/ai/cards";
import { createCard, createCards, createDeck, createProfile, createUser } from "../factories";

vi.mock("@/lib/ai/cards", () => ({ generateCards: vi.fn() }));
vi.mock("@/lib/tts", () => ({ ttsAvailable: () => false, trySynthesize: vi.fn(async () => null) }));

const card = (target: string, source: string) => ({
  target,
  source,
  targetSentence: "",
  sourceSentence: "",
  notes: "",
  tags: ["adjectives"],
});

function generate(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/decks/generate", { method: "POST", body: JSON.stringify(body) }),
  );
}

/** What the route passed to the model on its only call. */
const modelInput = () => vi.mocked(generateCards).mock.calls[0][0];

beforeEach(() => {
  vi.mocked(generateCards).mockResolvedValue({
    deckName: "ignored",
    emoji: "x",
    cards: [card("glad", "happy"), card("stor", "big"), card("trött", "tired")],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function adjectivesDeck() {
  const user = await createUser();
  const profile = await createProfile(user);
  const swedish = await createDeck(profile, { name: "Swedish" });
  const deck = await createDeck(profile, {
    name: "Adjectives",
    parent: swedish,
    description: "Common adjectives",
    sourcePrompt: "common adjectives",
  });
  const colours = await createDeck(profile, { name: "Colours", parent: deck });
  await createCard(deck, { target: "stor", source: "big", tags: ["adjectives"] });
  await createCard(deck, { target: "liten", source: "small", tags: ["adjectives"] });
  await createCard(colours, { target: "röd", source: "red", tags: ["colours"] });
  return { user, profile, swedish, deck };
}

describe("POST /api/decks/generate into an existing deck", () => {
  it("gives the model the deck's path, description and cards across its subtree", async () => {
    const { deck } = await adjectivesDeck();

    const res = await generate({ prompt: "5 more", count: 5, deckId: deck.id });
    expect(res.status).toBe(200);

    const input = modelInput();
    expect(input.prompt).toBe("5 more");
    expect(input.deck).toMatchObject({
      path: ["Swedish", "Adjectives"],
      description: "Common adjectives",
      sourcePrompt: "common adjectives",
    });
    expect(input.deck?.cards.map((c) => c.target).sort()).toEqual(["liten", "röd", "stor"]);
    expect(input.deck?.cards).toContainEqual({ target: "stor", source: "big", tags: ["adjectives"] });
  });

  it("works with no prompt at all, and skips a repeat of a deck card", async () => {
    const { deck } = await adjectivesDeck();

    const res = await generate({ count: 5, deckId: deck.id });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ deck: { id: deck.id, name: "Adjectives" }, created: 2, skipped: 1 });
    expect(modelInput().prompt).toBe("");

    const targets = (await prisma.card.findMany({ where: { deckId: deck.id } })).map((c) => c.target);
    expect(targets.sort()).toEqual(["glad", "liten", "stor", "trött"]);
  });

  it("still skips the deck's own words after 300 newer cards elsewhere", async () => {
    const { profile, deck } = await adjectivesDeck();
    const verbs = await createDeck(profile, { name: "Verbs" });
    // Newer than the deck's cards, enough to fill the profile-wide window.
    await createCards(verbs, 300, (i) => ({ target: `verb ${i}`, createdAt: new Date(Date.now() + 1000 + i) }));

    const data = await (await generate({ count: 3, deckId: deck.id })).json();
    expect(data).toMatchObject({ created: 2, skipped: 1 });
    expect(modelInput().deck?.cards.map((c) => c.target)).toContain("stor");
  });

  it("answers 404 for a deck in another profile, without calling the model", async () => {
    const { user } = await adjectivesDeck();
    const other = await createProfile(user, { targetLanguage: "pt", isActive: false });
    const elsewhere = await createDeck(other, { name: "Adjetivos" });

    const res = await generate({ count: 5, deckId: elsewhere.id });
    expect(res.status).toBe(404);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("still needs a prompt to make a new deck", async () => {
    await adjectivesDeck();

    const res = await generate({ count: 5 });
    expect(res.status).toBe(400);
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("makes a new deck without deck context", async () => {
    await adjectivesDeck();

    const res = await generate({ prompt: "feelings", count: 3 });
    expect(res.status).toBe(200);
    expect(modelInput().deck).toBeUndefined();
    expect(modelInput().existingTargets).toEqual(expect.arrayContaining(["stor", "liten", "röd"]));
  });
});
