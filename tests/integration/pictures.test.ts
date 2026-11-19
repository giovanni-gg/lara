// "Picture first": AI deck generation and hand-written cards create PICTURE
// cards at once, and their pictures are drawn in `after()` (run here by the
// next/server stub; `settleAfter()` waits for it). The AI and the image model
// are mocked; what's real is the route, the action and the rows they write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/decks/generate/route";
import { createCard } from "@/app/actions";
import { generateCards } from "@/lib/ai/cards";
import { generateCardImage, imagesAvailable } from "@/lib/images";
import { CardType } from "@/generated/prisma/enums";
import { createDeck, createProfile, createUser } from "../factories";
import { settleAfter } from "./stubs/next-server";

vi.mock("@/lib/ai/cards", () => ({ generateCards: vi.fn() }));
vi.mock("@/lib/images", () => ({ generateCardImage: vi.fn(), imagesAvailable: vi.fn() }));
vi.mock("@/lib/tts", () => ({ ttsAvailable: () => false, trySynthesize: vi.fn(async () => null) }));

const card = (target: string, source: string) => ({
  target,
  source,
  targetSentence: "",
  sourceSentence: "",
  notes: "",
  tags: [],
});

/** The URL the fake image model hands back for a word. */
const pictureOf = (target: string) => `/api/media/img-${encodeURIComponent(target)}.webp`;

function generate(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/decks/generate", { method: "POST", body: JSON.stringify(body) }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.mocked(imagesAvailable).mockReturnValue(true);
  vi.mocked(generateCardImage).mockImplementation(async ({ target }) => pictureOf(target));
  vi.mocked(generateCards).mockResolvedValue({
    deckName: "Fruit",
    emoji: "🍎",
    cards: [card("äpple", "apple"), card("banan", "banana"), card("päron", "pear"), card("plommon", "plum")],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/decks/generate with Picture first", () => {
  it("creates PICTURE cards at once, then gives each its picture", async () => {
    const user = await createUser();
    await createProfile(user);

    const res = await generate({ prompt: "fruit", count: 4, direction: "PICTURE" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ created: 4, pictures: "drawing" });

    // The response is back: the cards exist and are picture cards, still blank.
    const deck = await prisma.deck.findUniqueOrThrow({ where: { id: data.deck.id } });
    expect(deck.direction).toBe("PICTURE");
    const before = await prisma.card.findMany({ where: { deckId: deck.id } });
    expect(before).toHaveLength(4);
    for (const c of before) expect(c).toMatchObject({ cardType: CardType.PICTURE, imageUrl: null });

    await settleAfter();

    const after = await prisma.card.findMany({ where: { deckId: deck.id }, orderBy: { target: "asc" } });
    expect(after.map((c) => [c.target, c.imageUrl])).toEqual(
      ["banan", "plommon", "päron", "äpple"].sort().map((t) => [t, pictureOf(t)]),
    );
    expect(generateCardImage).toHaveBeenCalledTimes(4);
  });

  it("leaves a card blank when its picture fails, and still draws the rest", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(generateCardImage).mockImplementation(async ({ target }) =>
      target === "banan" ? null : pictureOf(target),
    );

    const data = await (await generate({ prompt: "fruit", count: 4, direction: "PICTURE" })).json();
    await settleAfter();

    const cards = await prisma.card.findMany({ where: { deckId: data.deck.id } });
    const byTarget = new Map(cards.map((c) => [c.target, c.imageUrl]));
    expect(byTarget.get("banan")).toBeNull();
    expect(byTarget.get("äpple")).toBe(pictureOf("äpple"));
    expect(byTarget.get("plommon")).toBe(pictureOf("plommon"));
  });

  it("skips a card deleted before its picture lands", async () => {
    const user = await createUser();
    await createProfile(user);

    const data = await (await generate({ prompt: "fruit", count: 4, direction: "PICTURE" })).json();
    await prisma.card.deleteMany({ where: { deckId: data.deck.id, target: "äpple" } });
    await settleAfter();

    const cards = await prisma.card.findMany({ where: { deckId: data.deck.id } });
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c.imageUrl).toBe(pictureOf(c.target));
  });

  it("without GEMINI_API_KEY creates the picture cards with no picture", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(imagesAvailable).mockReturnValue(false);

    const data = await (await generate({ prompt: "fruit", count: 4, direction: "PICTURE" })).json();
    expect(data).toMatchObject({ created: 4, pictures: "unavailable" });
    await settleAfter();

    const cards = await prisma.card.findMany({ where: { deckId: data.deck.id } });
    expect(cards).toHaveLength(4);
    for (const c of cards) expect(c).toMatchObject({ cardType: CardType.PICTURE, imageUrl: null });
    expect(generateCardImage).not.toHaveBeenCalled();
  });

  it("draws nothing for word cards", async () => {
    const user = await createUser();
    await createProfile(user);

    const data = await (await generate({ prompt: "fruit", count: 4, direction: "RECOGNITION" })).json();
    expect(data.pictures).toBeNull();
    await settleAfter();

    expect(generateCardImage).not.toHaveBeenCalled();
    const cards = await prisma.card.findMany({ where: { deckId: data.deck.id } });
    for (const c of cards) expect(c).toMatchObject({ cardType: CardType.RECOGNITION, imageUrl: null });
  });

  it("asks for Ebba's pictures with the Portuguese word and its Swedish translation", async () => {
    const user = await createUser();
    await createProfile(user, { targetLanguage: "pt", sourceLanguage: "sv" });
    vi.mocked(generateCards).mockResolvedValue({
      deckName: "Frutas",
      emoji: "🍎",
      cards: [card("maçã", "äpple")],
    });

    await generate({ prompt: "frukt", count: 1, direction: "PICTURE" });
    await settleAfter();

    expect(generateCardImage).toHaveBeenCalledWith({
      target: "maçã",
      source: "äpple",
      targetLanguage: "pt",
      sourceLanguage: "sv",
    });
  });
});

describe("createCard with Picture first", () => {
  it("creates a PICTURE card, then gives it its picture", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const deck = await createDeck(profile);

    await createCard(form({ deckId: deck.id, target: "äpple", source: "apple", direction: "PICTURE" }));

    const [created] = await prisma.card.findMany({ where: { deckId: deck.id } });
    expect(created).toMatchObject({ cardType: CardType.PICTURE, target: "äpple", imageUrl: null });

    await settleAfter();

    const drawn = await prisma.card.findUniqueOrThrow({ where: { id: created.id } });
    expect(drawn.imageUrl).toBe(pictureOf("äpple"));
    expect(generateCardImage).toHaveBeenCalledWith({
      target: "äpple",
      source: "apple",
      targetLanguage: "sv",
      sourceLanguage: "en",
    });
  });

  it("follows a Picture-first deck's own direction", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const deck = await createDeck(profile, { direction: "PICTURE" });

    await createCard(form({ deckId: deck.id, target: "banan", source: "banana" }));
    await settleAfter();

    const [created] = await prisma.card.findMany({ where: { deckId: deck.id } });
    expect(created).toMatchObject({ cardType: CardType.PICTURE, imageUrl: pictureOf("banan") });
  });

  it("without GEMINI_API_KEY creates the card with no picture", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const deck = await createDeck(profile);
    vi.mocked(imagesAvailable).mockReturnValue(false);

    await createCard(form({ deckId: deck.id, target: "äpple", source: "apple", direction: "PICTURE" }));
    await settleAfter();

    const [created] = await prisma.card.findMany({ where: { deckId: deck.id } });
    expect(created).toMatchObject({ cardType: CardType.PICTURE, imageUrl: null });
    expect(generateCardImage).not.toHaveBeenCalled();
  });

  it("for Ebba, asks with the Portuguese word and its Swedish translation", async () => {
    const user = await createUser();
    const profile = await createProfile(user, { targetLanguage: "pt", sourceLanguage: "sv" });
    const deck = await createDeck(profile);

    await createCard(form({ deckId: deck.id, target: "maçã", source: "äpple", direction: "PICTURE" }));
    await settleAfter();

    expect(generateCardImage).toHaveBeenCalledWith({
      target: "maçã",
      source: "äpple",
      targetLanguage: "pt",
      sourceLanguage: "sv",
    });
  });
});
