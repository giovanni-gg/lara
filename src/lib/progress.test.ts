import { describe, expect, it, vi } from "vitest";

// progress.ts also holds the queries (tested in tests/integration); only the
// pure helpers are tested here. db.ts would throw on import without DATABASE_URL.
vi.mock("@/lib/db", () => ({ prisma: {} }));

const {
  activityLevels,
  addDays,
  buildProgress,
  cumulative,
  daysBetween,
  downsample,
  fillDays,
  formatCount,
  niceCeil,
  streaks,
  studyDayKey,
  weekdayIndex,
  ACTIVITY_WEEKS,
  FORECAST_DAYS,
} = await import("./progress");

describe("day keys", () => {
  it("names the study day, which starts at 04:00", () => {
    expect(studyDayKey(new Date(2026, 10, 19, 12, 0))).toBe("2026-11-19");
    expect(studyDayKey(new Date(2026, 10, 19, 4, 0))).toBe("2026-11-19");
    expect(studyDayKey(new Date(2026, 10, 19, 3, 59))).toBe("2026-11-18");
    expect(studyDayKey(new Date(2026, 0, 1, 1, 0))).toBe("2025-12-31");
  });

  it("does calendar arithmetic across month, year and DST boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-29", -1)).toBe("2026-03-28"); // EU clocks go forward
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
    expect(daysBetween("2026-04-01", "2026-03-01")).toBe(-31);
  });

  it("numbers weekdays from Monday", () => {
    expect(weekdayIndex("2026-11-16")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-22")).toBe(6); // Sunday
  });
});

describe("fillDays", () => {
  it("fills missing days with zero, inclusive at both ends", () => {
    expect(fillDays(new Map([["2026-11-02", 4]]), "2026-11-01", "2026-11-03")).toEqual([
      { day: "2026-11-01", value: 0 },
      { day: "2026-11-02", value: 4 },
      { day: "2026-11-03", value: 0 },
    ]);
  });
});

describe("cumulative", () => {
  it("runs a total from the first change to the end day, carrying it over quiet days", () => {
    const deltas = new Map([
      ["2026-11-01", 2],
      ["2026-11-03", -1],
      ["2026-11-04", 3],
    ]);
    expect(cumulative(deltas, "2026-11-05").map((p) => p.value)).toEqual([2, 2, 1, 4, 4]);
  });

  it("is empty with no changes and ignores days after the end", () => {
    expect(cumulative(new Map(), "2026-11-05")).toEqual([]);
    expect(cumulative(new Map([["2026-11-09", 1]]), "2026-11-05")).toEqual([]);
  });
});

describe("downsample", () => {
  const series = Array.from({ length: 1000 }, (_, i) => ({ day: addDays("2024-01-01", i), value: i }));

  it("caps the points and keeps both ends", () => {
    const out = downsample(series, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[0]).toBe(series[0]);
    expect(out.at(-1)).toBe(series.at(-1));
    expect(out.map((p) => p.value)).toEqual([...out.map((p) => p.value)].sort((a, b) => a - b));
  });

  it("leaves short series alone", () => {
    expect(downsample(series.slice(0, 50), 100)).toHaveLength(50);
  });
});

describe("streaks", () => {
  const today = "2026-11-20";
  const run = (end: string, length: number) => Array.from({ length }, (_, i) => addDays(end, -i));

  it("counts back from today when today is studied", () => {
    expect(streaks(run(today, 5), today)).toEqual({ current: 5, best: 5 });
  });

  it("keeps yesterday's streak alive until today is over", () => {
    expect(streaks(run("2026-11-19", 3), today)).toEqual({ current: 3, best: 3 });
  });

  it("is broken by a missed day, and remembers the best run", () => {
    const days = [...run("2026-11-18", 2), ...run("2026-10-31", 10)];
    expect(streaks(days, today)).toEqual({ current: 0, best: 10 });
  });

  it("is zero with no history", () => {
    expect(streaks([], today)).toEqual({ current: 0, best: 0 });
  });
});

describe("activityLevels", () => {
  it("keeps 0 for no reviews and splits active days by quartile", () => {
    expect(activityLevels([0, 1, 2, 3, 4, 0])).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it("doesn't let one huge day flatten the rest", () => {
    expect(activityLevels([10, 20, 30, 1000])).toEqual([1, 2, 3, 4]);
  });

  it("handles no activity", () => {
    expect(activityLevels([0, 0])).toEqual([0, 0]);
  });
});

describe("niceCeil and formatCount", () => {
  it("rounds axis maxima up to clean numbers", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(180)).toBe(200);
    expect(niceCeil(2_100)).toBe(2_500);
    expect(niceCeil(3_250)).toBe(5_000);
  });

  it("writes counts in full below 10,000 and compact above", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(3_250)).toBe("3,250");
    expect(formatCount(18_840)).toBe("18.8K");
  });
});

describe("buildProgress", () => {
  const today = "2026-11-20";
  const row = (day: string, fields: Partial<{ reviews: number; reviewAnswers: number; recalled: number; knownDelta: number }>) => ({
    day,
    reviews: 0,
    reviewAnswers: 0,
    recalled: 0,
    knownDelta: 0,
    ...fields,
  });

  it("derives the tiles and series from per-day rows", () => {
    const progress = buildProgress(
      [
        row("2026-08-01", { reviews: 10, knownDelta: 4 }), // outside the 30-day window
        row("2026-11-18", { reviews: 5, reviewAnswers: 4, recalled: 3, knownDelta: 2 }),
        row("2026-11-19", { reviews: 7, reviewAnswers: 6, recalled: 6, knownDelta: -1 }),
        row(today, { reviews: 3 }),
      ],
      [
        { day: addDays(today, 1), cards: 12 },
        { day: addDays(today, 3), cards: 4 },
      ],
      today,
    );

    expect(progress.streak).toEqual({ current: 3, best: 3 });
    expect(progress.reviewsToday).toBe(3);
    expect(progress.reviewsTotal).toBe(25);
    expect(progress.retention).toBeCloseTo(9 / 10);
    expect(progress.known).toBe(5);
    expect(progress.knownGained).toBe(1);
    expect(progress.knownSeries.at(-1)).toEqual({ day: today, value: 5 });
    expect(progress.knownSeries[0].day).toBe("2026-08-01");

    expect(progress.activity.at(-1)).toEqual({ day: today, value: 3 });
    expect(weekdayIndex(progress.activity[0].day)).toBe(0);
    expect(daysBetween(progress.activity[0].day, today)).toBe(7 * (ACTIVITY_WEEKS - 1) + weekdayIndex(today));

    expect(progress.forecast).toHaveLength(FORECAST_DAYS);
    expect(progress.forecast[0].day).toBe(addDays(today, 1));
    expect(progress.forecast.map((p) => p.value).slice(0, 3)).toEqual([12, 0, 4]);
  });

  it("has no retention without review answers, and nothing known without history", () => {
    const progress = buildProgress([], [], today);
    expect(progress.retention).toBeNull();
    expect(progress.known).toBe(0);
    expect(progress.knownSeries).toEqual([]);
    expect(progress.streak).toEqual({ current: 0, best: 0 });
  });
});
