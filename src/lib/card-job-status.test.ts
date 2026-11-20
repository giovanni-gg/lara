import { describe, expect, it } from "vitest";
import {
  CARD_JOB_STALE_AFTER_MS,
  cardJobLimitReached,
  cardJobPhase,
  cardJobText,
  isStaleCardJob,
  STALE_ERROR,
  toCardJobView,
  type CardJobFields,
} from "./card-job-status";
import type { CardJobStatus } from "@/generated/prisma/enums";

const now = new Date("2026-11-20T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

function job(overrides: Partial<CardJobFields> = {}): CardJobFields {
  return {
    id: "job",
    status: "WRITING",
    createdAt: ago(30_000),
    deckId: "deck",
    deckName: "Adjectives",
    prompt: "",
    count: 5,
    direction: null,
    done: 0,
    total: 5,
    created: 0,
    error: null,
    ...overrides,
  };
}

describe("cardJobText", () => {
  it("names the deck while writing", () => {
    expect(cardJobText(job({ status: "QUEUED" }), now)).toBe("Writing 5 cards for Adjectives…");
    expect(cardJobText(job(), now)).toBe("Writing 5 cards for Adjectives…");
    expect(cardJobText(job({ count: 1 }), now)).toBe("Writing 1 card for Adjectives…");
  });

  it("quotes the prompt while a new deck has no name yet", () => {
    expect(cardJobText(job({ deckId: null, deckName: null, prompt: "ordering food" }), now)).toBe(
      "Writing 5 cards for “ordering food”…",
    );
    const long = cardJobText(job({ deckName: null, prompt: "phrases for a job interview at a bank" }), now);
    expect(long).toBe("Writing 5 cards for “phrases for a job interview…”…");
  });

  it("counts the current stage", () => {
    expect(cardJobText(job({ status: "AUDIO", done: 3, total: 5 }), now)).toBe("Recording audio 3/5…");
    expect(cardJobText(job({ status: "PICTURES", done: 2, total: 5 }), now)).toBe("Drawing pictures 2/5…");
  });

  it("says how many cards landed where", () => {
    expect(cardJobText(job({ status: "DONE", created: 5 }), now)).toBe("5 new cards in Adjectives");
    expect(cardJobText(job({ status: "DONE", created: 1 }), now)).toBe("1 new card in Adjectives");
    expect(cardJobText(job({ status: "DONE", created: 0 }), now)).toBe(
      "No new cards for Adjectives — all were duplicates",
    );
  });

  it("gives the reason for a failure, or that a lost job timed out", () => {
    expect(cardJobText(job({ status: "FAILED", error: "Model overloaded" }), now)).toBe("Model overloaded");
    expect(cardJobText(job({ status: "FAILED" }), now)).toBe("Couldn't make the cards");
    expect(cardJobText(job({ status: "AUDIO", createdAt: ago(CARD_JOB_STALE_AFTER_MS + 1) }), now)).toBe(
      STALE_ERROR,
    );
  });
});

describe("stale detection", () => {
  it("treats an in-progress job older than 10 minutes as failed", () => {
    const old = job({ createdAt: ago(CARD_JOB_STALE_AFTER_MS + 1) });
    expect(isStaleCardJob(old, now)).toBe(true);
    expect(cardJobPhase(old, now)).toBe("failed");

    const recent = job({ createdAt: ago(CARD_JOB_STALE_AFTER_MS - 1000) });
    expect(isStaleCardJob(recent, now)).toBe(false);
    expect(cardJobPhase(recent, now)).toBe("running");
  });

  it("never calls a finished job stale", () => {
    const createdAt = ago(CARD_JOB_STALE_AFTER_MS * 3);
    expect(isStaleCardJob(job({ status: "DONE", createdAt }), now)).toBe(false);
    expect(cardJobPhase(job({ status: "DONE", createdAt }), now)).toBe("done");
  });

  it("accepts the ISO string the endpoint sends", () => {
    const view = toCardJobView(job({ createdAt: ago(CARD_JOB_STALE_AFTER_MS + 1) }), now);
    expect(cardJobPhase(view, now)).toBe("failed");
  });
});

describe("cardJobLimitReached", () => {
  const timing = (status: CardJobStatus, msAgo = 1000) => ({ status, createdAt: ago(msAgo) });

  it("allows up to 3 jobs in progress", () => {
    expect(cardJobLimitReached([], now)).toBe(false);
    expect(cardJobLimitReached([timing("QUEUED"), timing("AUDIO")], now)).toBe(false);
    expect(cardJobLimitReached([timing("QUEUED"), timing("WRITING"), timing("PICTURES")], now)).toBe(true);
  });

  it("doesn't count finished or stale jobs", () => {
    const stale = timing("WRITING", CARD_JOB_STALE_AFTER_MS + 1);
    expect(
      cardJobLimitReached([timing("WRITING"), timing("AUDIO"), timing("DONE"), timing("FAILED"), stale], now),
    ).toBe(false);
  });
});
