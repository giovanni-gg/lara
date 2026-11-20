import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { subtreeIds } from "@/lib/deck-tree";
import { loadDeckContext } from "@/lib/deck-context";
import { hasAiCredentials } from "@/lib/ai/model";
import { suggestForDeck, suggestionsAreStale } from "@/lib/ai/deck-suggestions";
import { learnerContext } from "@/lib/learner-context";

export const maxDuration = 60;

/**
 * The deck page's "Add cards" chips, fetched after the page renders so a
 * model call never holds it up. Cached on the deck and rewritten only when
 * its card count has drifted (`suggestionsAreStale`). Without AI, or when the
 * model fails, it answers with whatever is cached — possibly nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  const user = await getCurrentUser();

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: {
      id: true,
      profileId: true,
      description: true,
      sourcePrompt: true,
      suggestions: true,
      suggestionsCardCount: true,
      profile: {
        select: { targetLanguage: true, sourceLanguage: true, level: true, about: true, aboutSummary: true },
      },
    },
  });
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const ids = await subtreeIds(deck.profileId, deck.id);
  const cardCount = await prisma.card.count({ where: { deckId: { in: ids } } });
  if (!suggestionsAreStale(deck.suggestionsCardCount, cardCount) || !hasAiCredentials()) {
    return NextResponse.json({ suggestions: deck.suggestions });
  }

  try {
    const { targetLanguage, sourceLanguage, level } = deck.profile;
    const suggestions = await suggestForDeck({
      targetLanguage,
      sourceLanguage,
      level,
      deck: await loadDeckContext(deck.profileId, deck),
      // Chips written before the learner filled in "About you" stay until the
      // deck's card count moves: not worth a model call per profile edit.
      learner: learnerContext(deck.profile),
    });
    if (suggestions.length === 0) return NextResponse.json({ suggestions: deck.suggestions });
    // updateMany: the deck may have been deleted while the model was writing.
    await prisma.deck.updateMany({
      where: { id: deck.id },
      data: { suggestions, suggestionsCardCount: cardCount },
    });
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.warn("[decks/suggestions] could not write suggestions:", error);
    return NextResponse.json({ suggestions: deck.suggestions });
  }
}
