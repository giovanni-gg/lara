import { describe, expect, it, vi } from "vitest";

// study.ts also holds the database queries; only its pure helpers are tested
// here (the queries are in tests/integration). db.ts would throw on import
// without DATABASE_URL, so stand it in.
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { describeInterval, sessionSize } = await import("./study");

describe("describeInterval", () => {
  const now = new Date(2026, 10, 19, 12, 0);
  const after = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const HOUR = 60;
  const DAY = 24 * HOUR;

  it.each([
    [10, "10m"],
    [0.5, "1m"], // never "0m"
    [-5, "1m"], // already due
    [59, "59m"],
    [HOUR, "1h"],
    [23 * HOUR, "23h"],
    [DAY, "1d"],
    [29 * DAY, "29d"],
    [30 * DAY, "1mo"],
    [6 * 30 * DAY, "6mo"],
    [365 * DAY, "1.0y"],
    [2.5 * 365 * DAY, "2.5y"],
  ])("%s minutes → %s", (minutes, label) => {
    expect(describeInterval(after(minutes), now)).toBe(label);
  });
});

describe("sessionSize", () => {
  it("is every due card plus today's new cards, with no cap on reviews", () => {
    expect(sessionSize({ due: 0, newToday: 0 })).toBe(0);
    expect(sessionSize({ due: 3, newToday: 5 })).toBe(8);
    expect(sessionSize({ due: 450, newToday: 5 })).toBe(455);
  });
});
