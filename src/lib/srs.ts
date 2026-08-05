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

const scheduler = fsrs(
  generatorParameters({
    // 0.9 means "aim to recall 90% of cards at review time" — Anki's default.
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
  }),
);

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

/** 0–1 probability the learner still remembers this card right now. */
export function retrievability(card: SchedulingState, now = new Date()): number {
  if (card.state === FsrsState.NEW) return 0;
  return scheduler.get_retrievability(toFsrsCard(card), now, false) as number;
}

export function isRatingValue(value: unknown): value is RatingValue {
  return value === 1 || value === 2 || value === 3 || value === 4;
}
