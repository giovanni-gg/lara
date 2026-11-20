// The "You" tab's statistics: the two grouped queries in src/lib/progress.ts
// bucket by study day (04:00 local, like startOfStudyDay), stay inside the
// profile, and leave archived decks and suspended cards out of what concerns cards.

import { describe, expect, it } from "vitest";
import { loadProgress } from "@/lib/progress";
import { FsrsState } from "@/generated/prisma/enums";
import { createCard, createDeck, createProfile, createReview, createUser, dueReview, futureReview, learning } from "../factories";

const at = (hour: number, minute = 0, dayOffset = 0) => new Date(2026, 10, 19 + dayOffset, hour, minute);
const NOW = at(12);
const TODAY = "2026-11-19";

const value = (series: { day: string; value: number }[], day: string) => series.find((p) => p.day === day)?.value;

describe("loadProgress", () => {
  it("buckets reviews by study day and derives streak, retention and words known", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const deck = await createDeck(profile);
    const archived = await createDeck(profile, { archivedAt: at(8, 0, -30) });

    // A: learnt, then reached a 25-day interval yesterday → known.
    const a = await createCard(deck, futureReview(NOW, 25));
    await createReview(a, { reviewedAt: at(9, 0, -10), state: FsrsState.LEARNING, scheduledDays: 0 });
    await createReview(a, { reviewedAt: at(9, 0, -5), state: FsrsState.REVIEW, scheduledDays: 3 });
    await createReview(a, { reviewedAt: at(9, 0, -1), state: FsrsState.REVIEW, scheduledDays: 25, rating: 3 });

    // B: known at 03:30 today (still yesterday's study day), forgotten this morning.
    const b = await createCard(deck, { ...learning(NOW, 10), state: FsrsState.RELEARNING });
    await createReview(b, { reviewedAt: at(3, 30), state: FsrsState.REVIEW, scheduledDays: 30 });
    await createReview(b, { reviewedAt: at(9), state: FsrsState.RELEARNING, scheduledDays: 0, rating: 1 });

    // Mature, but archived or suspended: reviews count, words known don't.
    const old = await createCard(archived, futureReview(NOW, 40));
    await createReview(old, { reviewedAt: at(10), state: FsrsState.REVIEW, scheduledDays: 40 });
    const parked = await createCard(deck, { ...futureReview(NOW, 40), suspended: true });
    await createReview(parked, { reviewedAt: at(9, 0, -5), state: FsrsState.REVIEW, scheduledDays: 40 });

    // Another profile's history never leaks in.
    const other = await createProfile(user, { targetLanguage: "pt", isActive: false });
    const theirs = await createCard(await createDeck(other), futureReview(NOW, 40));
    await createReview(theirs, { reviewedAt: at(9), state: FsrsState.REVIEW, scheduledDays: 40 });

    const progress = await loadProgress(profile.id, NOW);

    expect(progress.today).toBe(TODAY);
    expect(progress.reviewsToday).toBe(2); // B's lapse + the archived card
    expect(progress.reviewsTotal).toBe(7);
    expect(value(progress.activity, "2026-11-18")).toBe(2); // A at 09:00 + B at 03:30 on the 19th
    expect(value(progress.activity, "2026-11-14")).toBe(2);
    expect(value(progress.activity, "2026-11-09")).toBe(1);
    expect(progress.streak).toEqual({ current: 2, best: 2 });
    // Review-state answers: A's on the 18th (recalled), B's this morning (Again).
    expect(progress.retention).toBeCloseTo(0.5);
    expect(value(progress.knownSeries, "2026-11-17")).toBe(0);
    expect(value(progress.knownSeries, "2026-11-18")).toBe(2);
    expect(progress.known).toBe(1);
    expect(progress.knownGained).toBe(1);
  });

  it("forecasts cards falling due on each study day from tomorrow", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    const deck = await createDeck(profile);
    const archived = await createDeck(profile, { archivedAt: at(8) });

    await createCard(deck, dueReview(NOW, 3)); // overdue: today's work, not shown
    await createCard(deck, learning(NOW, 30)); // later today
    await createCard(deck, { ...dueReview(NOW), due: at(3, 0, 1) }); // 03:00 tomorrow is still today
    await createCard(deck, { ...dueReview(NOW), due: at(4, 0, 1) }); // tomorrow
    await createCard(deck, { ...dueReview(NOW), due: at(23, 0, 1) }); // tomorrow
    await createCard(deck, futureReview(NOW, 3)); // in three days
    await createCard(deck, { ...dueReview(NOW), due: at(4, 0, 14) }); // the last day shown
    await createCard(deck, { ...dueReview(NOW), due: at(4, 0, 15) }); // past the horizon
    await createCard(deck); // new
    await createCard(deck, { ...futureReview(NOW, 3), suspended: true });
    await createCard(archived, futureReview(NOW, 3));

    const { forecast } = await loadProgress(profile.id, NOW);

    expect(forecast).toHaveLength(14);
    expect(forecast[0]).toEqual({ day: "2026-11-20", value: 2 });
    expect(value(forecast, "2026-11-22")).toBe(1);
    expect(forecast.at(-1)).toEqual({ day: "2026-12-03", value: 1 });
    expect(forecast.reduce((n, p) => n + p.value, 0)).toBe(4);
  });

  it("is all zeros for a learner with no history", async () => {
    const user = await createUser();
    const profile = await createProfile(user);
    await createCard(await createDeck(profile));

    const progress = await loadProgress(profile.id, NOW);

    expect(progress).toMatchObject({
      streak: { current: 0, best: 0 },
      reviewsToday: 0,
      reviewsTotal: 0,
      retention: null,
      known: 0,
      knownSeries: [],
    });
    expect(progress.activity.every((p) => p.value === 0)).toBe(true);
  });
});
