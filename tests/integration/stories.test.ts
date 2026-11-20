// Writing a story as a server-side job: POST /api/stories/generate saves a
// DRAFT placeholder and answers 202; `writeStory` runs in `after()` (here
// `settleAfter()`) and fills that row in, READY with its sentences, or marks it
// FAILED. The model and TTS are mocked; the route, src/lib/stories.ts and the
// rows they read and write are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/stories/generate/route";
import { generateStory, type GeneratedStory } from "@/lib/ai/stories";
import { MAX_STORIES_IN_PROGRESS, STORY_STALE_AFTER_MS, storyState } from "@/lib/stories";
import { nextLevelUp } from "@/lib/languages";
import type { LanguageProfile } from "@/generated/prisma/client";
import { createCard, createDeck, createProfile, createUser } from "../factories";
import { settleAfter } from "./stubs/next-server";

vi.mock("@/lib/ai/stories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/stories")>()),
  generateStory: vi.fn(),
}));
vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/model")>()),
  hasAiCredentials: () => true,
}));
vi.mock("@/lib/tts", () => ({ ttsAvailable: () => false, trySynthesize: vi.fn(async () => null) }));

const STORY: GeneratedStory = {
  title: "Katten och äpplet",
  titleTranslated: "The cat and the apple",
  segments: [
    { target: "Katten är hungrig. ", translation: "The cat is hungry." },
    { target: "Den äter ett äpple.", translation: "It eats an apple." },
    { target: "   ", translation: "(dropped: no text)" },
  ],
  reusedVocabulary: ["katt"],
  newVocabulary: ["hungrig"],
};

function generate(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/stories/generate", { method: "POST", body: JSON.stringify(body) }),
  );
}

/** A DRAFT placeholder written straight to the table, as queueStory leaves one. */
function draftStory(profile: LanguageProfile, createdAt = new Date()) {
  return prisma.article.create({
    data: {
      userId: profile.userId,
      profileId: profile.id,
      kind: "STORY",
      status: "DRAFT",
      title: "Writing your story…",
      level: "B1",
      body: "",
      createdAt,
    },
  });
}

/** What the route passed to the model on its only call. */
const modelInput = () => vi.mocked(generateStory).mock.calls[0][0];

beforeEach(() => {
  vi.mocked(generateStory).mockImplementation(async ({ level }) => ({
    story: STORY,
    level: nextLevelUp(level),
    targetWords: 250,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/stories/generate", () => {
  it("answers 202 with a DRAFT placeholder, then writes it READY with its sentences", async () => {
    const user = await createUser();
    await createProfile(user, { level: "A2" });

    const res = await generate({ prompt: "  a hungry cat  ", length: "short", withAudio: false });
    expect(res.status).toBe(202);
    const { id, status } = await res.json();
    expect(status).toBe("writing");

    // Nothing has run yet: a placeholder at the next level up, no model call.
    expect(generateStory).not.toHaveBeenCalled();
    const draft = await prisma.article.findUniqueOrThrow({ where: { id } });
    expect(draft).toMatchObject({
      status: "DRAFT",
      kind: "STORY",
      level: "B1",
      topic: "a hungry cat",
      sourcePrompt: "a hungry cat",
      deckId: null,
      body: "",
    });
    expect(storyState(draft)).toBe("writing");

    await settleAfter();

    expect(modelInput()).toMatchObject({ prompt: "a hungry cat", length: "short", level: "A2" });
    const story = await prisma.article.findUniqueOrThrow({
      where: { id },
      include: { segments: { orderBy: { index: "asc" } } },
    });
    expect(story).toMatchObject({
      status: "READY",
      title: "Katten och äpplet",
      titleTranslated: "The cat and the apple",
      level: "B1",
      body: "Katten är hungrig. Den äter ett äpple.",
      wordCount: 7,
      reusedVocabulary: ["katt"],
      newVocabulary: ["hungrig"],
    });
    // Blank sentences are dropped; the rest are trimmed and indexed in order.
    expect(story.segments.map((s) => [s.index, s.target, s.translation])).toEqual([
      [0, "Katten är hungrig.", "The cat is hungry."],
      [1, "Den äter ett äpple.", "It eats an apple."],
    ]);
    expect(storyState(story)).toBe("ready");
  });

  it("marks the story FAILED when the model fails", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(generateStory).mockRejectedValue(new Error("model overloaded"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { id } = await (await generate({ withAudio: false })).json();
    await settleAfter();

    const story = await prisma.article.findUniqueOrThrow({ where: { id }, include: { segments: true } });
    expect(story.status).toBe("FAILED");
    expect(story.segments).toEqual([]);
    expect(storyState(story)).toBe("failed");
  });

  it(`refuses a story beyond ${MAX_STORIES_IN_PROGRESS} in progress`, async () => {
    const user = await createUser();
    await createProfile(user);

    for (let i = 0; i < MAX_STORIES_IN_PROGRESS; i++) {
      expect((await generate({ withAudio: false })).status).toBe(202);
    }
    const res = await generate({ withAudio: false });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already being written/);
    expect(await prisma.article.count()).toBe(MAX_STORIES_IN_PROGRESS);
  });

  it("stops counting a draft that went stale, and shows it as failed", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const stale = await draftStory(profile, new Date(Date.now() - STORY_STALE_AFTER_MS - 60_000));
    for (let i = 1; i < MAX_STORIES_IN_PROGRESS; i++) await draftStory(profile);

    // Two live drafts plus a stale one: there is still room for a third.
    expect((await generate({ withAudio: false })).status).toBe(202);
    expect((await generate({ withAudio: false })).status).toBe(400);

    expect(storyState(stale)).toBe("failed");
    expect(storyState(await draftStory(profile))).toBe("writing");
  });

  it("builds a story from a deck's non-archived subtree and records the deck", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const food = await createDeck(profile, { name: "Mat" });
    const fruit = await createDeck(profile, { name: "Frukt", parent: food });
    const oldFruit = await createDeck(profile, { name: "Gammalt", parent: food, archivedAt: new Date() });
    const verbs = await createDeck(profile, { name: "Verb" });
    await createCard(food, { target: "bröd", source: "bread", reps: 3 });
    await createCard(food, { target: "ost", source: "cheese" });
    await createCard(food, { target: "smör", source: "butter", suspended: true });
    await createCard(fruit, { target: "äpple", source: "apple", reps: 1 });
    await createCard(oldFruit, { target: "plommon", source: "plum", reps: 2 });
    await createCard(verbs, { target: "springa", source: "to run", reps: 5 });

    const res = await generate({ deckId: food.id, length: "short", withAudio: false });
    expect(res.status).toBe(202);
    const { id } = await res.json();
    expect(await prisma.article.findUniqueOrThrow({ where: { id } })).toMatchObject({
      deckId: food.id,
      topic: "Mat",
      sourcePrompt: null,
    });

    await settleAfter();

    const { deck, knownVocabulary } = modelInput();
    expect(deck?.label).toBe("Mat");
    // Studied and unstudied words from Mat and Frukt only: not the archived
    // subdeck, not the suspended card, not another deck.
    expect(deck?.studied.map((w) => w.target).sort()).toEqual(["bröd", "äpple"]);
    expect(deck?.unstudied).toEqual([{ target: "ost", source: "cheese" }]);
    // The background list is the learner's other known words, minus the deck's.
    expect(knownVocabulary).toEqual(["springa"]);

    expect(await prisma.article.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "READY",
      deckId: food.id,
      topic: "Mat",
    });
  });

  it("refuses a deck with no cards before queueing anything", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const empty = await createDeck(profile);

    const res = await generate({ deckId: empty.id });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That deck has no cards yet");
    expect(await prisma.article.count()).toBe(0);
  });
});
