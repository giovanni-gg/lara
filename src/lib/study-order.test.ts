import { describe, expect, it, vi } from "vitest";
import { deckBoundary, deckOrder, groupByDeck, requeueInBlock } from "./study-order";

// deck-tree.ts also loads from the database; only its pure tree building is
// used here, to check deckOrder agrees with what the Decks screen shows.
vi.mock("@/lib/db", () => ({ prisma: {} }));
const { buildDeckTree, flattenWithPaths } = await import("./deck-tree");

/** A queued card: id, plus the deck it belongs to. */
const c = (id: string, deckId = id[0]) => ({ id, deckId });
const ids = (cards: { id: string }[]) => cards.map((card) => card.id);

describe("deckOrder", () => {
  // Rows as the tree query sorts them, children listed before their parents
  // on purpose: the order comes from the tree, not the row order alone.
  const rows = [
    { id: "Mat", parentId: "Svenska" },
    { id: "Svenska", parentId: null },
    { id: "Frukt", parentId: "Mat" },
    { id: "Verb", parentId: "Svenska" },
    { id: "Flags", parentId: null },
  ];

  it("walks the tree depth-first: a parent's own deck, then its subdecks", () => {
    expect(deckOrder(rows)).toEqual(["Svenska", "Mat", "Frukt", "Verb", "Flags"]);
  });

  it("matches the Decks tree's order", () => {
    const tree = buildDeckTree(
      rows.map((row) => ({ ...row, name: row.id, emoji: null, archivedAt: null, newCardsPerDay: 5 })),
      new Map(),
    );
    expect(deckOrder(rows)).toEqual(flattenWithPaths(tree).map((deck) => deck.id));
  });

  it("treats a deck whose parent isn't listed as a root", () => {
    expect(deckOrder([{ id: "Mat", parentId: "gone" }, { id: "Frukt", parentId: "Mat" }])).toEqual(["Mat", "Frukt"]);
  });
});

describe("groupByDeck", () => {
  it("serves deck by deck in tree order, due before new within each", () => {
    // Due cards arrive most-overdue first across decks, new cards oldest first.
    const due = [c("b1"), c("a1"), c("b2"), c("a2")];
    const fresh = [c("a3"), c("b3"), c("a4")];
    expect(ids(groupByDeck(due, fresh, ["a", "b"]))).toEqual(["a1", "a2", "a3", "a4", "b1", "b2", "b3"]);
    expect(ids(groupByDeck(due, fresh, ["b", "a"]))).toEqual(["b1", "b2", "b3", "a1", "a2", "a3", "a4"]);
  });

  it("skips decks with nothing to study and keeps cards of an unknown deck, last", () => {
    expect(ids(groupByDeck([c("x1"), c("a1")], [c("b1")], ["a", "empty", "b"]))).toEqual(["a1", "b1", "x1"]);
  });
});

describe("requeueInBlock", () => {
  const queue = [c("a1"), c("a2"), c("a3"), c("b1"), c("b2")];

  it("puts a relearn at the end of its own deck's block, not the session's", () => {
    expect(ids(requeueInBlock(queue, 1, c("a1")))).toEqual(["a1", "a2", "a3", "a1", "b1", "b2"]);
    expect(ids(requeueInBlock(queue, 4, c("b1")))).toEqual(["a1", "a2", "a3", "b1", "b2", "b1"]);
  });

  it("after earlier relearns of the same deck", () => {
    const once = requeueInBlock(queue, 1, c("a1"));
    expect(ids(requeueInBlock(once, 2, c("a2")))).toEqual(["a1", "a2", "a3", "a1", "a2", "b1", "b2"]);
  });

  it("shows it straight away when its deck has nothing else left", () => {
    // The learner is past a3, on the next deck's first card (between decks).
    expect(ids(requeueInBlock(queue, 3, c("a3")))).toEqual(["a1", "a2", "a3", "a3", "b1", "b2"]);
    // Or at the very end of the session.
    expect(ids(requeueInBlock(queue, 5, c("b2")))).toEqual(["a1", "a2", "a3", "b1", "b2", "b2"]);
  });

  it("never inserts behind the card on screen", () => {
    expect(ids(requeueInBlock(queue, 4, c("a1")))).toEqual(["a1", "a2", "a3", "b1", "a1", "b2"]);
  });
});

describe("deckBoundary", () => {
  const queue = [c("a1"), c("a2"), c("a1"), c("b1"), c("b2"), c("b3"), c("c1")];

  it("is only at the first card of a new deck's block", () => {
    expect(deckBoundary(queue, 0)).toBeNull();
    expect(deckBoundary(queue, 2)).toBeNull();
    expect(deckBoundary(queue, 3)).not.toBeNull();
    expect(deckBoundary(queue, 4)).toBeNull();
    expect(deckBoundary(queue, 6)).not.toBeNull();
    expect(deckBoundary(queue, 7)).toBeNull(); // past the end
  });

  it("counts distinct cards in the finished block and the next one", () => {
    expect(deckBoundary(queue, 3)).toEqual({
      finished: queue[2],
      finishedCount: 2, // a1 was relearned: one card, two showings
      next: queue[3],
      nextCount: 3,
    });
    expect(deckBoundary(queue, 6)).toMatchObject({ finishedCount: 3, nextCount: 1 });
  });

  it("never fires in a single-deck session", () => {
    const one = [c("a1"), c("a2"), c("a1")];
    expect([0, 1, 2, 3].map((i) => deckBoundary(one, i))).toEqual([null, null, null, null]);
  });
});
