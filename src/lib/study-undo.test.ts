import { describe, expect, it } from "vitest";
import { requeueInBlock } from "./study-order";
import { pushCapped, removeCard, restoreAnswered, restoreRemoved, UNDO_LIMIT } from "./study-undo";

type Item = { id: string; deckId: string };
const item = (id: string, deckId = "a"): Item => ({ id, deckId });
const ids = (queue: readonly Item[]) => queue.map((q) => q.id);

describe("pushCapped", () => {
  it("appends, keeping only the newest UNDO_LIMIT entries", () => {
    let history: number[] = [];
    for (let i = 1; i <= UNDO_LIMIT + 3; i++) history = pushCapped(history, i);
    expect(history).toHaveLength(UNDO_LIMIT);
    expect(history[0]).toBe(4);
    expect(history.at(-1)).toBe(UNDO_LIMIT + 3);
  });

  it("doesn't touch the history it was given", () => {
    const history = [1, 2];
    expect(pushCapped(history, 3, 2)).toEqual([2, 3]);
    expect(history).toEqual([1, 2]);
  });
});

describe("restoreAnswered", () => {
  it("takes out the relearn copy an Again re-queued, leaving the card where it was answered", () => {
    const [x, y, z] = [item("x"), item("y"), item("z")];
    // x answered Again at 0 while y was on screen: its copy rejoins after z.
    const relearn = { ...x };
    const queue = requeueInBlock([x, y, z], 1, relearn);
    expect(ids(queue)).toEqual(["x", "y", "z", "x"]);

    const restored = restoreAnswered(queue, 0, x, relearn);
    expect(restored).toEqual([x, y, z]);
    expect(restored[0]).toBe(x);
  });

  it("matches the copy by object, never the original with the same id", () => {
    const x = item("x");
    const first = { ...x };
    const second = { ...x };
    // x, then its first relearn (answered Again again), then the second copy.
    const queue = [x, first, item("y"), second];
    expect(restoreAnswered(queue, 1, first, second)).toEqual([x, first, item("y")]);
    expect(restoreAnswered(queue, 1, first, second)[1]).toBe(first);
  });

  it("is a plain copy without a relearn", () => {
    const queue = [item("x"), item("y")];
    const restored = restoreAnswered(queue, 0, queue[0], null);
    expect(restored).toEqual(queue);
    expect(restored).not.toBe(queue);
  });

  it("puts the card back at its index if it's missing", () => {
    const x = item("x");
    expect(ids(restoreAnswered([item("w"), item("y")], 1, x, null))).toEqual(["w", "x", "y"]);
  });
});

describe("removeCard / restoreRemoved", () => {
  it("removes the card on screen and its later relearn copies, not answered history", () => {
    const x = item("x");
    const queue = [x, item("y"), { ...x }, item("z"), { ...x }];
    // On screen: the first relearn copy, at 2.
    const { queue: rest, removed } = removeCard(queue, 2, "x");
    expect(ids(rest)).toEqual(["x", "y", "z"]);
    expect(rest[0]).toBe(x);
    expect(removed.map((r) => r.at)).toEqual([2, 4]);
  });

  it("round-trips exactly", () => {
    const queue = [item("w"), item("x"), item("y"), item("x", "a"), item("z", "b")];
    const { queue: rest, removed } = removeCard(queue, 1, "x");
    const restored = restoreRemoved(rest, removed);
    expect(restored).toEqual(queue);
    removed.forEach(({ item: removedItem, at }) => expect(restored[at]).toBe(removedItem));
  });

  it("restores the card on screen at its index even after a relearn joined the end", () => {
    const queue = [item("w"), item("x"), item("y")];
    const { queue: rest, removed } = removeCard(queue, 1, "x");
    const grown = [...rest, item("w2")];
    const restored = restoreRemoved(grown, removed);
    expect(ids(restored)).toEqual(["w", "x", "y", "w2"]);
  });

  it("removes nothing when the card isn't ahead", () => {
    const queue = [item("x"), item("y")];
    expect(removeCard(queue, 1, "x")).toEqual({ queue, removed: [] });
  });
});
