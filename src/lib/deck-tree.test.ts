import { describe, expect, it, vi } from "vitest";
import type { DeckStats } from "./study";

// deck-tree.ts also loads from the database; buildDeckTree and
// flattenWithPaths are pure. db.ts would throw on import without DATABASE_URL.
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { buildDeckTree, flattenWithPaths } = await import("./deck-tree");

const row = (id: string, parentId: string | null = null) => ({
  id,
  name: id,
  emoji: null,
  parentId,
  archivedAt: null,
  newCardsPerDay: 5,
});

const stats = (total: number, due: number, fresh: number, newToday: number, learning: number): DeckStats => ({
  total,
  due,
  fresh,
  newToday,
  learning,
});

describe("buildDeckTree", () => {
  // Svenska › Mat › Frukt, Svenska › Verb, and a separate root Flags.
  const rows = [row("Svenska"), row("Mat", "Svenska"), row("Frukt", "Mat"), row("Verb", "Svenska"), row("Flags")];
  const perDeck = new Map<string, DeckStats>([
    ["Svenska", stats(1, 1, 0, 0, 0)],
    ["Mat", stats(10, 2, 5, 3, 1)],
    ["Frukt", stats(20, 4, 10, 5, 2)],
    ["Verb", stats(100, 8, 50, 5, 4)],
    // Flags has no stats row: an empty deck.
  ]);

  it("nests decks under their parents, keeping row order", () => {
    const roots = buildDeckTree(rows, perDeck);

    expect(roots.map((r) => r.id)).toEqual(["Svenska", "Flags"]);
    expect(roots[0].children.map((c) => c.id)).toEqual(["Mat", "Verb"]);
    expect(roots[0].children[0].children.map((c) => c.id)).toEqual(["Frukt"]);
  });

  it("rolls every count up the tree, leaving each deck's own counts alone", () => {
    const [svenska, flags] = buildDeckTree(rows, perDeck);
    const mat = svenska.children[0];

    expect(mat.own).toEqual(stats(10, 2, 5, 3, 1));
    expect(mat.total).toEqual(stats(30, 6, 15, 8, 3));
    expect(svenska.own).toEqual(stats(1, 1, 0, 0, 0));
    expect(svenska.total).toEqual(stats(131, 15, 65, 13, 7));
    expect(flags.total).toEqual(stats(0, 0, 0, 0, 0));
    // Summing must not write through to the shared stats objects.
    expect(perDeck.get("Mat")).toEqual(stats(10, 2, 5, 3, 1));
  });

  it("treats a deck whose parent isn't in the rows as a root", () => {
    const roots = buildDeckTree([row("Mat", "missing"), row("Frukt", "Mat")], perDeck);
    expect(roots.map((r) => r.id)).toEqual(["Mat"]);
    expect(roots[0].total.total).toBe(30);
  });
});

describe("flattenWithPaths", () => {
  it("lists every deck depth-first with its full path label and depth", () => {
    const roots = buildDeckTree(
      [row("Svenska"), row("Mat", "Svenska"), row("Frukt", "Mat"), row("Verb")],
      new Map(),
    );

    expect(flattenWithPaths(roots)).toEqual([
      { id: "Svenska", label: "Svenska", depth: 0 },
      { id: "Mat", label: "Svenska · Mat", depth: 1 },
      { id: "Frukt", label: "Svenska · Mat · Frukt", depth: 2 },
      { id: "Verb", label: "Verb", depth: 0 },
    ]);
  });
});
