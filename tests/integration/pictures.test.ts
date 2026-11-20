// "Picture first": AI deck generation and hand-written cards create PICTURE
// cards first, and their pictures are drawn afterwards: in the card job's
// PICTURES stage, or in `after()` for a hand-written card (both run here by
// the next/server stub; `settleAfter()` waits for it). The AI and the image model
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
vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/model")>()),
  hasAiCredentials: () => true,
}));
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

/** Queues a card job, runs it, and returns the finished job row. */
async function generate(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://t/api/decks/generate", { method: "POST", body: JSON.stringify(body) }),
  );
  expect(res.status).toBe(202);
  const { id } = await res.json();
  await settleAfter();
  return prisma.cardJob.findUniqueOrThrow({ where: { id } });
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
  it("creates PICTURE cards first, then gives each its picture", async () => {
    const user = await createUser();
    await createProfile(user);
    // What the job looked like while the pictures were being drawn.
    const during: { status: string; total: number; blank: number }[] = [];
    vi.mocked(generateCardImage).mockImplementation(async ({ target }) => {
      const job = await prisma.cardJob.findFirstOrThrow();
      const blank = await prisma.card.count({ where: { cardType: CardType.PICTURE, imageUrl: null } });
      during.push({ status: job.status, total: job.total, blank });
      return pictureOf(target);
    });

    const job = await generate({ prompt: "fruit", count: 4, direction: "PICTURE" });
    expect(job).toMatchObject({ status: "DONE", created: 4, done: 4, total: 4 });

    // All four cards existed, still blank, when the first picture was asked for.
    expect(during[0]).toEqual({ status: "PICTURES", total: 4, blank: 4 });
    expect(generateCardImage).toHaveBeenCalledTimes(4);

    const deck = await prisma.deck.findUniqueOrThrow({ where: { id: job.deckId! } });
    expect(deck.direction).toBe("PICTURE");
    const cards = await prisma.card.findMany({ where: { deckId: deck.id }, orderBy: { target: "asc" } });
    for (const c of cards) expect(c.cardType).toBe(CardType.PICTURE);
    expect(cards.map((c) => [c.target, c.imageUrl])).toEqual(
      ["banan", "plommon", "päron", "äpple"].sort().map((t) => [t, pictureOf(t)]),
    );
  });

  it("leaves a card blank when its picture fails, and still draws the rest", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(generateCardImage).mockImplementation(async ({ target }) =>
      target === "banan" ? null : pictureOf(target),
    );

    const job = await generate({ prompt: "fruit", count: 4, direction: "PICTURE" });
    expect(job.status).toBe("DONE");

    const cards = await prisma.card.findMany({ where: { deckId: job.deckId! } });
    const byTarget = new Map(cards.map((c) => [c.target, c.imageUrl]));
    expect(byTarget.get("banan")).toBeNull();
    expect(byTarget.get("äpple")).toBe(pictureOf("äpple"));
    expect(byTarget.get("plommon")).toBe(pictureOf("plommon"));
  });

  it("skips a card deleted before its picture lands", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(generateCardImage).mockImplementation(async ({ target }) => {
      if (target === "äpple") await prisma.card.deleteMany({ where: { target: "äpple" } });
      return pictureOf(target);
    });

    const job = await generate({ prompt: "fruit", count: 4, direction: "PICTURE" });
    expect(job.status).toBe("DONE");

    const cards = await prisma.card.findMany({ where: { deckId: job.deckId! } });
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c.imageUrl).toBe(pictureOf(c.target));
  });

  it("without GEMINI_API_KEY creates the picture cards with no picture", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(imagesAvailable).mockReturnValue(false);

    const job = await generate({ prompt: "fruit", count: 4, direction: "PICTURE" });
    expect(job).toMatchObject({ status: "DONE", created: 4 });

    const cards = await prisma.card.findMany({ where: { deckId: job.deckId! } });
    expect(cards).toHaveLength(4);
    for (const c of cards) expect(c).toMatchObject({ cardType: CardType.PICTURE, imageUrl: null });
    expect(generateCardImage).not.toHaveBeenCalled();
  });

  it("draws nothing for word cards", async () => {
    const user = await createUser();
    await createProfile(user);

    const job = await generate({ prompt: "fruit", count: 4, direction: "RECOGNITION" });
    expect(job).toMatchObject({ status: "DONE", created: 4 });

    expect(generateCardImage).not.toHaveBeenCalled();
    const cards = await prisma.card.findMany({ where: { deckId: job.deckId! } });
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
