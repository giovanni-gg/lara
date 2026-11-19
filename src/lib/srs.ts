import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { FsrsState } from "@/generated/prisma/enums";

/**
 * Spaced repetition, backed by FSRS-6 via `ts-fsrs` (MIT).
 *
 * FSRS is the same algorithm Anki ships as its modern scheduler — Anki itself
 * is AGPL-3, but the scheduler is a separately published open-source algorithm,
 * so we can use it directly rather than reimplementing SM-2.
 */

export const RATINGS = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
} as const;

export type RatingValue = (typeof RATINGS)[keyof typeof RATINGS];

export const RATING_LABELS: Record<RatingValue, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

/**
 * The scheduler settings, mirrored from the learner's Anki preset (decoded
 * from their collection's deck config) so moving to Lara changes nothing about
 * how cards come back. Deliberately not user-editable: Anki's dozens of knobs
 * are what this app is getting away from. Daily limits live on the profile.
 *
 * FSRS parameters are ts-fsrs's FSRS-6 defaults — the Anki preset had never
 * been optimised, so it ran on the same defaults (decay 0.1542).
 */
export const SCHEDULER_SETTINGS = {
  /** "Aim to recall 85% of cards when they come due" (Anki default: 0.9). */
  desiredRetention: 0.85,
  learningSteps: ["10m"],
  relearningSteps: ["10m"],
  maximumIntervalDays: 36500,
  /** Anki's "Next day starts at": review cards fall due from this hour, local time. */
  dayStartsAtHour: 4,
  /** Tag (don't suspend) a card as a leech after this many lapses, then every half again. */
  leechThreshold: 8,
  /** Anki's "Maximum answer seconds": longer answers are logged as this. */
  maxAnswerSeconds: 60,
} as const;

const scheduler = fsrs(
  generatorParameters({
    request_retention: SCHEDULER_SETTINGS.desiredRetention,
    maximum_interval: SCHEDULER_SETTINGS.maximumIntervalDays,
    learning_steps: SCHEDULER_SETTINGS.learningSteps,
    relearning_steps: SCHEDULER_SETTINGS.relearningSteps,
    enable_fuzz: true,
    enable_short_term: true,
  }),
);

/**
 * Anki counts review intervals in days that begin at `dayStartsAtHour`, so a
 * card due "in 1 day" is available all of tomorrow, not from this exact minute
 * tomorrow. Snap day-scale due dates back to the start of their study day so
 * the day's due count is stable from the morning on. Uses the server's local
 * time zone, which is the learner's while the app runs on their machine.
 */
export function startOfStudyDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(SCHEDULER_SETTINGS.dayStartsAtHour, 0, 0, 0);
  if (start > date) start.setDate(start.getDate() - 1);
  return start;
}

/** True when this answer pushes the card to (another) leech milestone. */
export function isLeechMilestone(lapses: number, previousLapses: number): boolean {
  const { leechThreshold } = SCHEDULER_SETTINGS;
  if (lapses <= previousLapses || lapses < leechThreshold) return false;
  const step = Math.max(1, Math.ceil(leechThreshold / 2));
  return (lapses - leechThreshold) % step === 0;
}

// Prisma stores state as an enum for readability; ts-fsrs uses a numeric enum.
const STATE_TO_FSRS: Record<FsrsState, State> = {
  NEW: State.New,
  LEARNING: State.Learning,
  REVIEW: State.Review,
  RELEARNING: State.Relearning,
};

const FSRS_TO_STATE: Record<State, FsrsState> = {
  [State.New]: FsrsState.NEW,
  [State.Learning]: FsrsState.LEARNING,
  [State.Review]: FsrsState.REVIEW,
  [State.Relearning]: FsrsState.RELEARNING,
};

/** The subset of a Card row that carries scheduling state. */
export type SchedulingState = {
  state: FsrsState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  lastReview: Date | null;
};

export function newCardState(now = new Date()): SchedulingState {
  return fromFsrsCard(createEmptyCard(now));
}

function toFsrsCard(card: SchedulingState): FsrsCard {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_FSRS[card.state],
    last_review: card.lastReview ?? undefined,
  };
}

function fromFsrsCard(card: FsrsCard): SchedulingState {
  return {
    state: FSRS_TO_STATE[card.state],
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    lastReview: card.last_review ?? null,
  };
}

export type ReviewOutcome = {
  next: SchedulingState;
  /** Snapshot for the immutable Review log. */
  log: {
    rating: RatingValue;
    state: FsrsState;
    due: Date;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    lastElapsedDays: number;
    scheduledDays: number;
  };
};

/** Apply one answer to a card and return its new schedule. */
export function applyReview(
  card: SchedulingState,
  rating: RatingValue,
  now = new Date(),
): ReviewOutcome {
  const { card: updated, log } = scheduler.next(
    toFsrsCard(card),
    now,
    rating as Grade,
  );
  const next = fromFsrsCard(updated);
  // Day-scale intervals start at the study-day boundary; minute-scale
  // learning steps keep their exact time.
  if (next.state === FsrsState.REVIEW && next.scheduledDays >= 1) {
    next.due = startOfStudyDay(next.due);
  }

  return {
    next,
    log: {
      rating,
      state: next.state,
      due: next.due,
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.last_elapsed_days,
      scheduledDays: log.scheduled_days,
    },
  };
}

/**
 * What each button would schedule, so the study screen can show intervals
 * before the learner commits to an answer.
 */
export function previewIntervals(
  card: SchedulingState,
  now = new Date(),
): Record<RatingValue, Date> {
  const record = scheduler.repeat(toFsrsCard(card), now);
  return {
    1: record[Rating.Again].card.due,
    2: record[Rating.Hard].card.due,
    3: record[Rating.Good].card.due,
    4: record[Rating.Easy].card.due,
  };
}

export type MemorySnapshot = {
  state: FsrsState;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
};

/**
 * Replays a card's answer history from a blank card and returns the FSRS
 * memory state after each answer. `history` must be in chronological order.
 *
 * Used when importing from Anki: its review log records ratings and intervals
 * but not stability/difficulty, and cards reviewed before FSRS was switched on
 * have no memory state at all.
 */
export function replayHistory(
  history: { rating: RatingValue; reviewedAt: Date }[],
): MemorySnapshot[] {
  if (history.length === 0) return [];
  let card = createEmptyCard(history[0].reviewedAt);
  return history.map(({ rating, reviewedAt }) => {
    const { card: next, log } = scheduler.next(card, reviewedAt, rating as Grade);
    card = next;
    return {
      state: FSRS_TO_STATE[next.state],
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.last_elapsed_days,
    };
  });
}

/** 0–1 probability the learner still remembers this card right now. */
export function retrievability(card: SchedulingState, now = new Date()): number {
  if (card.state === FsrsState.NEW) return 0;
  return scheduler.get_retrievability(toFsrsCard(card), now, false) as number;
}

export function isRatingValue(value: unknown): value is RatingValue {
  return value === 1 || value === 2 || value === 3 || value === 4;
}
