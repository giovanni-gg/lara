import { prisma } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { SCHEDULER_SETTINGS, startOfStudyDay } from "./srs";

/**
 * The learner's journey for the "You" tab: streak, words known, activity and
 * the load ahead. Two grouped queries (reviews by study day, upcoming cards by
 * study day), run one after the other — see AGENTS.md on concurrent
 * aggregates — and pure helpers that turn them into series.
 *
 * Definitions:
 * - **Study day**: starts at 04:00 server-local time, exactly like
 *   `startOfStudyDay`. The SQL buckets with the server's own time zone so the
 *   two always agree (on Vercel that zone is UTC).
 * - **Known word**: a card whose latest answer gave it an interval of at least
 *   21 days — Anki's "mature". Counted over decks that aren't archived and
 *   cards that aren't suspended. The history is rebuilt from the review log,
 *   so imported Anki history shows up too.
 * - **Retention**: of the answers to cards that were in review (not new or
 *   learning steps) during the last 30 study days, the share not graded
 *   Again — Anki's "true retention", comparable to the 85% the scheduler aims for.
 * - **Streak**: consecutive study days with at least one review. Today counts
 *   once you've reviewed; until then a streak that ran through yesterday is
 *   still alive.
 *
 * Reviews (activity, streak, retention) count across the whole profile,
 * archived decks included — it was still studying, and it matches the "Done"
 * count on Decks.
 */

/** A study day as `YYYY-MM-DD`. */
export type DayKey = string;
export type DayValue = { day: DayKey; value: number };

/** At or above this interval a card is "known" (Anki's mature threshold). */
export const KNOWN_INTERVAL_DAYS = 21;
export const ACTIVITY_WEEKS = 16;
export const FORECAST_DAYS = 14;
export const RETENTION_DAYS = 30;
/** The journey chart never needs more points than a phone has pixels for. */
const MAX_SERIES_POINTS = 120;

export type Progress = {
  today: DayKey;
  streak: { current: number; best: number };
  reviewsToday: number;
  reviewsTotal: number;
  /** Share of review answers not graded Again, or null with none to judge. */
  retention: number | null;
  known: number;
  /** Change in words known over the last 30 study days. */
  knownGained: number;
  /** Words known over time, from the first review to today (downsampled). */
  knownSeries: DayValue[];
  /** Reviews per day, Monday-aligned, ending today. */
  activity: DayValue[];
  /** Cards falling due on each of the next study days, from tomorrow. */
  forecast: DayValue[];
};

// ---- day keys (pure) ---------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** The study day `date` falls in, as a key, using `startOfStudyDay`. */
export function studyDayKey(date: Date): DayKey {
  const start = startOfStudyDay(date);
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

function keyToUtc(key: DayKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key: DayKey, days: number): DayKey {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((keyToUtc(to).getTime() - keyToUtc(from).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: DayKey): number {
  return (keyToUtc(key).getUTCDay() + 6) % 7;
}

/** "Mar 2024"-style label for chart axes. */
export function formatMonth(key: DayKey, withYear = true): string {
  return keyToUtc(key).toLocaleDateString("en", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "Mon 3 Mar" for tooltips. */
export function formatDay(key: DayKey): string {
  return keyToUtc(key).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** One letter per weekday, for the forecast's axis. */
export function weekdayLetter(key: DayKey): string {
  return "MTWTFSS"[weekdayIndex(key)];
}

// ---- series (pure) -----------------------------------------------------------

/** Every day from `from` to `to` inclusive, 0 where `values` has none. */
export function fillDays(values: ReadonlyMap<DayKey, number>, from: DayKey, to: DayKey): DayValue[] {
  const out: DayValue[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push({ day, value: values.get(day) ?? 0 });
  }
  return out;
}

/** Running total of daily changes, one point per day from the first change to `to`. */
export function cumulative(deltas: ReadonlyMap<DayKey, number>, to: DayKey): DayValue[] {
  const days = [...deltas.keys()].filter((d) => d <= to).sort();
  if (days.length === 0) return [];
  let total = 0;
  return fillDays(deltas, days[0], to).map(({ day, value }) => {
    total += value;
    return { day, value: total };
  });
}

/**
 * At most `max` points, keeping the last day of each equal-width bucket (and
 * so always the final value). Fine for a running total, which only steps.
 */
export function downsample(series: DayValue[], max: number): DayValue[] {
  if (series.length <= max) return series;
  const size = Math.ceil(series.length / max);
  const out: DayValue[] = [];
  for (let end = series.length - 1; end >= 0; end -= size) out.push(series[end]);
  if (out.at(-1) !== series[0]) out.push(series[0]);
  return out.reverse();
}

/** Current and best run of consecutive active days. */
export function streaks(activeDays: Iterable<DayKey>, today: DayKey): { current: number; best: number } {
  const active = new Set([...activeDays].filter((d) => d <= today));
  let best = 0;
  for (const day of active) {
    if (active.has(addDays(day, -1))) continue; // not the start of a run
    let length = 1;
    while (active.has(addDays(day, length))) length++;
    best = Math.max(best, length);
  }
  // Today not studied yet doesn't break the streak; it just doesn't add to it.
  let day = active.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (active.has(day)) {
    current++;
    day = addDays(day, -1);
  }
  return { current, best };
}

/**
 * Heatmap shade 0–4 for each count: 0 is no reviews; 1–4 split the days that
 * had reviews by quartile, so one marathon day doesn't wash out the rest.
 */
export function activityLevels(counts: number[]): number[] {
  const sorted = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return counts.map(() => 0);
  const q = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return counts.map((c) => (c <= 0 ? 0 : 1 + cuts.filter((cut) => c > cut).length));
}

/** A round axis maximum at or above `value`: 1, 2, 2.5, 5 × 10ⁿ. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fullFormat = new Intl.NumberFormat("en");

/** 950 · 1,234 · 18.8K — in full below 10,000. */
export function formatCount(n: number): string {
  return Math.abs(n) < 10_000 ? fullFormat.format(n) : compactFormat.format(n);
}

// ---- the queries -------------------------------------------------------------

/** The server's time zone: the one `startOfStudyDay` works in. */
function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The study day a timestamp column falls in, as a SQL date. Prisma stores
 * DateTime as UTC `timestamp`; shift it to the server's zone, then back by
 * the day-start hour, exactly as `startOfStudyDay` does in JS.
 */
function studyDaySql(column: string, timeZone: string): Prisma.Sql {
  return Prisma.sql`((((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})
    - make_interval(hours => ${SCHEDULER_SETTINGS.dayStartsAtHour}::int))::date)`;
}

type ReviewDayRow = {
  day: DayKey;
  reviews: number;
  /** Answers to cards that were in review (not learning) at the time. */
  reviewAnswers: number;
  /** Of those, the ones not graded Again. */
  recalled: number;
  /** Net change in known cards that day. */
  knownDelta: number;
};

export async function loadProgress(profileId: string, now = new Date()): Promise<Progress> {
  const timeZone = serverTimeZone();
  const today = studyDayKey(now);

  // Each review's day, and whether it and the card's previous review left the
  // card known: summing (known − previously known) per day telescopes into
  // "cards whose latest review is known" for any day.
  const rows = await prisma.$queryRaw<ReviewDayRow[]>`
    WITH r AS (
      SELECT
        ${studyDaySql(`r."reviewedAt"`, timeZone)} AS day,
        r.rating,
        r."scheduledDays" >= ${KNOWN_INTERVAL_DAYS} AS known,
        coalesce(lag(r."scheduledDays" >= ${KNOWN_INTERVAL_DAYS}) OVER w, false) AS "wasKnown",
        lag(r.state) OVER w AS "prevState",
        (d."archivedAt" IS NULL AND NOT c.suspended) AS counted
      FROM "Review" r
      JOIN "Card" c ON c.id = r."cardId"
      JOIN "Deck" d ON d.id = c."deckId"
      WHERE d."profileId" = ${profileId}
      WINDOW w AS (PARTITION BY r."cardId" ORDER BY r."reviewedAt", r.id)
    )
    SELECT
      to_char(day, 'YYYY-MM-DD') AS day,
      count(*)::int AS reviews,
      count(*) FILTER (WHERE "prevState" = 'REVIEW'::"FsrsState")::int AS "reviewAnswers",
      count(*) FILTER (WHERE "prevState" = 'REVIEW'::"FsrsState" AND rating > 1)::int AS recalled,
      coalesce(sum(known::int - "wasKnown"::int) FILTER (WHERE counted), 0)::int AS "knownDelta"
    FROM r
    GROUP BY day
    ORDER BY day
  `;

  // Sequential, not Promise.all (AGENTS.md). Upcoming load by study day, from
  // tomorrow: today's work (and any backlog) is on the Decks screen, and a
  // backlog would flatten every other bar.
  const from = startOfStudyDay(now);
  from.setDate(from.getDate() + 1);
  const to = new Date(from);
  to.setDate(to.getDate() + FORECAST_DAYS);
  const dueRows = await prisma.$queryRaw<{ day: DayKey; cards: number }[]>`
    SELECT
      to_char(${studyDaySql(`c.due`, timeZone)}, 'YYYY-MM-DD') AS day,
      count(*)::int AS cards
    FROM "Card" c
    JOIN "Deck" d ON d.id = c."deckId"
    WHERE d."profileId" = ${profileId}
      AND d."archivedAt" IS NULL
      AND NOT c.suspended
      AND c.state <> 'NEW'::"FsrsState"
      AND c.due >= ${from}
      AND c.due < ${to}
    GROUP BY 1
  `;

  return buildProgress(rows, dueRows, today);
}

/** Everything but the queries: pure, so the derivation is unit-tested. */
export function buildProgress(
  rows: ReviewDayRow[],
  dueRows: { day: DayKey; cards: number }[],
  today: DayKey,
): Progress {
  const byDay = new Map(rows.map((row) => [row.day, row]));

  const retentionFrom = addDays(today, -(RETENTION_DAYS - 1));
  let answers = 0;
  let recalled = 0;
  for (const row of rows) {
    if (row.day < retentionFrom || row.day > today) continue;
    answers += row.reviewAnswers;
    recalled += row.recalled;
  }

  const knownDaily = cumulative(new Map(rows.map((row) => [row.day, row.knownDelta])), today);
  const known = knownDaily.at(-1)?.value ?? 0;
  const monthAgo = knownDaily.find((p) => p.day === addDays(today, -RETENTION_DAYS))?.value ?? 0;

  // Monday of the first week shown, so columns are whole weeks.
  const activityFrom = addDays(today, -weekdayIndex(today) - 7 * (ACTIVITY_WEEKS - 1));

  return {
    today,
    streak: streaks(
      rows.filter((row) => row.reviews > 0).map((row) => row.day),
      today,
    ),
    reviewsToday: byDay.get(today)?.reviews ?? 0,
    reviewsTotal: rows.reduce((n, row) => n + row.reviews, 0),
    retention: answers > 0 ? recalled / answers : null,
    known,
    knownGained: known - monthAgo,
    knownSeries: downsample(knownDaily, MAX_SERIES_POINTS),
    activity: fillDays(new Map(rows.map((row) => [row.day, row.reviews])), activityFrom, today),
    forecast: fillDays(
      new Map(dueRows.map((row) => [row.day, row.cards])),
      addDays(today, 1),
      addDays(today, FORECAST_DAYS),
    ),
  };
}
