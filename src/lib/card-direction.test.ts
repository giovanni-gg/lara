import { describe, expect, it } from "vitest";
import { CardType } from "@/generated/prisma/enums";
import { cardTypesFor, isCardDirection } from "./card-direction";

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
