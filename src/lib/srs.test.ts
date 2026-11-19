import { describe, expect, it } from "vitest";
import { FsrsState } from "@/generated/prisma/enums";
import {
  RATINGS,
  SCHEDULER_SETTINGS,
  applyReview,
  isLeechMilestone,
  newCardState,
  previewIntervals,
  replayHistory,
  startOfStudyDay,
  type SchedulingState,
} from "./srs";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A REVIEW card last seen `daysAgo` days before `now`, due now. */
function reviewCard(now: Date, daysAgo = 6): SchedulingState {
  return {
    state: FsrsState.REVIEW,
    due: now,
    stability: daysAgo,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: daysAgo,
    reps: 4,
    lapses: 0,
    learningSteps: 0,
    lastReview: new Date(now.getTime() - daysAgo * DAY),
  };
}

describe("startOfStudyDay", () => {
  // Local time throughout: the study day is the learner's, 04:00 to 04:00.
  it("starts the day at 04:00 local", () => {
    expect(startOfStudyDay(new Date(2026, 10, 19, 4, 0))).toEqual(new Date(2026, 10, 19, 4, 0));
    expect(startOfStudyDay(new Date(2026, 10, 19, 23, 59))).toEqual(new Date(2026, 10, 19, 4, 0));
  });

  it("puts 03:59 (and just after midnight) in the previous study day", () => {
    expect(startOfStudyDay(new Date(2026, 10, 19, 3, 59))).toEqual(new Date(2026, 10, 18, 4, 0));
    expect(startOfStudyDay(new Date(2026, 10, 19, 0, 30))).toEqual(new Date(2026, 10, 18, 4, 0));
  });
});

describe("applyReview", () => {
  const now = new Date(2026, 10, 19, 12, 0);

  it("uses a single 10-minute learning and relearning step", () => {
    expect(SCHEDULER_SETTINGS.learningSteps).toEqual(["10m"]);
    expect(SCHEDULER_SETTINGS.relearningSteps).toEqual(["10m"]);
  });

  it("puts a new card answered Again on its 10-minute learning step, exactly, and logs the answer", () => {
    const { next, log } = applyReview(newCardState(now), RATINGS.AGAIN, now);

    expect(next.state).toBe(FsrsState.LEARNING);
    expect(next.reps).toBe(1);
    expect(next.due.getTime() - now.getTime()).toBe(10 * MINUTE);
    expect(log).toMatchObject({ rating: RATINGS.AGAIN, state: FsrsState.LEARNING, due: next.due });
  });

  it("sends a lapsed review card to RELEARNING for exactly 10 minutes, not to a day boundary", () => {
    const { next } = applyReview(reviewCard(now), RATINGS.AGAIN, now);

    expect(next.state).toBe(FsrsState.RELEARNING);
    expect(next.lapses).toBe(1);
    expect(next.due.getTime() - now.getTime()).toBe(10 * MINUTE);
  });

  it("snaps a day-scale interval back to the start of the study day", () => {
    for (const card of [newCardState(now), reviewCard(now)]) {
      const { next, log } = applyReview(card, RATINGS.GOOD, now);

      expect(next.state).toBe(FsrsState.REVIEW);
      expect(next.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(next.due > now).toBe(true);
      expect(next.due).toEqual(startOfStudyDay(next.due));
      expect(log.due).toEqual(next.due);
    }
  });
});

describe("previewIntervals", () => {
  const now = new Date(2026, 10, 19, 12, 0);

  it.each([
    ["a new card", newCardState(now)],
    ["a review card", reviewCard(now)],
  ])("orders Again < Hard < Good < Easy for %s", (_, card) => {
    const p = previewIntervals(card, now);
    expect(p[1] < p[2]).toBe(true);
    expect(p[2] < p[3]).toBe(true);
    expect(p[3] < p[4]).toBe(true);
    expect(p[1].getTime() - now.getTime()).toBe(10 * MINUTE);
  });
});

describe("isLeechMilestone", () => {
  it("fires at 8 lapses, then every 4 more", () => {
    expect(SCHEDULER_SETTINGS.leechThreshold).toBe(8);
    expect(isLeechMilestone(8, 7)).toBe(true);
    expect(isLeechMilestone(12, 11)).toBe(true);
    expect(isLeechMilestone(16, 15)).toBe(true);
  });

  it("stays quiet below the threshold, between milestones, and when lapses didn't grow", () => {
    expect(isLeechMilestone(7, 6)).toBe(false);
    expect(isLeechMilestone(9, 8)).toBe(false);
    expect(isLeechMilestone(8, 8)).toBe(false);
    expect(isLeechMilestone(12, 12)).toBe(false);
  });
});

describe("replayHistory", () => {
  it("returns nothing for no history", () => {
    expect(replayHistory([])).toEqual([]);
  });

  it("returns one snapshot per answer, through learning, review and a lapse", () => {
    const t0 = new Date(2026, 0, 10, 9, 0);
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const snapshots = replayHistory([
      { rating: RATINGS.AGAIN, reviewedAt: t0 },
      { rating: RATINGS.GOOD, reviewedAt: at(10 * MINUTE) },
      { rating: RATINGS.GOOD, reviewedAt: at(3 * DAY) },
      { rating: RATINGS.AGAIN, reviewedAt: at(20 * DAY) },
    ]);

    expect(snapshots.map((s) => s.state)).toEqual([
      FsrsState.LEARNING,
      FsrsState.REVIEW,
      FsrsState.REVIEW,
      FsrsState.RELEARNING,
    ]);
    // A successful review strengthens memory; a lapse weakens it.
    expect(snapshots[2].stability).toBeGreaterThan(snapshots[1].stability);
    expect(snapshots[3].stability).toBeLessThan(snapshots[2].stability);
    expect(snapshots[2].elapsedDays).toBe(3);
    for (const s of snapshots) {
      expect(s.stability).toBeGreaterThan(0);
      expect(s.difficulty).toBeGreaterThanOrEqual(1);
      expect(s.difficulty).toBeLessThanOrEqual(10);
    }
  });
});
