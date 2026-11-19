import { getLanguage, nextLevelUp } from "../languages";
import type { VocabularyWord } from "../story-vocabulary";
import type { CefrLevel } from "@/generated/prisma/enums";

/**
 * Speak: a spoken conversation with an ElevenLabs voice agent. The agent
 * itself is generic (scripts/elevenlabs/setup-agent.ts); everything about the
 * learner arrives as per-session overrides built here. Pure and client-safe:
 * no database, no fetch, so the wording is unit-tested for both learners.
 *
 * Two languages, two roles, never swapped:
 *   TARGET: what they're learning, the language of the conversation.
 *   SOURCE: what they speak, for explanations, corrections' "why", and help.
 */

/** The client tool the agent calls to put a correction card on screen. */
export const SHOW_CORRECTION_TOOL = "show_correction";

/**
 * The languages enabled on the agent (setup-agent.ts), so the ones it can
 * listen and speak in. Both of a learner's languages must be here.
 */
export const SPEAK_LANGUAGES = ["en", "sv", "pt"] as const;

export function speakSupports(learner: Pick<SpeakLearner, "targetLanguage" | "sourceLanguage">): boolean {
  const enabled: readonly string[] = SPEAK_LANGUAGES;
  return enabled.includes(learner.targetLanguage) && enabled.includes(learner.sourceLanguage);
}

export type Correction = {
  /** What the learner said, as transcribed. */
  said: string;
  /** A natural way to say it in the target language. */
  better: string;
  /** One short line on why, in the source language. */
  explanation: string;
};

export type SpeakLearner = {
  targetLanguage: string;
  sourceLanguage: string;
  level: CefrLevel;
};

export type SpeakDeck = { label: string; words: VocabularyWord[] };

export type SpeakPromptInput = {
  learner: SpeakLearner;
  /** What to talk about: a chip, free text, or the deck's name. */
  topic: string;
  /** A deck whose words to weave in. */
  deck?: SpeakDeck;
  /** Set when resuming after a pause: what was said before it. */
  history?: SpeakTurn[];
};

export type SpeakTurn = { role: "user" | "agent"; text: string };

/** How much of a paused conversation is carried into the resumed call. */
export const MAX_HISTORY_TURNS = 30;
export const MAX_HISTORY_CHARS = 6000;

/** The most recent turns that fit the budget, oldest first. */
export function recentHistory(history: SpeakTurn[]): SpeakTurn[] {
  const kept: SpeakTurn[] = [];
  let chars = 0;
  for (const turn of history.slice(-MAX_HISTORY_TURNS).reverse()) {
    chars += turn.text.length;
    if (chars > MAX_HISTORY_CHARS) break;
    kept.unshift(turn);
  }
  return kept;
}

/** Short enough to keep in a voice prompt; a conversation can't use more. */
export const MAX_DECK_WORDS = 20;

export function tutorPrompt({ learner, topic, deck, history }: SpeakPromptInput): string {
  const resuming = Boolean(history && history.length > 0);
  const target = getLanguage(learner.targetLanguage).name;
  const source = getLanguage(learner.sourceLanguage).name;
  const level = learner.level;
  const next = nextLevelUp(level);
  const pitch =
    next === level
      ? `Speak ${target} at CEFR ${level}, as you would with a fluent adult.`
      : `Speak ${target} at CEFR ${level}: words and grammar they can follow, now and then stretching toward ${next}.`;
  const beginner = level === "A1" || level === "A2";

  const lines: (string | null)[] = [
    `You are Lara, a warm, curious ${target} conversation partner on a voice call with someone learning ${target}. Their native language is ${source}.`,
    pitch,
    "",
    "# The conversation",
    `- Topic: ${topic.trim()}. You lead it: ask one open question at a time, react to what they say with real interest, and move on to a new angle when an answer runs dry. Follow them if they want to talk about something else.`,
    `- Speak ${target} by default.`,
    "- Keep every turn short and spoken: one to three sentences, then hand the turn back, usually with a question. Never lecture.",
    "- This is speech, not text: no lists, no markdown, no emoji, no parentheses. Write numbers as words.",
    resuming
      ? `- This call resumes a conversation they paused. You opened with a short "let's continue" line; don't greet them again or restart the topic. Carry on from where it stopped.`
      : `- You opened with a short greeting. When they answer it, bring in the topic with a simple question.`,
    beginner
      ? `- Use short sentences, everyday words and the present tense mostly. Speak slowly and clearly; if they struggle, simplify rather than repeat word for word.`
      : `- Use natural, idiomatic ${target}, with the expressions a native speaker would really use.`,
    "",
    `# When they switch to ${source} or don't understand`,
    `- They may answer in ${source}, mix ${source} words into their ${target}, or say they don't understand, in either language. That is expected and fine, never a mistake.`,
    `- If they ask what something means or seem lost: explain briefly in ${source}, one or two sentences, saying the ${target} phrase and what it means. Then go straight back to ${target} with a simpler version of what you said.`,
    `- If they use a ${source} word because they don't know the ${target} one, give them the ${target} word in passing and carry on in ${target}.`,
    `- If they speak a whole turn in ${source} without asking for help, answer the gist in one short ${source} sentence, then invite them back into ${target}.`,
    `- Explanations are always in ${source}. Use no language other than ${target} and ${source}.`,
    learner.sourceLanguage !== "en" && learner.targetLanguage !== "en"
      ? `- Never use English, not even for a single word: their native language is ${source}, and English is neither what they speak nor what they are learning.`
      : null,
    `- Your voice speaks one language at a time. Use the language_detection tool to change it: to "${learner.sourceLanguage}" before a turn that is mostly ${source}, and back to "${learner.targetLanguage}" as soon as you return to ${target}. Don't switch for a single word or a short phrase.`,
    `- Their speech is transcribed by a ${target} speech recogniser, so ${source} or mixed speech can come through garbled. If a turn makes no sense, assume they switched language or struggled, and ask simply what they meant.`,
    "",
    "# Corrections",
    `- When they make a meaningful mistake in ${target} (a wrong word, a wrong verb form or ending, word order that breaks the sentence, or a phrase no native speaker would say), call ${SHOW_CORRECTION_TOOL} with:`,
    `  said: their words as you heard them; better: the natural ${target} way to say it; explanation: one short sentence in ${source} saying why.`,
    `- Then, in the same turn, recast it gently in one short spoken line, the way a friend would ("Ah, you mean…"), and carry on with the conversation. The tool only shows a card on their screen; don't wait for it, and don't mention it.`,
    "- Don't nitpick. Let small slips that don't hurt understanding go, and keep the conversation flowing: at most one correction per turn, and not every turn.",
    beginner
      ? `- At ${level}, only correct what blocks meaning or a very common pattern they will need again.`
      : null,
    `- Never correct spelling, punctuation or capitalisation: you only see a speech transcript. Never correct what they said in ${source}.`,
  ];

  if (deck && deck.words.length > 0) {
    const words = deck.words.slice(0, MAX_DECK_WORDS);
    lines.push(
      "",
      "# Words they are studying",
      `They are studying a deck called "${deck.label}". Weave these words into the conversation naturally, a few at a time, and ask questions that give them a reason to use them. Don't list them or quiz them.`,
      ...words.map((w) => (w.source ? `- ${w.target} (${w.source})` : `- ${w.target}`)),
    );
  }

  if (resuming) {
    lines.push(
      "",
      "# The conversation so far (before the pause)",
      ...recentHistory(history!).map((t) => `${t.role === "user" ? "Learner" : "You"}: ${t.text}`),
    );
  }

  return lines.filter((line) => line !== null).join("\n");
}

/**
 * The agent's opening line, spoken before the model is involved (so the call
 * starts talking at once). A greeting that hands the turn over; the prompt
 * then brings in the topic. A language without one starts silent: the agent
 * waits for the learner to speak first.
 */
const GREETINGS: Record<string, string> = {
  sv: "Hej! Ska vi prata en stund?",
  pt: "Oi! Vamos conversar um pouquinho?",
  es: "¡Hola! ¿Charlamos un rato?",
  de: "Hallo! Wollen wir ein bisschen plaudern?",
  fr: "Salut ! On discute un peu ?",
  it: "Ciao! Facciamo due chiacchiere?",
  nl: "Hoi! Zullen we even kletsen?",
  da: "Hej! Skal vi snakke lidt?",
  no: "Hei! Skal vi prate litt?",
  pl: "Cześć! Pogadamy chwilę?",
  en: "Hi! Shall we chat for a bit?",
};

export function greeting(targetLanguage: string): string {
  return GREETINGS[targetLanguage] ?? "";
}

/** The opening line after a pause: pick up, don't start over. */
const RESUME_LINES: Record<string, string> = {
  sv: "Då fortsätter vi! Var var vi?",
  pt: "Vamos continuar! Onde estávamos?",
  es: "¡Seguimos! ¿Dónde estábamos?",
  de: "Weiter geht's! Wo waren wir?",
  fr: "On reprend ! Où en étions-nous ?",
  it: "Riprendiamo! Dove eravamo?",
  nl: "We gaan verder! Waar waren we?",
  da: "Vi fortsætter! Hvor var vi?",
  no: "Vi fortsetter! Hvor var vi?",
  pl: "Kontynuujmy! Na czym skończyliśmy?",
  en: "Let's pick up where we left off.",
};

export function resumeLine(targetLanguage: string): string {
  return RESUME_LINES[targetLanguage] ?? "";
}

/** Slower for beginners, natural speed once they can take it. */
export function speechSpeed(level: CefrLevel): number {
  // Only a touch slower for beginners: slowed speech sounds mechanical.
  if (level === "A1" || level === "A2") return 0.95;
  return 1;
}

/**
 * The per-session overrides, in the shape `startSession({ overrides })` takes.
 * The agent must allow each one (setup-agent.ts does).
 */
export type SpeakOverrides = {
  agent: { prompt: { prompt: string }; firstMessage: string; language: string };
  tts: { voiceId?: string; speed: number };
};

export function speakOverrides(
  input: SpeakPromptInput & { voiceId: string | null },
): SpeakOverrides {
  return {
    agent: {
      prompt: { prompt: tutorPrompt(input) },
      firstMessage:
        input.history && input.history.length > 0
          ? resumeLine(input.learner.targetLanguage)
          : greeting(input.learner.targetLanguage),
      language: input.learner.targetLanguage,
    },
    tts: {
      ...(input.voiceId ? { voiceId: input.voiceId } : {}),
      speed: speechSpeed(input.learner.level),
    },
  };
}
