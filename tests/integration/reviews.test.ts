// Answering a card: the review log, leech tagging, the duration cap, the
// day-boundary due date, and the API route the study screen calls.

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { submitReview } from "@/lib/study";
import { RATINGS, SCHEDULER_SETTINGS } from "@/lib/srs";
import { FsrsState } from "@/generated/prisma/enums";
import { POST } from "@/app/api/reviews/route";
import { createCard, createDeck, createProfile, createUser, dueReview } from "../factories";

const NOW = new Date(2026, 10, 19, 12, 0);

async function reviewCard(overrides: Parameters<typeof createCard>[1] = {}, now = NOW) {
  const user = await createUser();
  const profile = await createProfile(user);
  const deck = await createDeck(profile);
  const card = await createCard(deck, { ...dueReview(now), ...overrides });
  return { user, card };
}

describe("submitReview", () => {
  it("updates the card and appends one review row", async () => {
    const { user, card } = await reviewCard();

    const updated = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.GOOD, durationMs: 4200, now: NOW });

    expect(updated).toMatchObject({ state: FsrsState.REVIEW, reps: card.reps + 1, lastReview: NOW });
    const reviews = await prisma.review.findMany({ where: { cardId: card.id } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      userId: user.id,
      rating: RATINGS.GOOD,
      state: FsrsState.REVIEW,
      durationMs: 4200,
      reviewedAt: NOW,
      due: updated.due,
      ankiId: null,
    });
  });

  it("puts a review-state due date on a 04:00 study-day boundary", async () => {
    const { user, card } = await reviewCard();

    const updated = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.GOOD, now: NOW });

    expect(updated.due > NOW).toBe(true);
    expect([updated.due.getHours(), updated.due.getMinutes(), updated.due.getSeconds(), updated.due.getMilliseconds()]).toEqual([
      SCHEDULER_SETTINGS.dayStartsAtHour,
      0,
      0,
      0,
    ]);
  });

  it("tags a card as a leech on its 8th lapse, without suspending it or dropping its tags", async () => {
    const { user, card } = await reviewCard({ lapses: 7, tags: ["verb"] });

    const updated = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.AGAIN, now: NOW });

    expect(updated.lapses).toBe(8);
    expect(updated.tags).toEqual(["verb", "leech"]);
    expect(updated.suspended).toBe(false);
  });

  it("doesn't tag before the threshold", async () => {
    const { user, card } = await reviewCard({ lapses: 6 });
    const updated = await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.AGAIN, now: NOW });
    expect(updated.lapses).toBe(7);
    expect(updated.tags).toEqual([]);
  });

  it("logs an answer longer than 60 s as 60 s", async () => {
    const { user, card } = await reviewCard();

    await submitReview({ userId: user.id, cardId: card.id, rating: RATINGS.GOOD, durationMs: 10 * 60_000, now: NOW });

    const review = await prisma.review.findFirstOrThrow({ where: { cardId: card.id } });
    expect(review.durationMs).toBe(60_000);
  });

  it("refuses another user's card", async () => {
    const { card } = await reviewCard();
    const stranger = await createUser({ email: "stranger@lara.local" });

    await expect(submitReview({ userId: stranger.id, cardId: card.id, rating: RATINGS.GOOD, now: NOW })).rejects.toThrow(
      "Card not found",
    );
    expect(await prisma.review.count()).toBe(0);
  });
});

describe("POST /api/reviews", () => {
  const post = (body: unknown) =>
    POST(new Request("http://t/api/reviews", { method: "POST", body: JSON.stringify(body) }));

  it("answers Again on a review card with its new RELEARNING state, so the session can re-queue it", async () => {
    // The route uses the real clock, so the card is due relative to it.
    const { card } = await reviewCard({}, new Date());

    const res = await post({ cardId: card.id, rating: 1, durationMs: 3000 });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      card: { id: card.id, state: FsrsState.RELEARNING, intervals: { 1: "10m" } },
    });
    expect(Object.keys(json.card.intervals)).toEqual(["1", "2", "3", "4"]);
    // Due again within the session: its 10-minute relearning step.
    const dueIn = new Date(json.card.due).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(8 * 60_000);
    expect(dueIn).toBeLessThanOrEqual(10 * 60_000);
    expect(await prisma.review.count({ where: { cardId: card.id } })).toBe(1);
  });

  it("rejects a malformed body and an unknown card with 400", async () => {
    await createUser();
    expect((await post({ cardId: "x", rating: 5 })).status).toBe(400);
    expect((await post({ rating: 3 })).status).toBe(400);
    const res = await post({ cardId: "missing", rating: 3 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Card not found" });
  });
});
