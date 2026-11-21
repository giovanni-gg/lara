import { describe, expect, it } from "vitest";
import { CardType } from "@/generated/prisma/enums";
import { cardTypesFor, isCardDirection, usualDirection } from "./card-direction";

describe("cardTypesFor", () => {
  it("makes one card per direction", () => {
    expect(cardTypesFor("RECOGNITION")).toEqual([CardType.RECOGNITION]);
    expect(cardTypesFor("PRODUCTION")).toEqual([CardType.PRODUCTION]);
    expect(cardTypesFor("PICTURE")).toEqual([CardType.PICTURE]);
  });

  it("still makes both cards for an old BOTH deck", () => {
    expect(cardTypesFor("BOTH")).toEqual([CardType.RECOGNITION, CardType.PRODUCTION]);
  });
});

describe("isCardDirection", () => {
  it("accepts the four directions and nothing else", () => {
    for (const value of ["RECOGNITION", "PRODUCTION", "BOTH", "PICTURE"]) expect(isCardDirection(value)).toBe(true);
    for (const value of ["CLOZE", "picture", "toString", "", null, undefined, 1]) expect(isCardDirection(value)).toBe(false);
  });
});

describe("usualDirection", () => {
  it("picks the card type the deck holds most of", () => {
    expect(
      usualDirection(
        [
          { cardType: "RECOGNITION", count: 3 },
          { cardType: "PICTURE", count: 40 },
        ],
        "RECOGNITION",
      ),
    ).toBe("PICTURE");
  });

  it("keeps the deck's setting when the deck is empty or it ties for first", () => {
    expect(usualDirection([], "PRODUCTION")).toBe("PRODUCTION");
    expect(
      usualDirection(
        [
          { cardType: "RECOGNITION", count: 5 },
          { cardType: "PRODUCTION", count: 5 },
        ],
        "PRODUCTION",
      ),
    ).toBe("PRODUCTION");
  });
});
