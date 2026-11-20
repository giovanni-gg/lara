import { prisma } from "./db";
import { startOfStudyDay } from "./srs";
import { cardsUsedBy, DAILY_CARD_LIMIT, DAILY_STORY_LIMIT, isUnlimited, remaining } from "./limits";

// What a limited account has left today (study days start at 04:00); null for
// the owner, who has no caps. The rules are in `limits.ts`. Each is one query
// on an existing (userId, createdAt) index, and none runs for the owner.

type Account = { id: string; email: string };

/**
 * AI cards left today. Counted from the card jobs, not the Card table: manual
 * adds and Anki imports never go through a job, so they never count, and
 * deleting cards doesn't hand the allowance back.
 */
export async function cardsLeftToday(user: Account, now: Date = new Date()): Promise<number | null> {
  if (isUnlimited(user.email)) return null;
  const jobs = await prisma.cardJob.findMany({
    where: { userId: user.id, createdAt: { gte: startOfStudyDay(now) } },
    select: {
      status: true,
      createdAt: true,
      count: true,
      created: true,
      direction: true,
      deck: { select: { direction: true } },
    },
  });
  const used = jobs.reduce(
    (sum, { deck, ...job }) => sum + cardsUsedBy({ ...job, direction: job.direction ?? deck?.direction ?? null }, now),
    0,
  );
  return remaining(DAILY_CARD_LIMIT, used);
}

/** Stories left today. Every story started counts, failed ones too. */
export async function storiesLeftToday(user: Account, now: Date = new Date()): Promise<number | null> {
  if (isUnlimited(user.email)) return null;
  const started = await prisma.article.count({
    where: { userId: user.id, createdAt: { gte: startOfStudyDay(now) } },
  });
  return remaining(DAILY_STORY_LIMIT, started);
}
