// A study session runs deck by deck, in the order the Decks tree shows them,
// and pauses between decks so the learner knows the subject is changing.
// Pure and client-safe: buildQueue groups the queue with it on the server,
// and the session uses it live as failed cards rejoin the queue.

/** What the ordering needs from a queued card. */
export type DeckItem = { id: string; deckId: string };

/**
 * Deck ids depth-first, a parent before its children, siblings in the order
 * given — the order `loadDeckTree` / `flattenWithPaths` show. Pass rows sorted
 * as the tree query sorts them. A deck whose parent isn't among the rows
 * counts as a root, as in `buildDeckTree`.
 */
export function deckOrder(rows: readonly { id: string; parentId: string | null }[]): string[] {
  const known = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const row of rows) {
    if (row.parentId && known.has(row.parentId)) {
      childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id]);
    } else {
      roots.push(row.id);
    }
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    (childrenOf.get(id) ?? []).forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/**
 * One block per deck, in `order`: that deck's due cards (in the order given,
 * i.e. most overdue first), then its new cards (in the order given). Cards of
 * a deck missing from `order` go last rather than being dropped.
 */
export function groupByDeck<T extends DeckItem>(
  due: readonly T[],
  fresh: readonly T[],
  order: readonly string[],
): T[] {
  const blocks = new Map<string, T[]>(order.map((id) => [id, []]));
  for (const card of [...due, ...fresh]) {
    const block = blocks.get(card.deckId);
    if (block) block.push(card);
    else blocks.set(card.deckId, [card]);
  }
  return [...blocks.values()].flat();
}

/**
 * The queue with `card` (answered, still learning) shown again at the end of
 * its own deck's block — so a deck is only finished once its relearns are —
 * but never before `index`, the card on screen. If its block has no cards
 * left, that's straight away.
 */
export function requeueInBlock<T extends DeckItem>(queue: readonly T[], index: number, card: T): T[] {
  let last = -1;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].deckId === card.deckId) {
      last = i;
      break;
    }
  }
  const at = last === -1 ? queue.length : Math.min(queue.length, Math.max(last + 1, index));
  return [...queue.slice(0, at), card, ...queue.slice(at)];
}

/** Distinct cards in the run of `deckId` cards starting at `from`, walking by `step`. */
function runSize(queue: readonly DeckItem[], from: number, step: 1 | -1): number {
  const deckId = queue[from]?.deckId;
  const ids = new Set<string>();
  for (let i = from; i >= 0 && i < queue.length && queue[i].deckId === deckId; i += step) {
    ids.add(queue[i].id);
  }
  return ids.size;
}

export type DeckBoundary<T> = {
  /** The last card of the deck just finished. */
  finished: T;
  /** Distinct cards studied in it (a relearned card counts once). */
  finishedCount: number;
  /** The first card of the next deck. */
  next: T;
  /** Distinct cards in the next deck's block. */
  nextCount: number;
};

/**
 * Whether `index` is the first card of a new deck's block, with the counts to
 * show between them. Null on the first card, past the end, and anywhere in a
 * single-deck session.
 */
export function deckBoundary<T extends DeckItem>(
  queue: readonly T[],
  index: number,
): DeckBoundary<T> | null {
  const finished = queue[index - 1];
  const next = queue[index];
  if (index < 1 || !finished || !next || finished.deckId === next.deckId) return null;
  return {
    finished,
    finishedCount: runSize(queue, index - 1, -1),
    next,
    nextCount: runSize(queue, index, 1),
  };
}
