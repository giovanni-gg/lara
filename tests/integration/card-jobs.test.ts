// "Generate with AI" as a server-side job: the route records a CardJob and
// answers 202 at once; the cards are made in `after()` (run here by the
// next/server stub's `settleAfter()`), and /api/card-jobs reports progress to
// the status pill. The AI, TTS and image model are mocked; the route, the job
// runner and the rows they write are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/decks/generate/route";
import { GET } from "@/app/api/card-jobs/route";
import { generateCards } from "@/lib/ai/cards";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { CARD_JOB_STALE_AFTER_MS, STALE_ERROR, type CardJobView } from "@/lib/card-job-status";
import { createCardJob, createDeck, createProfile, createUser } from "../factories";
import { settleAfter } from "./stubs/next-server";

vi.mock("@/lib/ai/cards", () => ({ generateCards: vi.fn() }));
vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/model")>()),
  hasAiCredentials: () => true,
}));
vi.mock("@/lib/tts", () => ({ ttsAvailable: vi.fn(() => false), trySynthesize: vi.fn(async () => null) }));
vi.mock("@/lib/images", () => ({ generateCardImage: vi.fn(async () => null), imagesAvailable: () => false }));

const card = (target: string, source: string) => ({
  target,
  source,
  targetSentence: "",
  sourceSentence: "",
  notes: "",
  tags: [],
});

function generate(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/decks/generate", { method: "POST", body: JSON.stringify(body) }),
  );
}

async function jobs(): Promise<CardJobView[]> {
  return (await (await GET()).json()).jobs;
}

beforeEach(() => {
  vi.mocked(ttsAvailable).mockReturnValue(false);
  vi.mocked(trySynthesize).mockResolvedValue(null);
  vi.mocked(generateCards).mockResolvedValue({
    deckName: "Feelings",
    emoji: "🙂",
    cards: [card("glad", "happy"), card("ledsen", "sad"), card("arg", "angry")],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/decks/generate queues a job", () => {
  it("answers 202 at once, then makes the cards and marks the job DONE", async () => {
    const user = await createUser();
    await createProfile(user);

    const res = await generate({ prompt: "feelings", count: 3 });
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data).toMatchObject({ id: expect.any(String), deckId: null });
    expect(data.job).toMatchObject({ phase: "running", text: "Writing 3 cards for “feelings”…" });

    // Nothing has run yet: no model call, no deck.
    expect(generateCards).not.toHaveBeenCalled();
    expect(await prisma.deck.count()).toBe(0);
    expect(await prisma.cardJob.findUniqueOrThrow({ where: { id: data.id } })).toMatchObject({
      status: "QUEUED",
      prompt: "feelings",
      count: 3,
    });

    await settleAfter();

    const job = await prisma.cardJob.findUniqueOrThrow({ where: { id: data.id } });
    expect(job).toMatchObject({ status: "DONE", created: 3, deckName: "Feelings", error: null });
    const cards = await prisma.card.findMany({ where: { deckId: job.deckId! } });
    expect(cards.map((c) => c.target).sort()).toEqual(["arg", "glad", "ledsen"]);

    const [view] = await jobs();
    expect(view).toMatchObject({ id: data.id, phase: "done", deckId: job.deckId, text: "3 new cards in Feelings" });
  });

  it("names an existing deck from the start and adds to it", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const deck = await createDeck(profile, { name: "Adjectives" });

    const data = await (await generate({ count: 3, deckId: deck.id })).json();
    expect(data).toMatchObject({ deckId: deck.id, job: { text: "Writing 3 cards for Adjectives…" } });

    await settleAfter();
    expect(await prisma.card.count({ where: { deckId: deck.id } })).toBe(3);
    expect(await prisma.cardJob.findUniqueOrThrow({ where: { id: data.id } })).toMatchObject({
      status: "DONE",
      created: 3,
    });
  });

  it("records audio progress, one word at a time", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(ttsAvailable).mockReturnValue(true);
    const seen: [string, number, number][] = [];
    vi.mocked(trySynthesize).mockImplementation(async ({ text }) => {
      const job = await prisma.cardJob.findFirstOrThrow();
      seen.push([job.status, job.done, job.total]);
      return `/api/media/${encodeURIComponent(text)}.mp3`;
    });

    const data = await (await generate({ prompt: "feelings", count: 3 })).json();
    await settleAfter();

    expect(seen).toEqual([
      ["AUDIO", 0, 3],
      ["AUDIO", 1, 3],
      ["AUDIO", 2, 3],
    ]);
    const job = await prisma.cardJob.findUniqueOrThrow({ where: { id: data.id } });
    expect(job).toMatchObject({ status: "DONE", created: 3 });
    const cards = await prisma.card.findMany({ where: { deckId: job.deckId! } });
    for (const c of cards) expect(c.audioUrl).toBe(`/api/media/${encodeURIComponent(c.target)}.mp3`);
  });

  it("records a failure with its reason, and leaves no empty deck behind", async () => {
    const user = await createUser();
    await createProfile(user);
    vi.mocked(generateCards).mockRejectedValue(new Error("The model is overloaded"));

    const res = await generate({ prompt: "feelings", count: 3 });
    expect(res.status).toBe(202);
    const { id } = await res.json();
    await settleAfter();

    expect(await prisma.cardJob.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "FAILED",
      error: "The model is overloaded",
    });
    expect(await prisma.deck.count()).toBe(0);
    const [view] = await jobs();
    expect(view).toMatchObject({ phase: "failed", text: "The model is overloaded", prompt: "feelings", count: 3 });
  });

  it("refuses a 4th job while 3 are in progress, without calling the model", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    await createCardJob(profile, { status: "QUEUED" });
    await createCardJob(profile, { status: "AUDIO" });
    await createCardJob(profile, { status: "PICTURES" });
    // Finished ones don't count.
    await createCardJob(profile, { status: "DONE" });
    await createCardJob(profile, { status: "FAILED" });

    const res = await generate({ prompt: "feelings", count: 3 });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/already being made/);
    expect(await prisma.cardJob.count()).toBe(5);

    await settleAfter();
    expect(generateCards).not.toHaveBeenCalled();
  });

  it("marks a lost job FAILED, and doesn't let it hold a slot", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const long = new Date(Date.now() - CARD_JOB_STALE_AFTER_MS - 60_000);
    const lost = await createCardJob(profile, { status: "AUDIO", createdAt: long });
    await createCardJob(profile, { status: "WRITING", createdAt: long });
    await createCardJob(profile, { status: "WRITING" });
    await createCardJob(profile, { status: "WRITING" });

    // Even before anything sweeps it, the endpoint reports it failed.
    const before = (await jobs()).find((j) => j.id === lost.id);
    expect(before).toMatchObject({ phase: "failed", text: STALE_ERROR });

    const res = await generate({ prompt: "feelings", count: 3 });
    expect(res.status).toBe(202);
    expect(await prisma.cardJob.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({
      status: "FAILED",
      error: STALE_ERROR,
    });
  });

  it("answers 404 for a deck that isn't the learner's, and records no job", async () => {
    const user = await createUser();
    await createProfile(user);
    const other = await createUser({ email: "other@lara.local" });
    const theirs = await createDeck(await createProfile(other), { name: "Theirs" });

    const res = await generate({ count: 3, deckId: theirs.id });
    expect(res.status).toBe(404);
    expect(await prisma.cardJob.count()).toBe(0);
  });
});

describe("GET /api/card-jobs", () => {
  it("returns only the current learner's jobs", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const other = await createUser({ email: "other@lara.local" });
    const otherProfile = await createProfile(other);
    const mine = await createCardJob(profile, { deckName: "Mine" });
    await createCardJob(otherProfile, { deckName: "Theirs" });

    const views = await jobs();
    expect(views.map((j) => j.id)).toEqual([mine.id]);
    expect(views[0]).toMatchObject({ phase: "running", text: "Writing 5 cards for Mine…" });
  });

  it("leaves out jobs from long ago", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    await createCardJob(profile, { status: "DONE", createdAt: new Date(Date.now() - 60 * 60_000) });
    const recent = await createCardJob(profile, { status: "DONE", created: 2 });

    expect((await jobs()).map((j) => j.id)).toEqual([recent.id]);
  });
});
