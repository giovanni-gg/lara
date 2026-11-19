import { describe, expect, it } from "vitest";
import { isPast, relativeTime } from "./utils";

const now = new Date(2026, 10, 19, 12, 0);
const plus = (ms: number) => new Date(now.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("isPast", () => {
  it("counts the exact moment as past (a card due now is due)", () => {
    expect(isPast(now, now)).toBe(true);
    expect(isPast(plus(-1), now)).toBe(true);
    expect(isPast(plus(1), now)).toBe(false);
  });
});

describe("relativeTime", () => {
  it.each([
    [30_000, "now"],
    [-30_000, "now"],
    [5 * MINUTE, "in 5 minutes"],
    [-2 * HOUR, "2 hours ago"],
    [DAY, "tomorrow"],
    [-DAY, "yesterday"],
    [3 * DAY, "in 3 days"],
    [60 * DAY, "in 2 months"],
    [-400 * DAY, "last year"],
  ])("%s ms → %s", (offset, label) => {
    expect(relativeTime(plus(offset), now)).toBe(label);
  });
});
