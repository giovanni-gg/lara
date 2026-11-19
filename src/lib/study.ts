import { prisma } from "./db";
import { FsrsState } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import {
  SCHEDULER_SETTINGS,
  applyReview,
  isLeechMilestone,
  previewIntervals,
  startOfStudyDay,
  type RatingValue,
} from "./srs";

/**
 * Builds a study queue the way Anki does: due reviews first (they decay if you
 * skip them), then each deck's new cards for today.
 */

export type QueueCard = {
  id: string;
  target: string;
  source: string;
  targetSentence: string | null;
  sourceSentence: string | null;
  notes: string | null;
  cardType: string;
  audioUrl: string | null;
  sentenceAudioUrl: string | null;
  imageUrl: string | null;
  state: FsrsState;
  deckName: string;
  /** What each answer button would schedule, so the UI can label them. */
  intervals: Record<RatingValue, string>;
};

const CARD_SELECT = {
  id: true,
  target: true,
  source: true,
  targetSentence: true,
  sourceSentence: true,
  notes: true,
  cardType: true,
  audioUrl: true,
  sentenceAudioUrl: true,
  imageUrl: true,
  state: true,
  due: true,
  stability: true,
  difficulty: true,
  elapsedDays: true,
  scheduledDays: true,
  reps: true,
  lapses: true,
  learningSteps: true,
  lastReview: true,
  deck: { select: { name: true, parent: { select: { name: true } } } },
} as const;

export type BuildQueueOptions = {
  userId: string;
  profileId: string;
  /**
   * Restrict to these decks — a deck plus its subdecks, from `subtreeIds`.
   * Omit to study everything in the profile.
   */
  deckIds?: string[];
  now?: Date;
};

/**
 * Not a study limit — reviews are never capped — just a bound on how many
 * cards one session ships to the phone in a single payload.
 */
const MAX_SESSION_CARDS = 2000;

/**
 * Every due review, then each deck's remaining new cards for today.
 *
 * Reviews are uncapped by design (the learner always clears the backlog). New
 * cards are capped per deck by `Deck.newCardsPerDay`, counting cards that deck
 * already introduced since the study day began, as Anki does. Archived decks
 * are left out entirely.
 */
export async function buildQueue({
  userId,
  profileId,
  deckIds,
  now = new Date(),
}: BuildQueueOptions): Promise<QueueCard[]> {
  const deck = {
    profileId,
    archivedAt: null,
    ...(deckIds ? { id: { in: deckIds } } : {}),
  };

  // Sequential, not Promise.all — see AGENTS.md on concurrent queries.
  const due = await prisma.card.findMany({
    where: { userId, suspended: false, deck, state: { not: FsrsState.NEW }, due: { lte: now } },
    select: CARD_SELECT,
    orderBy: { due: "asc" },
    take: MAX_SESSION_CARDS,
  });

  const freshIds = await newCardIdsForToday(profileId, now, deckIds);
  const freshRows = freshIds.length
    ? await prisma.card.findMany({ where: { id: { in: freshIds }, userId }, select: CARD_SELECT })
    : [];
  const position = new Map(freshIds.map((id, i) => [id, i]));
  const fresh = freshRows.sort((a, b) => position.get(a.id)! - position.get(b.id)!);

  return [...due, ...fresh].map((card) => {
    const previews = previewIntervals(card, now);
    return {
      id: card.id,
      target: card.target,
      source: card.source,
      targetSentence: card.targetSentence,
      sourceSentence: card.sourceSentence,
      notes: card.notes,
      cardType: card.cardType,
      audioUrl: card.audioUrl,
      sentenceAudioUrl: card.sentenceAudioUrl,
      imageUrl: card.imageUrl,
      state: card.state,
      deckName: card.deck.parent
        ? `${card.deck.parent.name} · ${card.deck.name}`
        : card.deck.name,
      intervals: {
        1: describeInterval(previews[1], now),
        2: describeInterval(previews[2], now),
        3: describeInterval(previews[3], now),
        4: describeInterval(previews[4], now),
      },
    };
  });
}

/**
 * Cards each deck has introduced since the study day began: cards whose
 * first-ever review falls today. Shared by the queue and the counts so the
 * "New" number and the session always agree.
 */
function introducedTodaySql(profileId: string, dayStart: Date) {
  return Prisma.sql`
    SELECT c."deckId", count(*)::int AS n
    FROM "Card" c
    JOIN "Deck" d ON d.id = c."deckId"
    JOIN (
      SELECT r."cardId" FROM "Review" r
      GROUP BY r."cardId"
      HAVING min(r."reviewedAt") >= ${dayStart}
    ) first_review ON first_review."cardId" = c.id
    WHERE d."profileId" = ${profileId}
    GROUP BY c."deckId"
  `;
}

/** Ids of today's new cards, oldest first, each deck capped at its remaining allowance. */
async function newCardIdsForToday(
  profileId: string,
  now: Date,
  deckIds?: string[],
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH introduced AS (${introducedTodaySql(profileId, startOfStudyDay(now))}),
    ranked AS (
      SELECT c.id, c."createdAt",
        row_number() OVER (PARTITION BY c."deckId" ORDER BY c."createdAt", c.id) AS rn,
        greatest(d."newCardsPerDay" - coalesce(i.n, 0), 0) AS remaining
      FROM "Card" c
      JOIN "Deck" d ON d.id = c."deckId"
      LEFT JOIN introduced i ON i."deckId" = c."deckId"
      WHERE d."profileId" = ${profileId}
        AND d."archivedAt" IS NULL
        AND c.suspended = false
        AND c.state = 'NEW'::"FsrsState"
        ${deckIds ? Prisma.sql`AND c."deckId" = ANY(${deckIds})` : Prisma.empty}
    )
    SELECT id FROM ranked WHERE rn <= remaining ORDER BY "createdAt", id
  `;
  return rows.map((row) => row.id);
}

/** "10m", "2d", "3mo" — terse enough to sit under an answer button. */
export function describeInterval(due: Date, now = new Date()): string {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Record an answer: update the card's schedule and append to the review log. */
export async function submitReview({
  userId,
  cardId,
  rating,
  durationMs,
  now = new Date(),
}: {
  userId: string;
  cardId: string;
  rating: RatingValue;
  durationMs?: number;
  now?: Date;
}) {
  const card = await prisma.card.findFirst({ where: { id: cardId, userId } });
  if (!card) throw new Error("Card not found");

  const { next, log } = applyReview(card, rating, now);

  // Anki's leech handling, tag-only: flag cards that keep lapsing so they can
  // be rewritten, without pulling them out of rotation.
  const tags =
    isLeechMilestone(next.lapses, card.lapses) && !card.tags.includes("leech")
      ? [...card.tags, "leech"]
      : card.tags;

  // Walking away mid-card shouldn't log a ten-minute answer.
  const cappedDuration =
    durationMs === undefined
      ? undefined
      : Math.min(durationMs, SCHEDULER_SETTINGS.maxAnswerSeconds * 1000);

  const [updated] = await prisma.$transaction([
    prisma.card.update({ where: { id: card.id }, data: { ...next, tags } }),
    prisma.review.create({
      data: { cardId: card.id, userId, durationMs: cappedDuration, reviewedAt: now, ...log },
    }),
  ]);

  return updated;
}

export type DeckStats = {
  total: number;
  /** Everything due now: learning + review. */
  due: number;
  /** All new cards, regardless of today's allowance. */
  fresh: number;
  /** New cards this deck will still introduce today — Anki's "New" column. */
  newToday: number;
  /** Learning/relearning cards due now — Anki's "Learn" column. */
  learning: number;
};

/**
 * Stats for every deck in a profile (archived ones included — callers decide
 * what to show), as a single query.
 *
 * Conditional aggregates (`count(*) FILTER (...)`) produce all buckets in one
 * pass. Both obvious alternatives are worse: counts per deck exhaust the
 * connection pool once you have a few dozen decks, and concurrent grouped
 * queries are rejected outright by the local `prisma dev` Postgres.
 */
export async function statsByDeck(
  profileId: string,
  now = new Date(),
): Promise<Map<string, DeckStats>> {
  const rows = await prisma.$queryRaw<(DeckStats & { deckId: string })[]>`
    WITH introduced AS (${introducedTodaySql(profileId, startOfStudyDay(now))}),
    counts AS (
      SELECT
        c."deckId",
        count(*)::int AS total,
        count(*) FILTER (
          WHERE c.state <> 'NEW'::"FsrsState" AND c.due <= ${now}
        )::int AS due,
        count(*) FILTER (WHERE c.state = 'NEW'::"FsrsState")::int AS fresh,
        count(*) FILTER (
          WHERE c.state IN ('LEARNING'::"FsrsState", 'RELEARNING'::"FsrsState")
            AND c.due <= ${now}
        )::int AS learning
      FROM "Card" c
      JOIN "Deck" d ON d.id = c."deckId"
      WHERE d."profileId" = ${profileId} AND c.suspended = false
      GROUP BY c."deckId"
    )
    SELECT
      counts."deckId" AS "deckId",
      counts.total, counts.due, counts.fresh, counts.learning,
      least(counts.fresh, greatest(d."newCardsPerDay" - coalesce(i.n, 0), 0))::int AS "newToday"
    FROM counts
    JOIN "Deck" d ON d.id = counts."deckId"
    LEFT JOIN introduced i ON i."deckId" = counts."deckId"
  `;

  return new Map(
    rows.map((row) => [
      row.deckId,
      {
        total: row.total,
        due: row.due,
        fresh: row.fresh,
        newToday: row.newToday,
        learning: row.learning,
      },
    ]),
  );
}

export const EMPTY_DECK_STATS: DeckStats = {
  total: 0,
  due: 0,
  fresh: 0,
  newToday: 0,
  learning: 0,
};

/**
 * Profile-wide counts for the Today screen, over decks that aren't archived.
 * Card buckets come from `statsByDeck`; the review tally is a second,
 * sequential query (different table). Deliberately not `Promise.all`.
 */
export async function profileStats(profileId: string, now = new Date()) {
  const active = new Set(
    (
      await prisma.deck.findMany({
        where: { profileId, archivedAt: null },
        select: { id: true },
      })
    ).map((d) => d.id),
  );
  const perDeck = await statsByDeck(profileId, now);

  let total = 0;
  let due = 0;
  let newToday = 0;
  for (const [deckId, stats] of perDeck) {
    if (!active.has(deckId)) continue;
    total += stats.total;
    due += stats.due;
    newToday += stats.newToday;
  }

  const reviewedToday = await prisma.review.count({
    where: {
      card: { deck: { profileId } },
      reviewedAt: { gte: startOfStudyDay(now) },
    },
  });

  return { total, due, newToday, reviewedToday };
}

/** How many cards a session will serve: every due review plus today's new cards. */
export function sessionSize(stats: { due: number; newToday: number }): number {
  return stats.due + stats.newToday;
}
