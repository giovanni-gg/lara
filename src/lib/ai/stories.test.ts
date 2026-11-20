// Stories are set in the reader's world when "About you" says something
// about it, unless their request says otherwise. Pure prompt wording; no model.

import { describe, expect, it } from "vitest";
import { storyPrompt } from "./stories";

const NOTE = "They work in data engineering and are moving to Stockholm in May.";

describe("storyPrompt and the note about the reader", () => {
  it("sets the story in the reader's world when they didn't ask for anything", () => {
    const text = storyPrompt({ length: "short", learner: NOTE });
    expect(text).toContain(`About the learner (from their profile):\n${NOTE}`);
    expect(text).toContain("Set the story in their world");
    expect(text).toContain("Never invent facts about the learner");
    expect(text).toContain("not in every item");
    expect(text).toContain("don't tell the story as the reader's own life");
  });

  it("lets the reader's request come first", () => {
    const text = storyPrompt({ length: "short", prompt: "a heist on the moon", learner: NOTE });
    expect(text).toContain("The reader asked for: a heist on the moon");
    expect(text).toContain("Their request comes first: where it doesn't say otherwise, set the story in their world");
    // The request is stated before the note.
    expect(text.indexOf("a heist on the moon")).toBeLessThan(text.indexOf(NOTE));
  });

  it("is unchanged without a note", () => {
    for (const learner of [undefined, null, " "]) {
      const text = storyPrompt({ length: "medium", prompt: "a market", learner });
      expect(text).toBe(storyPrompt({ length: "medium", prompt: "a market" }));
      expect(text).not.toContain("About the learner");
      expect(text).not.toContain("their world");
    }
  });
});
