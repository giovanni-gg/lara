import { describe, expect, it } from "vitest";
import { CardType } from "@/generated/prisma/enums";
import { cardTypesFor, isCardDirection } from "./card-direction";

describe("cardTypesFor", () => {
  it("makes one card per direction, and both for BOTH", () => {
    expect(cardTypesFor("RECOGNITION")).toEqual([CardType.RECOGNITION]);
    expect(cardTypesFor("PRODUCTION")).toEqual([CardType.PRODUCTION]);
    expect(cardTypesFor("BOTH")).toEqual([CardType.RECOGNITION, CardType.PRODUCTION]);
  });
});

describe("isCardDirection", () => {
  it("accepts the three directions and nothing else", () => {
    for (const value of ["RECOGNITION", "PRODUCTION", "BOTH"]) expect(isCardDirection(value)).toBe(true);
    for (const value of ["PICTURE", "both", "", null, undefined, 1]) expect(isCardDirection(value)).toBe(false);
  });
});
