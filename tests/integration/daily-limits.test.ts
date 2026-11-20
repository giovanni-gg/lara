// Daily caps for every account but the owner's (src/lib/limits.ts): 100 AI
// cards and 5 stories per study day, which starts at 04:00. The routes and
// lib functions are real; the AI is mocked so nothing reaches a model.
//
// The session user is TEST_USER_EMAIL (LARA_USER_EMAIL). With LARA_OWNER_EMAIL
// unset that user IS the owner; pointing LARA_OWNER_EMAIL elsewhere makes the
// session user a limited invitee.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST as generateCardsRoute } from "@/app/api/decks/generate/route";
import { POST as generateStoryRoute } from "@/app/api/stories/generate/route";
import { generateCards } from "@/lib/ai/cards";
import { generateStory } from "@/lib/ai/stories";
import { cardsLeftToday, storiesLeftToday } from "@/lib/allowance";
import { queueCardJob } from "@/lib/card-jobs";
import { queueStory, StoryInputError } from "@/lib/stories";
import { DAILY_CARD_LIMIT, DAILY_STORY_LIMIT } from "@/lib/limits";
import type { LanguageProfile, User } from "@/generated/prisma/client";
import { createCard, createCardJob, createDeck, createProfile, createUser } from "../factories";
import { settleAfter } from "./stubs/next-server";

vi.mock("@/lib/ai/cards", () => ({ generateCards: vi.fn() }));
vi.mock("@/lib/ai/stories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/stories")>()),
  generateStory: vi.fn(),
}));
vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/model")>()),
  hasAiCredentials: () => true,
}));
vi.mock("@/lib/tts", () => ({ ttsAvailable: () => false, trySynthesize: vi.fn(async () => null) }));
vi.mock("@/lib/images", () => ({ generateCardImage: vi.fn(async () => null), imagesAvailable: () => false }));

const post = (route: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  route(new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }));
const generate = (body: Record<string, unknown>) => post(generateCardsRoute, { withAudio: false, ...body });
const writeStory = (body: Record<string, unknown> = {}) => post(generateStoryRoute, { withAudio: false, ...body });

/** Makes the session user a limited account: the owner is someone else. */
const limited = () => {
  process.env.LARA_OWNER_EMAIL = "you@lara.local";
};

let savedOwner: string | undefined;
let user: User;
let profile: LanguageProfile;

beforeEach(async () => {
  savedOwner = process.env.LARA_OWNER_EMAIL;
  delete process.env.LARA_OWNER_EMAIL;
  user = await createUser();
  profile = await createProfile(user);
  // One new word per call: a repeat would be skipped as a duplicate.
  let calls = 0;
  vi.mocked(generateCards).mockImplementation(async () => ({
    deckName: "Feelings",
    emoji: "🙂",
    cards: [{ target: `ord ${++calls}`, source: "word", targetSentence: "", sourceSentence: "", notes: "", tags: [] }],
  }));
});

afterEach(() => {
  if (savedOwner === undefined) delete process.env.LARA_OWNER_EMAIL;
  else process.env.LARA_OWNER_EMAIL = savedOwner;
  vi.clearAllMocks();
});

/** A finished story row (not DRAFT, so the 3-in-progress rule stays out of the way). */
function story(status: "READY" | "FAILED", createdAt = new Date()) {
  return prisma.article.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      kind: "STORY",
      status,
      title: "En berättelse",
      level: "B1",
      body: "",
      createdAt,
    },
  });
}

const input = (count: number, extra: { deckId?: string } = {}) => ({
  userId: user.id,
  email: user.email,
  profile,
  prompt: "feelings",
  count,
  withAudio: false,
  ...extra,
});

describe("AI cards: 100 a day for everyone but the owner", () => {
  it("doesn't limit the owner", async () => {
    await createCardJob(profile, { status: "DONE", count: 40, created: 150 });
    expect(await cardsLeftToday(user)).toBeNull();

    const res = await generate({ prompt: "feelings", count: 40 });
    expect(res.status).toBe(202);
  });

  it("refuses a batch that would go past 100, saying how many are left", async () => {
    limited();
    await createCardJob(profile, { status: "DONE", count: 40, created: 77 });
    expect(await cardsLeftToday(user)).toBe(23);

    const refused = await generate({ prompt: "feelings", count: 25 });
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toBe(
      "Daily limit reached: you can create 100 cards a day. 23 left today.",
    );
    expect(await prisma.cardJob.count()).toBe(1);
    expect(generateCards).not.toHaveBeenCalled();

    // A batch that fits is fine; then the day is used up (77 + 15 + 5 + 3 = 100).
    expect((await generate({ prompt: "feelings", count: 15 })).status).toBe(202);
    expect((await generate({ prompt: "feelings", count: 5 })).status).toBe(202);
    expect(await cardsLeftToday(user)).toBe(3);
    const last = await generate({ prompt: "feelings", count: 5 });
    expect((await last.json()).error).toBe("Daily limit reached: you can create 100 cards a day. 3 left today.");
  });

  it("holds the whole batch of jobs still running, so parallel jobs can't overshoot", async () => {
    limited();
    expect((await generate({ prompt: "feelings", count: 40 })).status).toBe(202);
    expect((await generate({ prompt: "food", count: 40 })).status).toBe(202);

    // Both are still queued (nothing has run), yet both count in full.
    const third = await generate({ prompt: "weather", count: 25 });
    expect(third.status).toBe(429);
    expect((await third.json()).error).toContain("20 left today.");

    // Once they finish, only the cards they made count (1 each, here).
    await settleAfter();
    expect(await prisma.cardJob.findMany({ select: { status: true, created: true } })).toEqual([
      { status: "DONE", created: 1 },
      { status: "DONE", created: 1 },
    ]);
    expect(await cardsLeftToday(user)).toBe(98);
  });

  it("counts both cards of a word in a Both deck", async () => {
    limited();
    const deck = await createDeck(profile, { direction: "BOTH" });
    await createCardJob(profile, { status: "DONE", created: 80 });

    const res = await generate({ deckId: deck.id, count: 15 });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Daily limit reached: you can create 100 cards a day. 20 left today. This deck makes 2 cards per word.",
    );
    expect((await generate({ deckId: deck.id, count: 10 })).status).toBe(202);

    // A running job in that deck holds two cards per word.
    expect(await cardsLeftToday(user)).toBe(0);
  });

  it("never counts imported or hand-made cards", async () => {
    limited();
    const deck = await createDeck(profile);
    await prisma.card.createMany({
      data: Array.from({ length: 150 }, (_, i) => ({
        userId: user.id,
        deckId: deck.id,
        target: `ord ${i}`,
        source: `word ${i}`,
        ankiId: BigInt(1000 + i),
      })),
    });
    await createCard(deck);

    expect(await cardsLeftToday(user)).toBe(DAILY_CARD_LIMIT);
  });

  it("starts again at 04:00", async () => {
    limited();
    await createCardJob(profile, { status: "DONE", created: 100, createdAt: new Date("2026-03-10T03:59:00") });

    // Still the study day that began at 04:00 on the 9th: nothing left.
    const before = new Date("2026-03-10T03:59:30");
    expect(await cardsLeftToday(user, before)).toBe(0);
    await expect(queueCardJob(input(1), before)).rejects.toMatchObject({ status: 429 });

    // A new study day.
    const after = new Date("2026-03-10T04:00:00");
    expect(await cardsLeftToday(user, after)).toBe(DAILY_CARD_LIMIT);
    await expect(queueCardJob(input(40), after)).resolves.toMatchObject({ count: 40 });
  });
});

describe("Stories: 5 a day for everyone but the owner", () => {
  it("doesn't limit the owner", async () => {
    for (let i = 0; i < 6; i++) await story("READY");
    expect(await storiesLeftToday(user)).toBeNull();
    expect((await writeStory()).status).toBe(202);
  });

  it("refuses the 6th story of the day, failed ones included", async () => {
    limited();
    await story("READY");
    await story("READY");
    await story("FAILED");
    await story("READY");
    expect(await storiesLeftToday(user)).toBe(1);

    expect((await writeStory()).status).toBe(202);
    const sixth = await writeStory();
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error).toBe(
      "Daily limit reached: you can write 5 stories a day. It resets at 04:00.",
    );
    expect(await prisma.article.count()).toBe(DAILY_STORY_LIMIT);
    expect(generateStory).not.toHaveBeenCalled();
  });

  it("starts again at 04:00", async () => {
    limited();
    for (let i = 0; i < 5; i++) await story("READY", new Date("2026-03-10T03:5" + i + ":00"));

    const before = new Date("2026-03-10T03:59:30");
    expect(await storiesLeftToday(user, before)).toBe(0);
    const refused = queueStory({ ...input(1), length: "short" }, before);
    await expect(refused).rejects.toBeInstanceOf(StoryInputError);
    await expect(refused).rejects.toMatchObject({ status: 429 });

    const after = new Date("2026-03-10T04:00:00");
    expect(await storiesLeftToday(user, after)).toBe(DAILY_STORY_LIMIT);
    await expect(queueStory({ ...input(1), length: "short" }, after)).resolves.toEqual(expect.any(String));
  });
});
