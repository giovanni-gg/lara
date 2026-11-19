import { describe, expect, it } from "vitest";
import {
  backgroundVocabulary,
  cleanCardText,
  sampleDeckVocabulary,
} from "./story-vocabulary";

describe("cleanCardText", () => {
  it("strips markup, sound tags and trailing usage notes", () => {
    expect(cleanCardText("<b>en hund</b>[sound:hund.mp3]")).toBe("en hund");
    expect(cleanCardText("vou comprar — 'ska + infinitiv' = futuro")).toBe(
      "vou comprar",
    );
    expect(cleanCardText("att&nbsp;springa")).toBe("att springa");
  });

  it("drops placeholders, blanks and paragraphs", () => {
    expect(cleanCardText("Front")).toBeNull();
    expect(cleanCardText("(blank)")).toBeNull();
    expect(cleanCardText("   ")).toBeNull();
    expect(cleanCardText("ord ".repeat(30))).toBeNull();
  });
});

describe("sampleDeckVocabulary", () => {
  const cards = [
    { target: "hund", source: "dog", reps: 3 },
    { target: "Hund", source: "dog", reps: 1 }, // the reversed card
    { target: "katt", source: "cat", reps: 2 },
    { target: "häst", source: "horse", reps: 0 },
    { target: "ko", source: "cow", reps: 0 },
    { target: "Front", source: "Back", reps: 5 },
  ];

  it("splits studied from unstudied and collapses duplicates", () => {
    const { studied, unstudied } = sampleDeckVocabulary(cards, {
      studied: 10,
      unstudied: 10,
    });
    expect(studied.map((w) => w.target).sort()).toEqual(["hund", "katt"]);
    expect(unstudied.map((w) => w.target).sort()).toEqual(["häst", "ko"]);
    expect(studied.find((w) => w.target === "hund")?.source).toBe("dog");
  });

  it("respects the caps", () => {
    const { studied, unstudied } = sampleDeckVocabulary(cards, {
      studied: 1,
      unstudied: 0,
    });
    expect(studied).toHaveLength(1);
    expect(unstudied).toHaveLength(0);
  });

  it("varies with the random source", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      target: `ord${i}`,
      source: `word${i}`,
      reps: 1,
    }));
    const a = sampleDeckVocabulary(many, { studied: 5, unstudied: 0 }, () => 0);
    const b = sampleDeckVocabulary(many, { studied: 5, unstudied: 0 }, () => 0.99);
    expect(a.studied).not.toEqual(b.studied);
  });
});

describe("backgroundVocabulary", () => {
  it("cleans, dedupes and skips words already in the deck list", () => {
    expect(
      backgroundVocabulary(
        ["hund", "<i>bil</i>", "Bil", "katt", "Front"],
        [{ target: "Katt", source: "cat" }],
        10,
      ),
    ).toEqual(["hund", "bil"]);
  });
});
