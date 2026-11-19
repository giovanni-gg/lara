import { describe, expect, it } from "vitest";
import { FsrsState } from "@/generated/prisma/enums";
import { RATINGS, SCHEDULER_SETTINGS, applyReview, isLeechMilestone, newCardState } from "./srs";

describe("applyReview", () => {
  const now = new Date("2026-11-19T12:00:00");

  it("puts a new card answered Again on its 10-minute learning step and logs the answer", () => {
    const { next, log } = applyReview(newCardState(now), RATINGS.AGAIN, now);

    expect(next.state).toBe(FsrsState.LEARNING);
    expect(next.reps).toBe(1);
    expect(next.due.getTime() - now.getTime()).toBe(10 * 60_000);
    expect(log).toMatchObject({ rating: RATINGS.AGAIN, state: FsrsState.LEARNING, due: next.due });
  });

  it("snaps a day-scale interval back to the start of the study day", () => {
    const { next } = applyReview(newCardState(now), RATINGS.EASY, now);

    expect(next.state).toBe(FsrsState.REVIEW);
    expect(next.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(next.due > now).toBe(true);
    expect([next.due.getHours(), next.due.getMinutes(), next.due.getSeconds()]).toEqual([
      SCHEDULER_SETTINGS.dayStartsAtHour,
      0,
      0,
    ]);
  });
});

describe("isLeechMilestone", () => {
  const threshold = SCHEDULER_SETTINGS.leechThreshold; // 8: then every 4 more

  it("fires on reaching the threshold and every half-threshold after", () => {
    expect(isLeechMilestone(threshold, threshold - 1)).toBe(true);
    expect(isLeechMilestone(threshold + 4, threshold + 3)).toBe(true);
  });

  it("stays quiet below the threshold, between milestones, and when lapses didn't grow", () => {
    expect(isLeechMilestone(threshold - 1, threshold - 2)).toBe(false);
    expect(isLeechMilestone(threshold + 1, threshold)).toBe(false);
    expect(isLeechMilestone(threshold, threshold)).toBe(false);
  });
});
