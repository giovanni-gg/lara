// buildQueue's rules: uncapped reviews, per-deck new-card allowances that
// count what the deck already introduced today, and what it leaves out.
// `now` is fixed and passed everywhere, so the study-day boundary (04:00
// local) is deterministic.

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildQueue } from "@/lib/study";
import { subtreeIds } from "@/lib/deck-tree";
import { FsrsState } from "@/generated/prisma/enums";
import type { Card, Deck } from "@/generated/prisma/client";
import { createCard, createCards, createDeck, createProfile, createReview, createUser, dueReview, learning } from "../factories";

/** Local time on 2026-11-19, the fixed "today" (day offsets for other days). */
const at = (hour: number, minute = 0, dayOffset = 0) => new Date(2026, 10, 19 + dayOffset, hour, minute);
const NOW = at(12);

async function setup() {
  const user = await createUser();
  const profile = await createProfile(user);
  return { user, profile };
}

/** A card the deck introduced earlier: out of NEW, first answered at `firstReviewAt`. */
async function introducedAt(deck: Deck, firstReviewAt: Date, ...laterReviews: Date[]): Promise<Card> {
  // Not due before NOW + 1h, so it doesn't show up in the due part of the queue.
  const card = await createCard(deck, { ...learning(NOW, 60), lastReview: firstReviewAt });
  for (const reviewedAt of [firstReviewAt, ...laterReviews]) await createReview(card, { reviewedAt });
  return card;
}

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("buildQueue", () => {
  it("returns every due review, with no cap", async () => {
    const { user, profile } = await setup();
    const deck = await createDeck(profile);
    // createMany rather than 250 inserts: this test is about the count.
    await prisma.card.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        userId: user.id,
        deckId: deck.id,
        target: `ord ${i}`,
        source: `word ${i}`,
        ...dueReview(NOW, 1 + i / 1000),
      })),
    });

    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: NOW });

    expect(queue).toHaveLength(250);
    expect(queue.every((c) => c.state === FsrsState.REVIEW)).toBe(true);
  });

  it("caps new cards per deck at that deck's newCardsPerDay", async () => {
    const { user, profile } = await setup();
    const two = await createDeck(profile, { newCardsPerDay: 2 });
    const three = await createDeck(profile, { newCardsPerDay: 3 });
    const none = await createDeck(profile, { newCardsPerDay: 0 });
    const twoCards = await createCards(two, 5);
    const threeCards = await createCards(three, 5);
    await createCards(none, 5);

    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: NOW });

    expect(ids(queue).sort()).toEqual(ids([...twoCards.slice(0, 2), ...threeCards.slice(0, 3)]).sort());
  });

  it("counts cards first reviewed since 04:00 today against the deck's allowance", async () => {
    const { user, profile } = await setup();
    const deck = await createDeck(profile, { newCardsPerDay: 4 });
    const fresh = await createCards(deck, 6);

    await introducedAt(deck, at(9)); // first review today: uses up one
    await introducedAt(deck, at(10)); // and another
    await introducedAt(deck, at(20, 0, -1), at(9)); // first reviewed yesterday, again today: doesn't
    await introducedAt(deck, at(3, 30)); // 03:30 today belongs to yesterday's study day: doesn't

    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: NOW });

    expect(ids(queue)).toEqual(ids(fresh.slice(0, 2)));
  });

  it("doesn't carry an unstudied allowance over to the next day", async () => {
    const { user, profile } = await setup();
    const deck = await createDeck(profile, { newCardsPerDay: 2 });
    const fresh = await createCards(deck, 6);

    // Nothing studied today or tomorrow: tomorrow is still 2, not 4.
    const tomorrow = at(12, 0, 1);
    expect(ids(await buildQueue({ userId: user.id, profileId: profile.id, now: NOW }))).toEqual(ids(fresh.slice(0, 2)));
    expect(ids(await buildQueue({ userId: user.id, profileId: profile.id, now: tomorrow }))).toEqual(
      ids(fresh.slice(0, 2)),
    );

    // And cards introduced today don't reduce tomorrow's allowance.
    await introducedAt(deck, at(9));
    await introducedAt(deck, at(10));
    expect(ids(await buildQueue({ userId: user.id, profileId: profile.id, now: NOW }))).toEqual([]);
    // (By tomorrow those two are due again too; only the new part matters here.)
    const tomorrowQueue = await buildQueue({ userId: user.id, profileId: profile.id, now: tomorrow });
    expect(ids(tomorrowQueue.filter((c) => c.state === FsrsState.NEW))).toEqual(ids(fresh.slice(0, 2)));
  });

  it("restricts to a deck's subtree when given deckIds", async () => {
    const { user, profile } = await setup();
    const parent = await createDeck(profile);
    const child = await createDeck(profile, { parent });
    const other = await createDeck(profile);
    const inParent = await createCard(parent, dueReview(NOW));
    const inChild = await createCard(child);
    await createCard(other, dueReview(NOW));
    await createCard(other);

    const deckIds = await subtreeIds(profile.id, parent.id);
    const queue = await buildQueue({ userId: user.id, profileId: profile.id, deckIds, now: NOW });

    expect(ids(queue)).toEqual([inParent.id, inChild.id]);
  });

  it("leaves out archived decks and suspended cards", async () => {
    const { user, profile } = await setup();
    const archived = await createDeck(profile, { archivedAt: at(8) });
    await createCard(archived, dueReview(NOW));
    await createCard(archived);
    const deck = await createDeck(profile);
    await createCard(deck, { ...dueReview(NOW), suspended: true });
    await createCard(deck, { suspended: true });
    const kept = await createCard(deck);

    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: NOW });

    expect(ids(queue)).toEqual([kept.id]);
  });

  it("goes deck by deck in the tree's order, due before new within each, archived subdecks left out", async () => {
    const { user, profile } = await setup();
    const grammar = await createDeck(profile, { name: "Swedish grammar", sortOrder: 1 });
    // Created before Adjectives but sorted after it: the tree's order wins.
    const verbs = await createDeck(profile, { name: "Core top 80 verbs", parent: grammar, sortOrder: 2 });
    const adjectives = await createDeck(profile, { name: "Adjectives", parent: grammar, sortOrder: 1 });
    const archived = await createDeck(profile, { parent: grammar, sortOrder: 0, archivedAt: at(8) });
    await createCard(archived, dueReview(NOW, 9));
    await createCard(archived);
    const created = (s: number) => ({ createdAt: new Date(NOW.getTime() - 100_000 + s * 1000) });

    const verbNew = await createCard(verbs, created(1));
    const adjNew = await createCard(adjectives, created(2));
    const verbDue = await createCard(verbs, dueReview(NOW, 5)); // the most overdue card of all
    const adjDueLate = await createCard(adjectives, dueReview(NOW, 1));
    const adjDueEarly = await createCard(adjectives, dueReview(NOW, 3));
    const grammarDue = await createCard(grammar, dueReview(NOW, 1));

    const deckIds = await subtreeIds(profile.id, grammar.id);
    const queue = await buildQueue({ userId: user.id, profileId: profile.id, deckIds, now: NOW });

    expect(ids(queue)).toEqual(ids([grammarDue, adjDueEarly, adjDueLate, adjNew, verbDue, verbNew]));
    expect(queue.map((c) => c.deckId)).toEqual([
      grammar.id,
      adjectives.id,
      adjectives.id,
      adjectives.id,
      verbs.id,
      verbs.id,
    ]);
    expect(queue[1]).toMatchObject({ deckTitle: "Adjectives", deckName: "Swedish grammar · Adjectives" });
  });

  it("serves each deck's due cards most-overdue first, then its new cards oldest first", async () => {
    const { user, profile } = await setup();
    const a = await createDeck(profile);
    const b = await createDeck(profile);
    const created = (s: number) => ({ createdAt: new Date(NOW.getTime() - 100_000 + s * 1000) });
    // New cards, created in alternating decks.
    const n1 = await createCard(b, created(1));
    const n2 = await createCard(a, created(2));
    const n3 = await createCard(b, created(3));
    // Due cards, inserted out of order; a due learning card belongs with them.
    const d1 = await createCard(a, dueReview(NOW, 1));
    const d3 = await createCard(b, dueReview(NOW, 3));
    const dLearn = await createCard(a, learning(NOW, -5));
    const d2 = await createCard(a, dueReview(NOW, 2));
    await createCard(a, learning(NOW, 5)); // not due yet

    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: NOW });

    // Deck a (created first, so sorted first), then deck b.
    expect(ids(queue)).toEqual(ids([d2, d1, dLearn, n2, d3, n1, n3]));
    // Every card carries its answer-button labels.
    expect(queue.find((c) => c.id === n1.id)?.intervals[1]).toBe("10m");
  });
});
