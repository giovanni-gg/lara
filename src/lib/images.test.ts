import { describe, expect, it } from "vitest";
import { ART_STYLES, IMAGE_MODEL, buildImagePrompt, randomStyleIndex } from "./images";

const apple = { target: "äpple", source: "apple", targetLanguage: "sv", sourceLanguage: "en" };

describe("buildImagePrompt", () => {
  it("names the word with its translation and languages", () => {
    const prompt = buildImagePrompt(apple, 0);
    expect(prompt).toContain('learning a new language: "äpple (apple)"');
    expect(prompt).toContain('"äpple" is Swedish for "apple" (English)');
    expect(prompt).toContain('the concept "äpple (apple)" in the specified art style');
  });

  it("keeps all text out of the image", () => {
    const prompt = buildImagePrompt(apple, 0);
    expect(prompt).toContain("- NO TEXT (no letters, numbers, labels, or words)");
    expect(prompt).toContain("never write either word in the image");
    expect(prompt).toContain("make sure to not use any text in the image");
  });

  it("asks for the split literal / creative layout", () => {
    const prompt = buildImagePrompt(apple, 0);
    expect(prompt).toContain("SPLIT IMAGE with a subtle vertical divider line in the middle");
    expect(prompt).toContain("- LEFT HALF: LITERAL representation");
    expect(prompt).toContain("- RIGHT HALF: CREATIVE/FUN representation");
  });

  it("uses the style it is given, deterministically", () => {
    ART_STYLES.forEach((style, i) => {
      const prompt = buildImagePrompt(apple, i);
      expect(prompt).toContain(`Art Style: ${style.description}`);
      expect(buildImagePrompt(apple, i)).toBe(prompt);
      for (const other of ART_STYLES) {
        if (other !== style) expect(prompt).not.toContain(other.description);
      }
    });
    // Out-of-range indexes wrap instead of crashing.
    expect(buildImagePrompt(apple, ART_STYLES.length)).toBe(buildImagePrompt(apple, 0));
    expect(buildImagePrompt(apple, -1)).toBe(buildImagePrompt(apple, ART_STYLES.length - 1));
  });

  it("for Ebba, draws the Portuguese word with its Swedish translation", () => {
    const prompt = buildImagePrompt(
      { target: "maçã", source: "äpple", targetLanguage: "pt", sourceLanguage: "sv" },
      2,
    );
    expect(prompt).toContain('"maçã (äpple)"');
    expect(prompt).toContain('"maçã" is Portuguese for "äpple" (Swedish)');
  });
});

describe("the art styles and model", () => {
  it("carries over anki_creator's six styles", () => {
    expect(ART_STYLES.map((s) => s.name)).toEqual([
      "Pixar/Disney 3D",
      "Retro 1950s Advertising",
      "Children's Storybook",
      "Ligne Claire (Tintin)",
      "Scandinavian Design",
      "Mid-Century Modern",
    ]);
  });

  it("picks a style from the set", () => {
    for (let i = 0; i < 50; i++) {
      const index = randomStyleIndex();
      expect(Number.isInteger(index) && index >= 0 && index < ART_STYLES.length).toBe(true);
    }
  });

  it("is a Flash/Lite image model, never Pro", () => {
    expect(IMAGE_MODEL).toMatch(/flash/);
    expect(IMAGE_MODEL).not.toMatch(/pro/);
  });
});
