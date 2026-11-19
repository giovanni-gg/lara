import { CardType, type CardDirection } from "@/generated/prisma/enums";

/** The card(s) to create for one word, given a deck's direction setting. */
export function cardTypesFor(direction: CardDirection): CardType[] {
  if (direction === "BOTH") return [CardType.RECOGNITION, CardType.PRODUCTION];
  return [direction === "PRODUCTION" ? CardType.PRODUCTION : CardType.RECOGNITION];
}

export function isCardDirection(value: unknown): value is CardDirection {
  return value === "RECOGNITION" || value === "PRODUCTION" || value === "BOTH";
}
