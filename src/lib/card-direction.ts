import { CardDirection, CardType } from "@/generated/prisma/enums";

/** The card(s) to create for one word, given a deck's direction setting. */
export function cardTypesFor(direction: CardDirection): CardType[] {
  switch (direction) {
    // No longer offered, but old decks still carry it.
    case "BOTH":
      return [CardType.RECOGNITION, CardType.PRODUCTION];
    case "PRODUCTION":
      return [CardType.PRODUCTION];
    case "PICTURE":
      return [CardType.PICTURE];
    default:
      return [CardType.RECOGNITION];
  }
}

export function isCardDirection(value: unknown): value is CardDirection {
  return typeof value === "string" && Object.hasOwn(CardDirection, value);
}

/**
 * The direction new cards in a deck should default to: whichever card type the
 * deck already holds most of (a deck of mostly picture cards → "Picture first").
 * An empty deck, or a tie that includes the deck's own setting, keeps the setting.
 */
export function usualDirection(
  counts: { cardType: CardType; count: number }[],
  fallback: CardDirection,
): CardDirection {
  const top = Math.max(0, ...counts.map((c) => c.count));
  if (top === 0) return fallback;
  const leaders = counts.filter((c) => c.count === top).map((c) => c.cardType as CardDirection);
  return leaders.includes(fallback) ? fallback : leaders[0];
}
