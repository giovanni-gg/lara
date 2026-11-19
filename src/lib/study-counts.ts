// What's left in a study session, split the way Anki shows it: New, Learn,
// Due. Pure and client-safe — the session header renders it live as cards are
// answered and failed cards rejoin the queue.

export type CardKind = "new" | "learn" | "due";

type HasState = { state: string };

/** NEW → new; LEARNING/RELEARNING (incl. a card just answered Again) → learn; REVIEW → due. */
export function cardKind(card: HasState): CardKind {
  if (card.state === "NEW") return "new";
  if (card.state === "LEARNING" || card.state === "RELEARNING") return "learn";
  return "due";
}

/** Cards still to go, counting the current one (as Anki does), by kind. */
export function remainingByKind(queue: readonly HasState[], index: number): Record<CardKind, number> {
  const counts: Record<CardKind, number> = { new: 0, learn: 0, due: 0 };
  for (const card of queue.slice(Math.max(0, index))) counts[cardKind(card)] += 1;
  return counts;
}

export const KIND_LABELS: Record<CardKind, string> = {
  new: "New card",
  learn: "Learning",
  due: "Review",
};
