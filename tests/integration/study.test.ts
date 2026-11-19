// Smoke test for the integration harness: real Postgres, real Prisma, the real
// queue builder. It only proves that cards come back; the daily-limit rules
// (Deck.newCardsPerDay, "introduced today") belong to the study suite.

import { describe, expect, it } from "vitest";
import { buildQueue } from "@/lib/study";
import { subtreeIds } from "@/lib/deck-tree";
import { createCards, createDeck, createProfile, createUser, createWorld, dueReview, futureReview } from "../factories";
import { WORLD } from "../world";

describe("buildQueue", () => {
  it("returns every due review, then the new cards, and nothing that isn't due", async () => {
    const now = new Date();
    const user = await createUser();
    const profile = await createProfile(user);
    // Explicit, and above the number of new cards, so no cap is in play.
    const deck = await createDeck(profile, { name: "Smoke", newCardsPerDay: 10 });
    const due = await createCards(deck, 2, (i) => dueReview(now, 2 - i)); // most overdue first
    await createCards(deck, 2, futureReview(now));
    await createCards(deck, 1, { suspended: true });
    const fresh = await createCards(deck, 3);

    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now });

    expect(queue.map((c) => c.id)).toEqual([...due, ...fresh].map((c) => c.id));
    expect(queue[0]).toMatchObject({ deckName: "Smoke", state: "REVIEW" });
  });

  it("serves the standard world, and only a deck's subtree when asked", async () => {
    const now = new Date();
    const { user, profile, decks, cards } = await createWorld({ now });

    const all = await buildQueue({ userId: user.id, profileId: profile.id, now });
    expect(all.map((c) => c.target)).toEqual(
      expect.arrayContaining([WORLD.cards.dueReview.target, WORLD.cards.recognition.target]),
    );
    expect(all.map((c) => c.id)).not.toContain(cards.suspended.id);

    const deckIds = await subtreeIds(profile.id, decks.food.id);
    const food = await buildQueue({ userId: user.id, profileId: profile.id, deckIds, now });
    expect(food.map((c) => c.target).sort()).toEqual(
      [WORLD.cards.production.target, WORLD.cards.picture.target].sort(),
    );
    // A subdeck is labelled with its parent: "Mat · Frukt".
    expect(food.find((c) => c.id === cards.picture.id)?.deckName).toBe(`${WORLD.decks.food} · ${WORLD.decks.fruit}`);
  });
});
