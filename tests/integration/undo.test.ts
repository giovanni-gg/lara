// The study screen's undo and pause: taking an answer back restores the card's
// schedule exactly and deletes its review; pausing (suspending) a card takes it
// out of queues and counts until it's resumed.

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  UndoError,
  buildQueue,
  profileStats,
  setCardSuspended,
  statsByDeck,
  submitReview,
  undoReview,
} from "@/lib/study";
import { RATINGS } from "@/lib/srs";
import { FsrsState } from "@/generated/prisma/enums";
import type { Card } from "@/generated/prisma/client";
import { POST as postUndo } from "@/app/api/reviews/undo/route";
import { POST as postReview } from "@/app/api/reviews/route";
import { POST as postSuspend } from "@/app/api/cards/[cardId]/suspend/route";
import { createCard, createDeck, createProfile, createReview, createUser, dueReview } from "../factories";

const NOW = new Date(2026, 10, 19, 12, 0);
const LATER = new Date(NOW.getTime() + 60_000);

/** Everything an answer may change on a card. */
function schedule(card: Card) {
  return {
    state: card.state,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learningSteps,
    lastReview: card.lastReview,
    tags: card.tags,
    suspended: card.suspended,
  };
}

async function setup(overrides: Parameters<typeof createCard>[1] = {}) {
  const user = await createUser();
  const profile = await createProfile(user);
  const deck = await createDeck(profile);
  const card = await createCard(deck, overrides);
  return { user, profile, deck, card };
}

const reload = (card: Pick<Card, "id">) => prisma.card.findUniqueOrThrow({ where: { id: card.id } });

describe("undoReview", () => {
  it.each([
    ["a new card answered Good (NEW → LEARNING)", {}, RATINGS.GOOD],
    ["a review card answered Again (REVIEW → RELEARNING, a lapse)", dueReview(NOW), RATINGS.AGAIN],
    ["a review card answered Easy", dueReview(NOW, 3), RATINGS.EASY],
  ] as const)("takes back %s exactly, deleting the review", async (_, overrides, rating) => {
    const { user, card } = await setup(overrides);
    const before = schedule(card);

    const { card: graded, reviewId } = await submitReview({ userId: user.id, cardId: card.id, rating, now: NOW });
    expect(schedule(graded)).not.toEqual(before);
    if (rating === RATINGS.AGAIN) expect(graded).toMatchObject({ state: FsrsState.RELEARNING, lapses: card.lapses + 1 });

    const restored = await undoReview({ userId: user.id, reviewId, now: LATER });

    expect(schedule(await reload(card))).toEqual(before);
    expect(await prisma.review.count({ where: { cardId: card.id } })).toBe(0);
    // In the session's shape, ready to show again.
    expect(restored).toMatchObject({ id: card.id, state: before.state, deckId: card.deckId });
    expect(Object.keys(restored.intervals)).toEqual(["1", "2", "3", "4"]);
  });

  it("removes the leech tag the answer added, keeping the card's other tags", async () => {
    const { user, card } = await setup({ ...dueReview(NOW), lapses: 7, tags: ["verb"] });

    const { card: graded, reviewId } = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.AGAIN, now: NOW });
    expect(graded.tags).toEqual(["verb", "leech"]);

    await undoReview({ userId: user.id, reviewId, now: LATER });
    expect(schedule(await reload(card))).toEqual(schedule(card));
  });

  it("keeps a leech tag the card already had", async () => {
    const { user, card } = await setup({ ...dueReview(NOW), lapses: 11, tags: ["leech"] });

    const { card: graded, reviewId } = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.AGAIN, now: NOW });
    expect(graded).toMatchObject({ lapses: 12, tags: ["leech"] });

    await undoReview({ userId: user.id, reviewId, now: LATER });
    expect((await reload(card)).tags).toEqual(["leech"]);
  });

  it("steps back over several answers to one card, newest first, but not out of order", async () => {
    const { user, card } = await setup();
    const first = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.AGAIN, now: NOW });
    const second = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.GOOD, now: LATER });

    await expect(undoReview({ userId: user.id, reviewId: first.reviewId })).rejects.toMatchObject({ status: 409 });

    await undoReview({ userId: user.id, reviewId: second.reviewId });
    expect(schedule(await reload(card))).toEqual(schedule(first.card));
    await undoReview({ userId: user.id, reviewId: first.reviewId });
    expect(schedule(await reload(card))).toEqual(schedule(card));
  });

  it("refuses another user's review as not found, leaving it alone", async () => {
    const { card } = await setup();
    const stranger = await createUser({ email: "stranger@lara.local" });
    const theirDeck = await createDeck(await createProfile(stranger));
    const theirCard = await createCard(theirDeck);
    const { card: graded, reviewId } = await submitReview({
      userId: stranger.id,
      cardId: theirCard.id,
      rating: RATINGS.GOOD,
      now: NOW,
    });

    await expect(undoReview({ userId: card.userId, reviewId })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.review.count({ where: { id: reviewId } })).toBe(1);
    expect(schedule(await reload(theirCard))).toEqual(schedule(graded));
  });

  it("refuses a review imported from Anki", async () => {
    const { user, card } = await setup(dueReview(NOW));
    const review = await createReview(card, { ankiId: BigInt(1_700_000_000_000), reviewedAt: NOW });

    const error = await undoReview({ userId: user.id, reviewId: review.id }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UndoError);
    expect(error).toMatchObject({ status: 409 });
    expect(await prisma.review.count()).toBe(1);
  });

  it("refuses a Lara review from before undo existed (no prior state kept)", async () => {
    const { user, card } = await setup(dueReview(NOW));
    const review = await createReview(card, { reviewedAt: NOW });
    await expect(undoReview({ userId: user.id, reviewId: review.id })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses once the card's schedule has changed since the answer", async () => {
    const { user, card } = await setup();
    const { reviewId } = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.GOOD, now: NOW });
    await prisma.card.update({ where: { id: card.id }, data: { state: FsrsState.NEW, due: NOW } });

    await expect(undoReview({ userId: user.id, reviewId })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.review.count()).toBe(1);
  });

  it("gives back today's new-card allowance and the review tally", async () => {
    const { user, profile, deck, card } = await setup();
    await createCard(deck);
    await prisma.deck.update({ where: { id: deck.id }, data: { newCardsPerDay: 2 } });

    const { reviewId } = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.GOOD, now: NOW });
    expect((await statsByDeck(profile.id, LATER)).get(deck.id)).toMatchObject({ newToday: 1, fresh: 1 });
    expect(await profileStats(profile.id, LATER)).toMatchObject({ newToday: 1, reviewedToday: 1 });

    await undoReview({ userId: user.id, reviewId, now: LATER });

    expect((await statsByDeck(profile.id, LATER)).get(deck.id)).toMatchObject({ newToday: 2, fresh: 2 });
    expect(await profileStats(profile.id, LATER)).toMatchObject({ newToday: 2, reviewedToday: 0 });
    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: LATER });
    expect(queue.map((c) => c.id)).toContain(card.id);
  });
});

describe("POST /api/reviews/undo", () => {
  const undo = (body: unknown) =>
    postUndo(new Request("http://t/api/reviews/undo", { method: "POST", body: JSON.stringify(body) }));
  const answer = (body: unknown) =>
    postReview(new Request("http://t/api/reviews", { method: "POST", body: JSON.stringify(body) }));

  it("undoes the answer /api/reviews just saved, by the id it returned; a second undo is a 404", async () => {
    const { card } = await setup(dueReview(new Date()));

    const answered = await answer({ cardId: card.id, rating: 1 });
    const { reviewId } = await answered.json();
    expect(typeof reviewId).toBe("string");

    const res = await undo({ reviewId });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, card: { id: card.id, state: FsrsState.REVIEW } });
    expect(schedule(await reload(card))).toEqual(schedule(card));

    const again = await undo({ reviewId });
    expect(again.status).toBe(404);
  });

  it("answers 409 for an Anki review and 400 for a bad body", async () => {
    const { card } = await setup(dueReview(new Date()));
    const review = await createReview(card, { ankiId: BigInt(42) });

    expect((await undo({ reviewId: review.id })).status).toBe(409);
    expect((await undo({})).status).toBe(400);
  });
});

describe("pausing a card", () => {
  const suspend = (cardId: string, body: unknown) =>
    postSuspend(new Request(`http://t/api/cards/${cardId}/suspend`, { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ cardId }),
    });

  it("takes it out of the queue and counts, and resuming brings it back", async () => {
    const { user, profile, deck, card } = await setup(dueReview(NOW));
    const other = await createCard(deck);
    const queueIds = async () =>
      (await buildQueue({ userId: user.id, profileId: profile.id, now: NOW })).map((c) => c.id);

    expect((await suspend(card.id, { suspended: true })).status).toBe(200);
    expect((await reload(card)).suspended).toBe(true);
    expect(await queueIds()).toEqual([other.id]);
    expect((await statsByDeck(profile.id, NOW)).get(deck.id)).toMatchObject({ total: 1, due: 0 });

    // Idempotent: a retried request changes nothing.
    expect((await suspend(card.id, { suspended: true })).status).toBe(200);

    expect((await suspend(card.id, { suspended: false })).status).toBe(200);
    expect(schedule(await reload(card))).toEqual(schedule(card));
    expect(await queueIds()).toEqual([card.id, other.id]);
    expect((await statsByDeck(profile.id, NOW)).get(deck.id)).toMatchObject({ total: 2, due: 1 });
  });

  it("only touches the user's own cards", async () => {
    await createUser();
    const stranger = await createUser({ email: "stranger@lara.local" });
    const theirCard = await createCard(await createDeck(await createProfile(stranger)));

    expect((await suspend(theirCard.id, { suspended: true })).status).toBe(404);
    expect((await reload(theirCard)).suspended).toBe(false);
    expect(await setCardSuspended({ userId: stranger.id, cardId: theirCard.id, suspended: true })).toBe(true);
    expect(await setCardSuspended({ userId: "someone-else", cardId: theirCard.id, suspended: false })).toBe(false);
    expect((await reload(theirCard)).suspended).toBe(true);
  });

  it("rejects a malformed body", async () => {
    const { card } = await setup();
    expect((await suspend(card.id, { suspended: "yes" })).status).toBe(400);
  });
});
