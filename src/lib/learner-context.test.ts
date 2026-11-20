// "About you" → the note every content prompt gets: the distilled summary,
// else (the model was down at save time) the learner's own words, trimmed.

import { describe, expect, it } from "vitest";
import { learnerContext, learnerContextRules, learnerNoteBlock, RAW_CONTEXT_CHARS } from "./learner-context";

describe("learnerContext", () => {
  it("is the summary when there is one", () => {
    expect(
      learnerContext({ about: "long raw text", aboutSummary: "  They are moving to Stockholm.\n They run marathons. " }),
    ).toBe("They are moving to Stockholm. They run marathons.");
  });

  it("falls back to the raw text, whitespace squashed", () => {
    expect(learnerContext({ about: "I live in Lisbon.\n\nI love surfing.", aboutSummary: null })).toBe(
      "I live in Lisbon. I love surfing.",
    );
    expect(learnerContext({ about: "I cook", aboutSummary: "   " })).toBe("I cook");
  });

  it("cuts a long raw text at a word boundary and marks the cut", () => {
    const raw = "word ".repeat(400);
    const context = learnerContext({ about: raw })!;
    expect(context.length).toBeLessThanOrEqual(RAW_CONTEXT_CHARS + 1);
    expect(context.endsWith("word…")).toBe(true);
  });

  it("is null when there is nothing", () => {
    expect(learnerContext(null)).toBeNull();
    expect(learnerContext(undefined)).toBeNull();
    expect(learnerContext({})).toBeNull();
    expect(learnerContext({ about: "  \n ", aboutSummary: "" })).toBeNull();
  });
});

describe("the shared wording", () => {
  it("says to use the note lightly and never invent facts", () => {
    const rules = learnerContextRules("the example sentences");
    expect(rules).toContain("let it shape the example sentences");
    expect(rules).toContain("not in every item");
    expect(rules).toContain("never the same personal fact over and over");
    expect(rules).toContain("Never invent facts about the learner");
  });

  it("labels the note", () => {
    expect(learnerNoteBlock("They run.")).toBe("About the learner (from their profile):\nThey run.");
  });
});
