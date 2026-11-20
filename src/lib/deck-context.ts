import { prisma } from "./db";
import { deckPath, subtreeIds } from "./deck-tree";
import type { DeckContext } from "./ai/cards";

/** The deck's own cards shown to the model: enough to read its theme and format. */
export const DECK_CONTEXT_LIMIT = 300;

/**
 * What the model needs to know about a deck to add to it: its path, what it
 * was made for, and its most recent cards across the subtree (one per word).
 * Queries run one after another (see AGENTS.md).
 */
export async function loadDeckContext(
  profileId: string,
  deck: { id: string; description: string | null; sourcePrompt: string | null },
): Promise<DeckContext> {
  const path = await deckPath(deck.id);
  const ids = await subtreeIds(profileId, deck.id);
  const rows = await prisma.card.findMany({
    where: { deckId: { in: ids } },
    select: { target: true, source: true, tags: true },
    orderBy: { createdAt: "desc" },
    // Room for "Both" decks, which hold each word twice (one card per direction).
    take: DECK_CONTEXT_LIMIT * 2,
  });
  const seen = new Set<string>();
  return {
    path: path.map((d) => d.name),
    description: deck.description,
    sourcePrompt: deck.sourcePrompt,
    cards: rows
      .filter((c) => {
        const key = c.target.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, DECK_CONTEXT_LIMIT),
  };
}
