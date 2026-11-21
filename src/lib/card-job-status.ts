// The rules behind the "making cards" status pill, kept pure so the client
// pill, the status endpoint and the job runner all agree (and unit tests can
// reach them without a database).

import type { CardDirection, CardJobStatus } from "@/generated/prisma/enums";

/** How many card batches one learner may have in the works at once. */
export const MAX_CARD_JOBS_IN_PROGRESS = 3;

/**
 * A job still in progress after this was lost (crash, the 300 s function
 * limit) and counts as failed. Same rule as stories.
 */
export const CARD_JOB_STALE_AFTER_MS = 10 * 60_000;

export const IN_PROGRESS_STATUSES = ["QUEUED", "WRITING", "AUDIO", "PICTURES"] as const satisfies readonly CardJobStatus[];

/** What the reason says for a job that was lost rather than failed outright. */
export const STALE_ERROR = "Took too long and was stopped";

type JobTiming = { status: CardJobStatus; createdAt: Date | string };

const isInProgressStatus = (status: CardJobStatus) =>
  (IN_PROGRESS_STATUSES as readonly CardJobStatus[]).includes(status);

/** An in-progress job that has been going for longer than any job can run. */
export function isStaleCardJob(job: JobTiming, now: Date = new Date()): boolean {
  return (
    isInProgressStatus(job.status) &&
    now.getTime() - new Date(job.createdAt).getTime() > CARD_JOB_STALE_AFTER_MS
  );
}

/** Why a second batch for the same deck is refused (409). */
export const DECK_BUSY_ERROR = "Cards are already being created for this deck.";

/**
 * True while a job is still adding cards to this deck: one batch per deck at
 * a time. Stale and finished jobs don't hold it; nor do other decks' jobs.
 */
export function deckJobRunning(
  jobs: (JobTiming & { deckId: string | null })[],
  deckId: string,
  now: Date = new Date(),
): boolean {
  return jobs.some((job) => job.deckId === deckId && cardJobPhase(job, now) === "running");
}

export type CardJobPhase = "running" | "done" | "failed";

export function cardJobPhase(job: JobTiming, now: Date = new Date()): CardJobPhase {
  if (job.status === "DONE") return "done";
  if (job.status === "FAILED" || isStaleCardJob(job, now)) return "failed";
  return "running";
}

/** True when another job would go over the limit. Stale and finished jobs don't count. */
export function cardJobLimitReached(jobs: JobTiming[], now: Date = new Date()): boolean {
  return jobs.filter((job) => cardJobPhase(job, now) === "running").length >= MAX_CARD_JOBS_IN_PROGRESS;
}

/** The fields the pill needs; what the status endpoint returns per job. */
export type CardJobFields = JobTiming & {
  id: string;
  deckId: string | null;
  deckName: string | null;
  prompt: string;
  count: number;
  direction: CardDirection | null;
  done: number;
  total: number;
  created: number;
  error: string | null;
};

export type CardJobView = Omit<CardJobFields, "createdAt"> & {
  createdAt: string;
  phase: CardJobPhase;
  /** "Writing 5 cards for Adjectives…", "Recording audio 3/5…", … */
  text: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Adjectives", or the prompt in quotes while a new deck has no name yet. */
function subject(job: Pick<CardJobFields, "deckName" | "prompt">): string | null {
  if (job.deckName) return job.deckName;
  const prompt = job.prompt.trim();
  if (!prompt) return null;
  return `“${prompt.length > 28 ? `${prompt.slice(0, 27).trimEnd()}…` : prompt}”`;
}

/** The pill's one line for a job. */
export function cardJobText(job: CardJobFields, now: Date = new Date()): string {
  const phase = cardJobPhase(job, now);
  const about = subject(job);
  if (phase === "failed") {
    return job.status === "FAILED" ? job.error || "Couldn't make the cards" : STALE_ERROR;
  }
  if (phase === "done") {
    if (job.created === 0) return `No new cards${about ? ` for ${about}` : ""} — all were duplicates`;
    return `${plural(job.created, "new card")}${about ? ` in ${about}` : ""}`;
  }
  switch (job.status) {
    case "AUDIO":
      return `Recording audio ${job.done}/${job.total}…`;
    case "PICTURES":
      return `Drawing pictures ${job.done}/${job.total}…`;
    default:
      return `Writing ${plural(job.count, "card")}${about ? ` for ${about}` : ""}…`;
  }
}

export function toCardJobView(job: CardJobFields, now: Date = new Date()): CardJobView {
  return {
    ...job,
    createdAt: new Date(job.createdAt).toISOString(),
    phase: cardJobPhase(job, now),
    text: cardJobText(job, now),
  };
}
