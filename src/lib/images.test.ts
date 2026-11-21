import { describe, expect, it } from "vitest";
import { ART_STYLES, IMAGE_MODEL, buildImagePrompt, randomStyleIndex } from "./images";

const apple = { target: "äpple", source: "apple", targetLanguage: "sv", sourceLanguage: "en" };

describe("buildImagePrompt", () => {
  it("gives the word and its meaning once, as context the model must not draw", () => {
    const prompt = buildImagePrompt(apple, 0);
    expect(prompt).toContain('NEVER draw or write it): the Swedish word "äpple", meaning "apple" in English.');
    // Quoted words get copied into pictures: each appears exactly once.
    expect(prompt.split("äpple").length - 1).toBe(1);
    expect(prompt.split('"apple"').length - 1).toBe(1);
  });

  it("keeps all text out of the image, and says why", () => {
    const prompt = buildImagePrompt(apple, 0);
    expect(prompt).toContain("must work out the word from it");
    expect(prompt).toContain("Any text in the picture gives the answer away");
    expect(prompt).toContain("- ABSOLUTELY NO TEXT: no letters, words, names, labels, captions");
    expect(prompt).toContain("with no text anywhere in the image");
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
    expect(prompt).toContain('the Portuguese word "maçã", meaning "äpple" in Swedish.');
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
