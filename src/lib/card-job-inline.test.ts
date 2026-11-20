import { describe, expect, it } from "vitest";
import { inlineCardJobText, jobsForDeck, newDeckJobs, newDeckJobText, type WatchedCardJob } from "./card-job-inline";
import { toCardJobView, type CardJobFields } from "./card-job-status";

const now = new Date("2026-11-20T12:00:00Z");

function job(overrides: Partial<CardJobFields> = {}, watch: Partial<WatchedCardJob> = {}): WatchedCardJob {
  const fields: CardJobFields = {
    id: "job",
    status: "WRITING",
    createdAt: new Date(now.getTime() - 30_000),
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
  return { ...toCardJobView(fields, now), newDeck: false, announced: false, ...watch };
}

describe("inlineCardJobText", () => {
  it("leaves out the deck's name, which is right above it", () => {
    expect(inlineCardJobText(job({ status: "QUEUED" }))).toBe("Writing 5 cards…");
    expect(inlineCardJobText(job({ count: 1 }))).toBe("Writing 1 card…");
  });

  it("keeps the stage counts", () => {
    expect(inlineCardJobText(job({ status: "AUDIO", done: 3 }))).toBe("Recording audio 3/5…");
    expect(inlineCardJobText(job({ status: "PICTURES", done: 2 }))).toBe("Drawing pictures 2/5…");
  });

  it("says how many cards were added", () => {
    expect(inlineCardJobText(job({ status: "DONE", created: 5 }))).toBe("5 new cards added");
    expect(inlineCardJobText(job({ status: "DONE", created: 1 }))).toBe("1 new card added");
    expect(inlineCardJobText(job({ status: "DONE", created: 0 }))).toBe("No new cards — all were duplicates");
  });

  it("gives a failure's reason", () => {
    expect(inlineCardJobText(job({ status: "FAILED", error: "Daily limit reached" }))).toBe("Daily limit reached");
  });
});

describe("jobsForDeck", () => {
  it("keeps the deck's own jobs only", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", deckId: "other" }), job({ id: "c", deckId: null })];
    expect(jobsForDeck(jobs, "deck").map((j) => j.id)).toEqual(["a"]);
  });
});

describe("newDeckJobs", () => {
  const known = new Set(["deck"]);

  it("holds a place for a deck the model hasn't named", () => {
    const jobs = [job({ id: "new", deckId: null, deckName: null }, { newDeck: true }), job({ id: "old" })];
    expect(newDeckJobs(jobs, known).map((j) => j.id)).toEqual(["new"]);
  });

  it("keeps the place until the list has the new deck, then lets its row take over", () => {
    const named = job({ id: "new", deckId: "fresh", deckName: "Food", status: "AUDIO" }, { newDeck: true });
    expect(newDeckJobs([named], known)).toHaveLength(1);
    expect(newDeckJobs([named], new Set(["deck", "fresh"]))).toHaveLength(0);
  });

  it("never turns a job for an existing deck into a placeholder, even one not listed (archived)", () => {
    expect(newDeckJobs([job({ deckId: "archived" })], known)).toHaveLength(0);
  });

  it("keeps a failed new deck, so it can be retried", () => {
    const failed = job({ deckId: null, deckName: null, status: "FAILED", error: "No AI" }, { newDeck: true });
    expect(newDeckJobs([failed], known)).toHaveLength(1);
  });
});

describe("newDeckJobText", () => {
  it("names the prompt while the deck has no name", () => {
    expect(newDeckJobText(job({ deckId: null, deckName: null, prompt: " ordering food " }))).toBe(
      "Creating a new deck: “ordering food”…",
    );
  });

  it("falls back to the stage text once it has one, or when it failed", () => {
    expect(newDeckJobText(job({ deckId: "fresh", deckName: "Food", status: "AUDIO", done: 1 }))).toBe(
      "Recording audio 1/5…",
    );
    expect(newDeckJobText(job({ deckId: null, status: "FAILED", error: "No AI" }))).toBe("No AI");
  });
});
