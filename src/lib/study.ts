import { prisma } from "./db";
import { FsrsState } from "@/generated/prisma/enums";
import { applyReview, previewIntervals, type RatingValue } from "./srs";

/**
 * Builds a study queue the way Anki does: due reviews first (they decay if you
 * skip them), then new cards up to the daily cap.
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
  deck: { select: { name: true } },
} as const;

export type BuildQueueOptions = {
  userId: string;
  profileId: string;
  /** Restrict to one deck; omit to study everything in the profile. */
  deckId?: string;
  reviewLimit?: number;
  newLimit?: number;
  now?: Date;
};

/**
 * Reviews and new cards get independent caps, the way Anki's deck options work.
 * A backlog of reviews shouldn't silently starve new material, and a big new
 * batch shouldn't push overdue reviews out of the session.
 */
export async function buildQueue({
  userId,
  profileId,
  deckId,
  reviewLimit = 200,
  newLimit = 20,
  now = new Date(),
}: BuildQueueOptions): Promise<QueueCard[]> {
  const where = {
    userId,
    suspended: false,
    deck: deckId ? { id: deckId, profileId } : { profileId },
  };

  const [due, fresh] = await Promise.all([
    reviewLimit > 0
      ? prisma.card.findMany({
          where: { ...where, state: { not: FsrsState.NEW }, due: { lte: now } },
          select: CARD_SELECT,
          orderBy: { due: "asc" },
          take: reviewLimit,
        })
      : Promise.resolve([]),
    newLimit > 0
      ? prisma.card.findMany({
          where: { ...where, state: FsrsState.NEW },
          select: CARD_SELECT,
          orderBy: { createdAt: "asc" },
          take: newLimit,
        })
      : Promise.resolve([]),
  ]);

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
      deckName: card.deck.name,
      intervals: {
        1: describeInterval(previews[1], now),
        2: describeInterval(previews[2], now),
        3: describeInterval(previews[3], now),
        4: describeInterval(previews[4], now),
      },
    };
  });
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

  const [updated] = await prisma.$transaction([
    prisma.card.update({ where: { id: card.id }, data: next }),
    prisma.review.create({
      data: { cardId: card.id, userId, durationMs, reviewedAt: now, ...log },
    }),
  ]);

  return updated;
}

export type DeckStats = {
  total: number;
  due: number;
  fresh: number;
  learning: number;
};

/** Counts for one deck, in a single pass. See `statsByDeck` for why not four. */
export async function deckStats(
  deckId: string,
  now = new Date(),
): Promise<DeckStats> {
  const [row] = await prisma.$queryRaw<
    { total: number; due: number; fresh: number; learning: number }[]
  >`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE c.state <> 'NEW'::"FsrsState" AND c.due <= ${now}
      )::int AS due,
      count(*) FILTER (WHERE c.state = 'NEW'::"FsrsState")::int AS fresh,
      count(*) FILTER (
        WHERE c.state IN ('LEARNING'::"FsrsState", 'RELEARNING'::"FsrsState")
      )::int AS learning
    FROM "Card" c
    WHERE c."deckId" = ${deckId} AND c.suspended = false
  `;

  return {
    total: row?.total ?? 0,
    due: row?.due ?? 0,
    fresh: row?.fresh ?? 0,
    learning: row?.learning ?? 0,
  };
}

/**
 * Stats for every deck in a profile, as a single query.
 *
 * Conditional aggregates (`count(*) FILTER (...)`) produce all four buckets in
 * one pass. Both obvious alternatives are worse: four counts per deck exhausts
 * the connection pool once you have a few dozen decks, and four *concurrent*
 * grouped queries is rejected outright by the local `prisma dev` Postgres,
 * which does not tolerate parallel aggregate queries.
 */
export async function statsByDeck(
  profileId: string,
  now = new Date(),
): Promise<Map<string, DeckStats>> {
  const rows = await prisma.$queryRaw<
    {
      deckId: string;
      total: number;
      due: number;
      fresh: number;
      learning: number;
    }[]
  >`
    SELECT
      c."deckId" AS "deckId",
      count(*)::int AS total,
      count(*) FILTER (
        WHERE c.state <> 'NEW'::"FsrsState" AND c.due <= ${now}
      )::int AS due,
      count(*) FILTER (WHERE c.state = 'NEW'::"FsrsState")::int AS fresh,
      count(*) FILTER (
        WHERE c.state IN ('LEARNING'::"FsrsState", 'RELEARNING'::"FsrsState")
      )::int AS learning
    FROM "Card" c
    JOIN "Deck" d ON d.id = c."deckId"
    WHERE d."profileId" = ${profileId} AND c.suspended = false
    GROUP BY c."deckId"
  `;

  return new Map(
    rows.map((row) => [
      row.deckId,
      {
        total: row.total,
        due: row.due,
        fresh: row.fresh,
        learning: row.learning,
      },
    ]),
  );
}

export const EMPTY_DECK_STATS: DeckStats = {
  total: 0,
  due: 0,
  fresh: 0,
  learning: 0,
};

/**
 * Profile-wide counts for the Today screen. Card buckets come from one pass of
 * conditional aggregates; the review tally is a second, sequential query
 * (different table). Deliberately not `Promise.all` — see `statsByDeck`.
 */
export async function profileStats(profileId: string, now = new Date()) {
  const [cards] = await prisma.$queryRaw<
    { total: number; due: number; fresh: number }[]
  >`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE c.state <> 'NEW'::"FsrsState" AND c.due <= ${now}
      )::int AS due,
      count(*) FILTER (WHERE c.state = 'NEW'::"FsrsState")::int AS fresh
    FROM "Card" c
    JOIN "Deck" d ON d.id = c."deckId"
    WHERE d."profileId" = ${profileId} AND c.suspended = false
  `;

  const reviewedToday = await prisma.review.count({
    where: {
      card: { deck: { profileId } },
      reviewedAt: { gte: startOfDay(now) },
    },
  });

  return {
    total: cards?.total ?? 0,
    due: cards?.due ?? 0,
    fresh: cards?.fresh ?? 0,
    reviewedToday,
  };
}

/**
 * How many cards a session will actually serve. Each cap applies to its own
 * pool, so this must not be `min(due + fresh, reviewLimit + newLimit)`.
 */
export function sessionSize(
  stats: { due: number; fresh: number },
  limits: { dailyReviewLimit: number; dailyNewLimit: number },
): number {
  return (
    Math.min(stats.due, limits.dailyReviewLimit) +
    Math.min(stats.fresh, limits.dailyNewLimit)
  );
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
