// Undo in a study session: stepping back over the last few answers (and
// pauses), Anki-style. Pure and client-safe — the session keeps the history
// and applies these to its queue; the server side is `undoReview` in study.ts.
//
// Every change a session makes to its queue lands at or after the card on
// screen (answers move past it, relearns rejoin after it, a pause removes it
// and its copies), so stepping back in reverse order always finds the queue
// before an entry's index exactly as it was.

/** How many steps back undo can go, as in Anki's undo history. */
export const UNDO_LIMIT = 10;

/** `history` with `entry` appended, keeping only the newest `limit`. */
export function pushCapped<T>(history: readonly T[], entry: T, limit = UNDO_LIMIT): T[] {
  return [...history, entry].slice(-limit);
}

/**
 * The queue with an answer taken back: `relearn` (the copy that answer
 * re-queued, if any; matched by object, as copies share the card's id) taken
 * out, and `card` at `index` again — where it was answered, so it is the card
 * on screen. Normally it is still there; it's put back only if not.
 */
export function restoreAnswered<T>(
  queue: readonly T[],
  index: number,
  card: T,
  relearn: T | null,
): T[] {
  const without = relearn ? queue.filter((item) => item !== relearn) : [...queue];
  if (without[index] === card) return without;
  return [...without.slice(0, index), card, ...without.slice(index)];
}

/** A queued card taken out by a pause, and where it was. */
export type Removed<T> = { item: T; at: number };

/**
 * The queue without card `id` from `from` on — the card on screen and any
 * relearn copies still to come — plus what was removed, for `restoreRemoved`.
 * Earlier positions are history (answered already) and stay.
 */
export function removeCard<T extends { id: string }>(
  queue: readonly T[],
  from: number,
  id: string,
): { queue: T[]; removed: Removed<T>[] } {
  const removed: Removed<T>[] = [];
  const kept: T[] = [];
  queue.forEach((item, at) => {
    if (at >= from && item.id === id) removed.push({ item, at });
    else kept.push(item);
  });
  return { queue: kept, removed };
}

/** Undoes `removeCard`: each card back at its old position, in order. */
export function restoreRemoved<T>(queue: readonly T[], removed: readonly Removed<T>[]): T[] {
  const out = [...queue];
  for (const { item, at } of [...removed].sort((a, b) => a.at - b.at)) {
    out.splice(Math.min(at, out.length), 0, item);
  }
  return out;
}
