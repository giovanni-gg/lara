// Daily caps on what costs a model call, for every account but the owner's.
// Pure (no database), so the routes, the forms and unit tests share one rule;
// the counting against Postgres lives in `allowance.ts`.

import { DEFAULT_EMAIL } from "./auth";
import { cardTypesFor } from "./card-direction";
import { cardJobPhase } from "./card-job-status";
import type { CardDirection, CardJobStatus } from "@/generated/prisma/enums";

/** AI-made cards per study day (card rows: a "Both" word is two). */
export const DAILY_CARD_LIMIT = 100;
/** Stories per study day, failed ones included: each cost a model call. */
export const DAILY_STORY_LIMIT = 5;

/**
 * The one account with no caps: LARA_OWNER_EMAIL, else the default account
 * (LARA_USER_EMAIL, else you@lara.local).
 */
export function ownerEmail(): string {
  return (process.env.LARA_OWNER_EMAIL || process.env.LARA_USER_EMAIL || DEFAULT_EMAIL).toLowerCase();
}

/** Whether this account skips the daily caps. Only the owner does. */
export function isUnlimited(email: string): boolean {
  return email.toLowerCase() === ownerEmail();
}

/** What's left of a daily allowance; never negative. */
export function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/** Card rows one word becomes in a deck with this direction ("Both" is two). */
export function cardsPerWord(direction: CardDirection | null | undefined): number {
  return cardTypesFor(direction ?? "RECOGNITION").length;
}

export type CardJobUsage = {
  status: CardJobStatus;
  createdAt: Date | string;
  /** Words asked for. */
  count: number;
  /** Card rows made so far. */
  created: number;
  /** The direction asked for, else the deck's. */
  direction: CardDirection | null;
};

/**
 * How much of the allowance a job uses: a running job holds everything it may
 * still make, so two jobs at once can't both fit under the cap; a finished or
 * failed one only what it actually made.
 */
export function cardsUsedBy(job: CardJobUsage, now: Date = new Date()): number {
  if (cardJobPhase(job, now) !== "running") return job.created;
  return Math.max(job.created, job.count * cardsPerWord(job.direction));
}

const RESET = "It resets at 04:00.";

/** Why a batch of cards was refused. */
export function cardLimitMessage(left: number, perWord = 1): string {
  const head = `Daily limit reached: you can create ${DAILY_CARD_LIMIT} cards a day.`;
  if (left === 0) return `${head} ${RESET}`;
  const each = perWord > 1 ? ` This deck makes ${perWord} cards per word.` : "";
  return `${head} ${left} left today.${each}`;
}

/** Why a story was refused. */
export function storyLimitMessage(): string {
  return `Daily limit reached: you can write ${DAILY_STORY_LIMIT} stories a day. ${RESET}`;
}
