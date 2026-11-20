import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cardLimitMessage,
  cardsPerWord,
  cardsUsedBy,
  DAILY_CARD_LIMIT,
  DAILY_STORY_LIMIT,
  isUnlimited,
  ownerEmail,
  remaining,
  storyLimitMessage,
  type CardJobUsage,
} from "./limits";
import { CARD_JOB_STALE_AFTER_MS } from "./card-job-status";

const ENV_KEYS = ["LARA_OWNER_EMAIL", "LARA_USER_EMAIL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("who is unlimited", () => {
  it("is the default account when nothing is configured", () => {
    expect(ownerEmail()).toBe("you@lara.local");
    expect(isUnlimited("you@lara.local")).toBe(true);
    expect(isUnlimited("ebba@lara.local")).toBe(false);
  });

  it("follows LARA_USER_EMAIL, and LARA_OWNER_EMAIL over it", () => {
    process.env.LARA_USER_EMAIL = "me@lara.local";
    expect(isUnlimited("me@lara.local")).toBe(true);
    expect(isUnlimited("you@lara.local")).toBe(false);

    process.env.LARA_OWNER_EMAIL = "Boss@Lara.local";
    expect(isUnlimited("boss@lara.local")).toBe(true);
    expect(isUnlimited("BOSS@lara.local")).toBe(true);
    expect(isUnlimited("me@lara.local")).toBe(false);
  });

  it("ignores an empty LARA_OWNER_EMAIL", () => {
    process.env.LARA_OWNER_EMAIL = "";
    expect(isUnlimited("you@lara.local")).toBe(true);
  });
});

describe("allowance math", () => {
  it("never goes below zero", () => {
    expect(remaining(100, 32)).toBe(68);
    expect(remaining(100, 100)).toBe(0);
    expect(remaining(5, 7)).toBe(0);
  });

  it("counts two card rows per word only for Both", () => {
    expect(cardsPerWord("BOTH")).toBe(2);
    expect(cardsPerWord("PICTURE")).toBe(1);
    expect(cardsPerWord("PRODUCTION")).toBe(1);
    expect(cardsPerWord(null)).toBe(1);
  });

  const now = new Date("2026-03-10T12:00:00");
  const job = (overrides: Partial<CardJobUsage>): CardJobUsage => ({
    status: "WRITING",
    createdAt: now,
    count: 10,
    created: 0,
    direction: null,
    ...overrides,
  });

  it("holds a running job's whole batch, so parallel jobs can't overshoot", () => {
    expect(cardsUsedBy(job({}), now)).toBe(10);
    expect(cardsUsedBy(job({ direction: "BOTH" }), now)).toBe(20);
    expect(cardsUsedBy(job({ status: "AUDIO", created: 4 }), now)).toBe(10);
  });

  it("charges a finished, failed or lost job only what it made", () => {
    expect(cardsUsedBy(job({ status: "DONE", created: 7 }), now)).toBe(7);
    expect(cardsUsedBy(job({ status: "FAILED", created: 3 }), now)).toBe(3);
    const lost = job({ createdAt: new Date(now.getTime() - CARD_JOB_STALE_AFTER_MS - 1), created: 2 });
    expect(cardsUsedBy(lost, now)).toBe(2);
  });
});

describe("messages", () => {
  it("says how many are left, or when it resets", () => {
    expect(cardLimitMessage(23)).toBe(
      `Daily limit reached: you can create ${DAILY_CARD_LIMIT} cards a day. 23 left today.`,
    );
    expect(cardLimitMessage(23, 2)).toContain("This deck makes 2 cards per word.");
    expect(cardLimitMessage(0)).toBe(
      `Daily limit reached: you can create ${DAILY_CARD_LIMIT} cards a day. It resets at 04:00.`,
    );
    expect(storyLimitMessage()).toBe(
      `Daily limit reached: you can write ${DAILY_STORY_LIMIT} stories a day. It resets at 04:00.`,
    );
  });
});
