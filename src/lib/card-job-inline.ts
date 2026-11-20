// Where a card job shows up in the decks section, and what it says there.
// Pure, so the client watcher (src/components/card-jobs.tsx) and unit tests
// agree without a database. The stage text itself is card-job-status.ts's.

import type { CardJobView } from "./card-job-status";

/** A job as the watcher holds it: plus whether it began without a deck. */
export type WatchedCardJob = CardJobView & {
  /** First seen before the model had named its new deck (deckId null). */
  newDeck: boolean;
  /** Queued from a form on this page, so it also shows under that form. */
  announced: boolean;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The line under a deck's name. The name is right above it, so it's the
 * stage text without it: "Writing 5 cards…", "Recording audio 3/5…",
 * "5 new cards added". A failure is its reason.
 */
export function inlineCardJobText(job: Pick<CardJobView, "phase" | "status" | "count" | "created" | "text">): string {
  if (job.phase === "failed") return job.text;
  if (job.phase === "done") {
    return job.created === 0 ? "No new cards — all were duplicates" : `${plural(job.created, "new card")} added`;
  }
  return job.status === "AUDIO" || job.status === "PICTURES" ? job.text : `Writing ${plural(job.count, "card")}…`;
}

/** The jobs adding to this deck (its own, not its subdecks'), oldest first. */
export function jobsForDeck<T extends Pick<CardJobView, "deckId">>(jobs: T[], deckId: string): T[] {
  return jobs.filter((job) => job.deckId === deckId);
}

/**
 * Jobs making a new deck that the list can't show as a row yet: the model
 * hasn't named it, or it has but the refreshed list hasn't arrived. Once the
 * deck is in `knownDeckIds` the job moves onto that deck's row.
 */
export function newDeckJobs<T extends Pick<WatchedCardJob, "deckId" | "newDeck">>(
  jobs: T[],
  knownDeckIds: ReadonlySet<string>,
): T[] {
  return jobs.filter((job) => !job.deckId || (job.newDeck && !knownDeckIds.has(job.deckId)));
}

/** The placeholder row's line: "Creating a new deck: “ordering food”…" until it has a name. */
export function newDeckJobText(job: Pick<CardJobView, "phase" | "deckId" | "prompt" | "text">): string {
  if (job.phase === "running" && !job.deckId) {
    const prompt = job.prompt.trim();
    return prompt ? `Creating a new deck: “${prompt}”…` : "Creating a new deck…";
  }
  return job.text;
}
