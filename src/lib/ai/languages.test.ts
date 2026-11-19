// Every AI prompt must keep the two languages straight: the TARGET language
// (what the learner is learning) for the material itself, the SOURCE language
// (what they speak) for translations and explanations. Lara has a Swedish
// learner who speaks English and a Portuguese learner who speaks Swedish, so
// each prompt is checked for both — the AI SDK is mocked, nothing is called.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { instructions?: string; system?: string; prompt?: string }[] = [];

vi.mock("ai", () => ({
  generateObject: vi.fn(async (options: { instructions?: string; prompt?: string }) => {
    calls.push(options);
    return {
      object: {
        deckName: "x",
        emoji: "x",
        cards: [],
        title: "t",
        titleTranslated: "t",
        segments: [],
        reusedVocabulary: [],
        newVocabulary: [],
      },
    };
  }),
  streamText: vi.fn((options: { system?: string }) => {
    calls.push(options);
    return {};
  }),
}));
vi.mock("./model", () => ({ getModel: () => "mock-model", assertAiCredentials: () => {}, hasAiCredentials: () => true }));

const { generateCards } = await import("./cards");
const { generateStory } = await import("./stories");
const { instructionsFor } = await import("./tutor");

const LEARNERS = [
  { name: "Giovanni", targetLanguage: "sv", sourceLanguage: "en", target: "Swedish", source: "English" },
  { name: "Ebba", targetLanguage: "pt", sourceLanguage: "sv", target: "Portuguese", source: "Swedish" },
] as const;

beforeEach(() => {
  calls.length = 0;
});

describe.each(LEARNERS)("prompts for $name ($target from $source)", (learner) => {
  it("card generation puts the material in the target language and translations/notes in the source", async () => {
    await generateCards({
      prompt: "food",
      targetLanguage: learner.targetLanguage,
      sourceLanguage: learner.sourceLanguage,
      level: "A2",
      count: 5,
      existingTargets: [],
    });
    const text = calls[0].instructions ?? "";
    expect(text).toContain(`learning ${learner.target} who speaks ${learner.source}`);
    expect(text).toContain(`"target" and "targetSentence" are in ${learner.target}`);
    expect(text).toContain(`"source", "sourceSentence", "notes" and the deck title are in ${learner.source}`);
  });

  it("stories are written in the target language and translated into the source", async () => {
    await generateStory({
      targetLanguage: learner.targetLanguage,
      sourceLanguage: learner.sourceLanguage,
      level: "A2",
      length: "short",
      knownVocabulary: [],
    });
    const text = calls[0].instructions ?? "";
    expect(text).toContain(`short fiction in ${learner.target}`);
    expect(text).toContain(`native language is ${learner.source}`);
    expect(text).toContain(`"titleTranslated" is in ${learner.source}`);
    // One level above the learner (A2 → B1).
    expect(text).toContain("Write at CEFR B1");
  });

  it("the card tutor explains in the source language, with examples in the target", () => {
    const text = instructionsFor({
      target: "word",
      source: "translation",
      targetSentence: null,
      sourceSentence: null,
      notes: null,
      targetLanguage: learner.targetLanguage,
      sourceLanguage: learner.sourceLanguage,
      level: "A2",
    });
    expect(text).toContain(`${learner.target} tutor helping a ${learner.source} speaker`);
    expect(text).toContain(`- ${learner.target}: word`);
    expect(text).toContain(`- ${learner.source}: translation`);
    expect(text).toContain(`Write explanations in ${learner.source}. Keep ${learner.target} for the examples`);
  });
});

describe("the two learners never get each other's languages", () => {
  it("Ebba's prompts don't mention English as a language to write in", async () => {
    const ebba = LEARNERS[1];
    await generateCards({
      prompt: "food",
      targetLanguage: ebba.targetLanguage,
      sourceLanguage: ebba.sourceLanguage,
      level: "A1",
      count: 5,
      existingTargets: [],
    });
    expect(calls[0].instructions).not.toMatch(/are in English/);
  });
});
