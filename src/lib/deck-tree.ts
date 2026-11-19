import { prisma } from "./db";
import { EMPTY_DECK_STATS, statsByDeck, type DeckStats } from "./study";

/**
 * Decks nest like Anki's "Parent::Child". A deck can hold its own cards and
 * subdecks; its counts — and a study session started from it — cover
 * everything beneath it.
 *
 * Built from one deck query plus one `statsByDeck` pass, then aggregated in
 * memory. Never per-node queries: see AGENTS.md on per-deck stats loops.
 */

export type DeckNode = {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
  /** This deck's own cards only. */
  own: DeckStats;
  /** This deck plus all subdecks. */
  total: DeckStats;
  children: DeckNode[];
};

type DeckRow = {
  id: string;
  name: string;
  emoji: string | null;
  parentId: string | null;
};

export function buildDeckTree(
  rows: DeckRow[],
  stats: Map<string, DeckStats>,
): DeckNode[] {
  const nodes = new Map<string, DeckNode>(
    rows.map((row) => {
      const own = stats.get(row.id) ?? EMPTY_DECK_STATS;
      return [row.id, { ...row, own, total: { ...own }, children: [] }];
    }),
  );

  const roots: DeckNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sum = (node: DeckNode): DeckStats => {
    for (const child of node.children) {
      const t = sum(child);
      node.total.total += t.total;
      node.total.due += t.due;
      node.total.fresh += t.fresh;
      node.total.learning += t.learning;
    }
    return node.total;
  };
  roots.forEach(sum);
  return roots;
}

/** The whole tree for a profile, rows in the order the user arranged them. */
export async function loadDeckTree(profileId: string): Promise<{
  roots: DeckNode[];
  byId: Map<string, DeckNode>;
}> {
  const rows = await prisma.deck.findMany({
    where: { profileId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, emoji: true, parentId: true },
  });
  const stats = await statsByDeck(profileId);
  const roots = buildDeckTree(rows, stats);

  const byId = new Map<string, DeckNode>();
  const index = (node: DeckNode) => {
    byId.set(node.id, node);
    node.children.forEach(index);
  };
  roots.forEach(index);
  return { roots, byId };
}

/** A deck and every deck beneath it. */
export async function subtreeIds(profileId: string, deckId: string): Promise<string[]> {
  const rows = await prisma.deck.findMany({
    where: { profileId },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id]);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    (childrenOf.get(id) ?? []).forEach(walk);
  };
  if (rows.some((row) => row.id === deckId)) walk(deckId);
  return out;
}

/** Root-first ancestry of a deck, for breadcrumbs and "Nouns · Abstract" labels. */
export async function deckPath(
  deckId: string,
): Promise<{ id: string; name: string }[]> {
  const path: { id: string; name: string }[] = [];
  let cursor: string | null = deckId;
  // Bounded walk: a cycle can't exist through the UI, but never loop forever.
  for (let depth = 0; cursor && depth < 20; depth += 1) {
    const deck: { id: string; name: string; parentId: string | null } | null =
      await prisma.deck.findUnique({
        where: { id: cursor },
        select: { id: true, name: true, parentId: true },
      });
    if (!deck) break;
    path.unshift({ id: deck.id, name: deck.name });
    cursor = deck.parentId;
  }
  return path;
}

/** Every deck with its full path label, for "put this in…" pickers. */
export function flattenWithPaths(
  roots: DeckNode[],
): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (node: DeckNode, trail: string[]) => {
    const label = [...trail, node.name].join(" · ");
    out.push({ id: node.id, label, depth: trail.length });
    node.children.forEach((child) => walk(child, [...trail, node.name]));
  };
  roots.forEach((root) => walk(root, []));
  return out;
}
