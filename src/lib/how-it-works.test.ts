import { describe, expect, it } from "vitest";
import { directionOptions } from "@/components/direction-picker";
import { PICTURE_FRONT, cardTypeGuide, mixingTip } from "./how-it-works";

const giovanni = { targetLanguage: "sv", sourceLanguage: "en" };
const ebba = { targetLanguage: "pt", sourceLanguage: "sv" };

describe("cardTypeGuide", () => {
  it("names Giovanni's card types Swedish first, English first, Picture first", () => {
    const guide = cardTypeGuide(giovanni);
    expect(guide.map((t) => [t.kind, t.title])).toEqual([
      ["RECOGNITION", "Swedish first"],
      ["PRODUCTION", "English first"],
      ["PICTURE", "Picture first"],
    ]);
    expect(guide[1].body).toContain("come up with the Swedish one");
  });

  it("names Ebba's the other way round, Portuguese first and Swedish first", () => {
    const guide = cardTypeGuide(ebba);
    expect(guide.map((t) => t.title)).toEqual(["Portuguese first", "Swedish first", "Picture first"]);
    expect(guide[0].body).toContain("Portuguese word");
    expect(guide[2].body).toContain("name it in Portuguese");
  });

  it("uses the same titles as the direction picker", () => {
    for (const [profile, target, source] of [
      [giovanni, "Swedish", "English"],
      [ebba, "Portuguese", "Swedish"],
    ] as const) {
      expect(cardTypeGuide(profile).map((t) => [t.kind, t.title])).toEqual(
        directionOptions(target, source).map((o) => [o.value, o.label]),
      );
    }
  });

  it("shows each card's front in the language it's facing", () => {
    const [recognition, production, picture] = cardTypeGuide(ebba);
    expect([recognition.front, recognition.answer]).toEqual(["maçã", "äpple"]);
    expect([production.front, production.answer]).toEqual(["äpple", "maçã"]);
    expect([picture.front, picture.answer]).toEqual([PICTURE_FRONT, "maçã"]);
  });

  it("ranks target first easiest and source first hardest", () => {
    const effort = Object.fromEntries(cardTypeGuide(giovanni).map((t) => [t.kind, t.effort]));
    expect(effort).toEqual({ RECOGNITION: 1, PICTURE: 2, PRODUCTION: 3 });
  });

  it("reads sensibly before there's a profile", () => {
    const guide = cardTypeGuide(null);
    expect(guide.map((t) => t.title)).toEqual([
      "Your new language first",
      "English first",
      "Picture first",
    ]);
    expect(guide[0].answer).toBe("apple");
  });

  it("falls back to the language code for one it doesn't know", () => {
    const [recognition] = cardTypeGuide({ targetLanguage: "fi", sourceLanguage: "en" });
    expect(recognition.title).toBe("FI first");
    expect(recognition.front).toBe("…");
  });
});

describe("mixingTip", () => {
  it("names the learner's languages", () => {
    expect(mixingTip(giovanni)).toMatch(/^Make most decks Swedish first\..* as English first/);
    expect(mixingTip(ebba)).toMatch(/^Make most decks Portuguese first\..* as Swedish first/);
  });
});
