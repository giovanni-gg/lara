// Server actions in src/app/actions.ts against the real database: deck
// nesting, moving and archiving (which always act on whole subtrees), the
// per-deck new-card limit, card creation, and profile settings.

import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  archiveDeck,
  createCard,
  createDeck,
  moveDeck,
  unarchiveDeck,
  updateDeckNewCardsPerDay,
  updateProfileSettings,
} from "@/app/actions";
import { CardType, FsrsState } from "@/generated/prisma/enums";
import { createDeck as makeDeck, createProfile, createUser } from "../factories";
import { RedirectError } from "./stubs/next-navigation";

// Never real TTS: pretend it's configured and returns a fixed URL.
vi.mock("@/lib/tts", () => ({
  ttsAvailable: () => true,
  trySynthesize: vi.fn(async () => "/api/media/tts-sv-fake.mp3"),
}));

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, String(v));
  return data;
}

async function setup() {
  const user = await createUser();
  const profile = await createProfile(user, { level: "A2", dailyNewLimit: 20, dailyReviewLimit: 200 });
  return { user, profile };
}

const archivedAtOf = async (id: string) => (await prisma.deck.findUniqueOrThrow({ where: { id } })).archivedAt;

/** root › mid › leaf, plus a separate deck. */
async function tree(profile: Awaited<ReturnType<typeof setup>>["profile"]) {
  const root = await makeDeck(profile, { name: "Root" });
  const mid = await makeDeck(profile, { name: "Mid", parent: root });
  const leaf = await makeDeck(profile, { name: "Leaf", parent: mid });
  const other = await makeDeck(profile, { name: "Other" });
  return { root, mid, leaf, other };
}

describe("createDeck", () => {
  it("creates a deck inside a parent and redirects to it", async () => {
    const { profile } = await setup();
    const parent = await makeDeck(profile);

    const attempt = createDeck(form({ name: " Verbs ", parentId: parent.id, direction: "BOTH" }));
    const redirect = await attempt.catch((e: unknown) => e);

    expect(redirect).toBeInstanceOf(RedirectError);
    const deck = await prisma.deck.findFirstOrThrow({ where: { name: "Verbs" } });
    expect((redirect as RedirectError).url).toBe(`/decks/${deck.id}`);
    expect(deck).toMatchObject({ parentId: parent.id, profileId: profile.id, direction: "BOTH", archivedAt: null });
  });

  it("archives a deck created inside an archived parent", async () => {
    const { profile } = await setup();
    const archivedAt = new Date(2026, 10, 1);
    const parent = await makeDeck(profile, { archivedAt });

    await expect(createDeck(form({ name: "Child", parentId: parent.id }))).rejects.toBeInstanceOf(RedirectError);

    expect((await prisma.deck.findFirstOrThrow({ where: { name: "Child" } })).archivedAt).toEqual(archivedAt);
  });
});

describe("moveDeck", () => {
  it("refuses to move a deck into itself or its own subtree", async () => {
    const { profile } = await setup();
    const { root, mid, leaf } = await tree(profile);

    for (const target of [root, mid, leaf]) {
      await expect(moveDeck(form({ deckId: root.id, parentId: target.id }))).rejects.toThrow(/own subdecks/);
    }
    expect((await prisma.deck.findUniqueOrThrow({ where: { id: root.id } })).parentId).toBeNull();
  });

  it("moves a deck, and back to the top level with an empty parent", async () => {
    const { profile } = await setup();
    const { mid, other } = await tree(profile);

    await moveDeck(form({ deckId: mid.id, parentId: other.id }));
    expect((await prisma.deck.findUniqueOrThrow({ where: { id: mid.id } })).parentId).toBe(other.id);

    await moveDeck(form({ deckId: mid.id, parentId: "" }));
    expect((await prisma.deck.findUniqueOrThrow({ where: { id: mid.id } })).parentId).toBeNull();
  });

  it("archives the whole moved subtree when the new parent is archived", async () => {
    const { profile } = await setup();
    const { mid, leaf, root } = await tree(profile);
    const archivedAt = new Date(2026, 10, 1);
    const attic = await makeDeck(profile, { archivedAt });

    await moveDeck(form({ deckId: mid.id, parentId: attic.id }));

    expect(await archivedAtOf(mid.id)).toEqual(archivedAt);
    expect(await archivedAtOf(leaf.id)).toEqual(archivedAt);
    expect(await archivedAtOf(root.id)).toBeNull();
  });
});

describe("archiveDeck / unarchiveDeck", () => {
  it("archive and unarchive the whole subtree and nothing else", async () => {
    const { profile } = await setup();
    const { root, mid, leaf, other } = await tree(profile);

    await archiveDeck(form({ deckId: mid.id }));
    expect(await archivedAtOf(mid.id)).not.toBeNull();
    expect(await archivedAtOf(leaf.id)).not.toBeNull();
    expect(await archivedAtOf(root.id)).toBeNull();
    expect(await archivedAtOf(other.id)).toBeNull();

    await unarchiveDeck(form({ deckId: mid.id }));
    expect(await archivedAtOf(mid.id)).toBeNull();
    expect(await archivedAtOf(leaf.id)).toBeNull();
    // Its parent wasn't archived, so it stays where it was.
    expect((await prisma.deck.findUniqueOrThrow({ where: { id: mid.id } })).parentId).toBe(root.id);
  });

  it("moves an unarchived deck to the top level when its parent is still archived", async () => {
    const { profile } = await setup();
    const { root, mid, leaf } = await tree(profile);
    await archiveDeck(form({ deckId: root.id }));

    await unarchiveDeck(form({ deckId: mid.id }));

    const moved = await prisma.deck.findUniqueOrThrow({ where: { id: mid.id } });
    expect(moved).toMatchObject({ parentId: null, archivedAt: null });
    expect(await archivedAtOf(leaf.id)).toBeNull();
    expect(await archivedAtOf(root.id)).not.toBeNull();
  });
});

describe("updateDeckNewCardsPerDay", () => {
  it.each([
    ["12", 12],
    ["-5", 0],
    ["5000", 999],
    ["7.6", 8],
  ])("stores %s as %i", async (input, stored) => {
    const { profile } = await setup();
    const deck = await makeDeck(profile);

    await updateDeckNewCardsPerDay(form({ deckId: deck.id, newCardsPerDay: input }));

    expect((await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } })).newCardsPerDay).toBe(stored);
  });

  it("rejects a non-number and another profile's deck", async () => {
    const { profile, user } = await setup();
    const deck = await makeDeck(profile);
    const otherProfile = await createProfile(user, { targetLanguage: "pt", isActive: false });
    const foreign = await makeDeck(otherProfile, { newCardsPerDay: 5 });

    await expect(updateDeckNewCardsPerDay(form({ deckId: deck.id, newCardsPerDay: "lots" }))).rejects.toThrow();
    await expect(updateDeckNewCardsPerDay(form({ deckId: foreign.id, newCardsPerDay: 50 }))).rejects.toThrow(
      "Deck not found",
    );
    expect((await prisma.deck.findUniqueOrThrow({ where: { id: foreign.id } })).newCardsPerDay).toBe(5);
  });
});

describe("createCard", () => {
  it("creates one RECOGNITION and one PRODUCTION card for direction BOTH, with audio", async () => {
    const { profile } = await setup();
    const deck = await makeDeck(profile);

    await createCard(
      form({ deckId: deck.id, target: " springa ", source: "to run", direction: "BOTH", targetSentence: "Jag springer." }),
    );

    const cards = await prisma.card.findMany({ where: { deckId: deck.id }, orderBy: { cardType: "asc" } });
    expect(cards.map((c) => c.cardType).sort()).toEqual([CardType.PRODUCTION, CardType.RECOGNITION]);
    for (const card of cards) {
      expect(card).toMatchObject({
        target: "springa",
        source: "to run",
        targetSentence: "Jag springer.",
        audioUrl: "/api/media/tts-sv-fake.mp3",
        state: FsrsState.NEW,
      });
    }
  });

  it("falls back to the deck's direction, and refuses a card without both sides", async () => {
    const { profile } = await setup();
    const deck = await makeDeck(profile, { direction: "PRODUCTION" });

    await createCard(form({ deckId: deck.id, target: "hej", source: "hello" }));
    await expect(createCard(form({ deckId: deck.id, target: "hej", source: " " }))).rejects.toThrow();

    const cards = await prisma.card.findMany({ where: { deckId: deck.id } });
    expect(cards.map((c) => c.cardType)).toEqual([CardType.PRODUCTION]);
  });
});

describe("updateProfileSettings", () => {
  it("changes only the level", async () => {
    const { profile } = await setup();

    await updateProfileSettings(form({ level: "B2", dailyNewLimit: 99, dailyReviewLimit: 1, targetLanguage: "pt" }));

    const after = await prisma.languageProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after).toEqual({ ...profile, level: "B2", updatedAt: after.updatedAt });
  });
});
