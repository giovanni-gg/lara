import { streamText, type ModelMessage } from "ai";
import { assertAiCredentials, getModel } from "./model";
import { logUsage, MAX_RETRIES } from "./call";
import { getLanguage } from "../languages";
import type { CefrLevel } from "@/generated/prisma/enums";

/**
 * The per-card tutor. Scoped deliberately tightly: it answers questions about
 * one card, in the middle of a review session, where the learner has seconds of
 * patience and a phone screen. Long essays are the failure mode here, not
 * shallowness.
 */

export type CardContext = {
  target: string;
  source: string;
  targetSentence: string | null;
  sourceSentence: string | null;
  notes: string | null;
  targetLanguage: string;
  sourceLanguage: string;
  level: CefrLevel;
};

export type TutorTurn = { role: "user" | "assistant"; content: string };

export function instructionsFor(card: CardContext): string {
  const target = getLanguage(card.targetLanguage).name;
  const source = getLanguage(card.sourceLanguage).name;

  return [
    `You are a ${target} tutor helping a ${source} speaker at CEFR ${card.level}.`,
    `They are mid-review on one flashcard and asked you about it. Answer only about this card and what it opens onto.`,
    "",
    "The card:",
    `- ${target}: ${card.target}`,
    `- ${source}: ${card.source}`,
    card.targetSentence ? `- Example: ${card.targetSentence}` : "",
    card.sourceSentence ? `- Example translated: ${card.sourceSentence}` : "",
    card.notes ? `- Existing note: ${card.notes}` : "",
    "",
    "How to answer:",
    "- Be short. Two or three sentences is usually right. They are standing up, holding a phone, in the middle of a session.",
    "- Lead with the answer. No preamble, no restating the question.",
    `- For a verb, give the conjugation table they asked for as a compact table — do not narrate it in prose.`,
    "- When a rule has an exception that will actually bite them, say so in one clause. Skip exceptions they will not meet at their level.",
    "- Give real example sentences, not glossary entries. Two is plenty.",
    `- Write explanations in ${source}. Keep ${target} for the examples themselves.`,
    "- If they are wrong about something, say so directly and correct it.",
    "- Use markdown sparingly: a table for conjugations or declensions, bold for the form being contrasted. No headings.",
    "- If the question is not about this card or this language, say so in one line and stop.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function streamTutorReply({
  card,
  history,
  question,
}: {
  card: CardContext;
  history: TutorTurn[];
  question: string;
}) {
  assertAiCredentials();

  // Keep the tail of the conversation only — a card's thread can run long over
  // months, and the recent turns are what the follow-up refers to.
  const messages: ModelMessage[] = [
    ...history.slice(-10).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user" as const, content: question },
  ];

  const started = Date.now();
  return streamText({
    model: getModel(),
    maxRetries: MAX_RETRIES,
    instructions: instructionsFor(card),
    messages,
    onEnd: (event) =>
      logUsage(
        "tutor",
        { usage: event.totalUsage, finishReason: event.finishReason, response: event.response },
        Date.now() - started,
      ),
  });
}
