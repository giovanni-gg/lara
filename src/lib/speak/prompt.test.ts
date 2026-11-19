// The Speak tutor's prompt for both of Lara's learners: Giovanni learns
// Swedish and speaks English; Ebba learns Portuguese and speaks Swedish. The
// conversation must be in the TARGET language, help and the "why" of each
// correction in the SOURCE language, and never the other way round.

import { describe, expect, it } from "vitest";
import {
  greeting,
  MAX_DECK_WORDS,
  SHOW_CORRECTION_TOOL,
  speakOverrides,
  speechSpeed,
  tutorPrompt,
} from "./prompt";

const LEARNERS = [
  { name: "Giovanni", targetLanguage: "sv", sourceLanguage: "en", target: "Swedish", source: "English" },
  { name: "Ebba", targetLanguage: "pt", sourceLanguage: "sv", target: "Portuguese", source: "Swedish" },
] as const;

const deck = {
  label: "Mat · Frukt",
  words: [
    { target: "äpple", source: "apple" },
    { target: "banan", source: "" },
  ],
};

describe.each(LEARNERS)("Speak prompt for $name ($target from $source)", (learner) => {
  const base = {
    learner: { targetLanguage: learner.targetLanguage, sourceLanguage: learner.sourceLanguage, level: "A2" as const },
    topic: "Food & cooking",
  };
  const text = tutorPrompt(base);

  it("puts the conversation in the target language and help in the source language", () => {
    expect(text).toContain(`conversation partner on a voice call with someone learning ${learner.target}`);
    expect(text).toContain(`Their native language is ${learner.source}.`);
    expect(text).toContain(`Speak ${learner.target} by default.`);
    expect(text).toContain(`explain briefly in ${learner.source}`);
    expect(text).toContain(`Then go straight back to ${learner.target}`);
    expect(text).toContain(`Explanations are always in ${learner.source}.`);
  });

  it("handles switching to the source language between turns", () => {
    expect(text).toContain(`They may answer in ${learner.source}, mix ${learner.source} words into their ${learner.target}`);
    expect(text).toContain(
      `to "${learner.sourceLanguage}" before a turn that is mostly ${learner.source}, and back to "${learner.targetLanguage}"`,
    );
  });

  it("pitches at the learner's level, stretching one level up", () => {
    expect(text).toContain(`Speak ${learner.target} at CEFR A2`);
    expect(text).toContain("stretching toward B1");
    const c2 = tutorPrompt({ ...base, learner: { ...base.learner, level: "C2" } });
    expect(c2).toContain(`Speak ${learner.target} at CEFR C2, as you would with a fluent adult.`);
    expect(c2).not.toContain("stretching toward");
  });

  it("leads on the topic with short spoken turns", () => {
    expect(text).toContain("Topic: Food & cooking. You lead it");
    expect(text).toContain("one to three sentences");
    expect(text).toContain("no lists, no markdown");
  });

  it("asks for gentle, non-nitpicking corrections through show_correction, explained in the source language", () => {
    expect(text).toContain(`call ${SHOW_CORRECTION_TOOL} with:`);
    expect(text).toContain(`better: the natural ${learner.target} way to say it`);
    expect(text).toContain(`explanation: one short sentence in ${learner.source} saying why`);
    expect(text).toContain("recast it gently in one short spoken line");
    expect(text).toContain("Don't nitpick.");
    expect(text).toContain("at most one correction per turn");
    expect(text).toContain(`Never correct what they said in ${learner.source}.`);
  });

  it("weaves in the deck's words when a deck is given", () => {
    expect(text).not.toContain("Words they are studying");
    const withDeck = tutorPrompt({ ...base, deck });
    expect(withDeck).toContain('They are studying a deck called "Mat · Frukt"');
    expect(withDeck).toContain("- äpple (apple)");
    expect(withDeck).toContain("- banan");
  });

  it("caps the deck words it lists", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ target: `ord${i}`, source: "" }));
    const withDeck = tutorPrompt({ ...base, deck: { label: "Big", words: many } });
    expect(withDeck).toContain(`- ord${MAX_DECK_WORDS - 1}`);
    expect(withDeck).not.toContain(`- ord${MAX_DECK_WORDS}`);
  });

  it("builds overrides in the target language with the given voice", () => {
    const overrides = speakOverrides({ ...base, voiceId: "voice-123" });
    expect(overrides.agent.language).toBe(learner.targetLanguage);
    expect(overrides.agent.prompt.prompt).toBe(text);
    expect(overrides.agent.firstMessage).toBe(greeting(learner.targetLanguage));
    expect(overrides.tts).toEqual({ voiceId: "voice-123", speed: 0.9 });
    // No voice: leave the agent's default rather than send an empty override.
    expect(speakOverrides({ ...base, voiceId: null }).tts).toEqual({ speed: 0.9 });
  });
});

describe("language specifics", () => {
  it("never uses English with Ebba, whose languages are Portuguese and Swedish", () => {
    const text = tutorPrompt({
      learner: { targetLanguage: "pt", sourceLanguage: "sv", level: "B1" },
      topic: "Travel",
    });
    expect(text).toContain("Never use English, not even for a single word");
    // English appears only in that prohibition, never as a language to speak.
    expect(text.match(/English/g)).toHaveLength(2);
    expect(text).not.toContain("in English");
  });

  it("doesn't forbid English to Giovanni, who speaks it", () => {
    const text = tutorPrompt({
      learner: { targetLanguage: "sv", sourceLanguage: "en", level: "A2" },
      topic: "Travel",
    });
    expect(text).not.toContain("Never use English");
    expect(text).toContain("explain briefly in English");
  });

  it("greets in the target language", () => {
    expect(greeting("sv")).toBe("Hej! Ska vi prata en stund?");
    expect(greeting("pt")).toBe("Oi! Vamos conversar um pouquinho?");
    expect(greeting("xx")).toBe("");
  });

  it("speaks slower for beginners", () => {
    expect(speechSpeed("A1")).toBeLessThan(speechSpeed("B2"));
    expect(speechSpeed("C1")).toBe(1);
  });
});
