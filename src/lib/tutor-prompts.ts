/**
 * Suggested opening questions for the card tutor.
 *
 * Kept apart from `ai/tutor.ts` deliberately: that module imports the AI SDK,
 * and the chat sheet is a client component. This file stays dependency-free so
 * both sides can use it without pulling the SDK into the browser bundle.
 */

export type SuggestionInput = {
  target: string;
  notes?: string | null;
  targetSentence?: string | null;
};

export function suggestedQuestions({
  target,
  notes,
  targetSentence,
}: SuggestionInput): string[] {
  const words = target.trim().split(/\s+/).filter(Boolean).length;
  const suggestions: string[] = [];

  if (words === 1) {
    // A single word is usually a lemma — conjugation/declension is the question.
    suggestions.push("Show me the full conjugation");
    suggestions.push("How is this word built?");
  } else {
    suggestions.push("Why this word order?");
    suggestions.push("Break this phrase down");
  }

  suggestions.push("Give me two more examples");

  if (notes) suggestions.push("Explain the note on this card");
  else if (targetSentence) suggestions.push("Why this form in the example?");
  else suggestions.push("What would a native say instead?");

  return suggestions.slice(0, 4);
}
