import { describe, expect, it } from "vitest";
import { directionOptions, pickerDirection } from "./direction-picker";

describe("directionOptions", () => {
  it("offers target first, source first and picture first, and no Both", () => {
    const options = directionOptions("Swedish", "English");
    expect(options.map((o) => [o.value, o.label])).toEqual([
      ["RECOGNITION", "Swedish first"],
      ["PRODUCTION", "English first"],
      ["PICTURE", "Picture first"],
    ]);
  });

  it("names Ebba's languages the other way round", () => {
    const labels = directionOptions("Portuguese", "Swedish").map((o) => o.label);
    expect(labels).toEqual(["Portuguese first", "Swedish first", "Picture first"]);
  });
});

describe("pickerDirection", () => {
  it("starts an old BOTH deck on the first option, and keeps the rest", () => {
    expect(pickerDirection("BOTH")).toBe("RECOGNITION");
    expect(pickerDirection("PRODUCTION")).toBe("PRODUCTION");
    expect(pickerDirection("PICTURE")).toBe("PICTURE");
  });
});
