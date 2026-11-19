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
