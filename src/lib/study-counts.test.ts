import { describe, expect, it } from "vitest";
import { cardKind, remainingByKind } from "./study-counts";

const c = (state: string) => ({ state });

describe("cardKind", () => {
  it("maps FSRS states to Anki's New / Learn / Due", () => {
    expect(cardKind(c("NEW"))).toBe("new");
    expect(cardKind(c("LEARNING"))).toBe("learn");
    expect(cardKind(c("RELEARNING"))).toBe("learn");
    expect(cardKind(c("REVIEW"))).toBe("due");
  });
});

describe("remainingByKind", () => {
  const queue = [c("REVIEW"), c("REVIEW"), c("LEARNING"), c("NEW"), c("NEW")];

  it("counts everything still to go, including the current card", () => {
    expect(remainingByKind(queue, 0)).toEqual({ new: 2, learn: 1, due: 2 });
    expect(remainingByKind(queue, 3)).toEqual({ new: 2, learn: 0, due: 0 });
  });

  it("a card answered Again rejoins as Learn at the end of the queue", () => {
    const afterAgain = [...queue, c("RELEARNING")];
    expect(remainingByKind(afterAgain, 1)).toEqual({ new: 2, learn: 2, due: 1 });
  });

  it("is all zeros past the end", () => {
    expect(remainingByKind(queue, 5)).toEqual({ new: 0, learn: 0, due: 0 });
  });
});
