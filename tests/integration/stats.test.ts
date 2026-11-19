// The counts the deck list and Today screen show, and that they agree with
// what a session actually serves.

import { describe, expect, it } from "vitest";
import { buildQueue, profileStats, sessionSize, statsByDeck } from "@/lib/study";
import { loadDeckTree } from "@/lib/deck-tree";
import { FsrsState } from "@/generated/prisma/enums";
import { createCard, createCards, createDeck, createProfile, createReview, createUser, dueReview, futureReview, learning } from "../factories";

const at = (hour: number, minute = 0, dayOffset = 0) => new Date(2026, 10, 19 + dayOffset, hour, minute);
const NOW = at(12);

async function setup() {
  const user = await createUser();
  const profile = await createProfile(user);
  return { user, profile };
}

describe("statsByDeck", () => {
  it("reports newToday exactly as buildQueue serves it", async () => {
    const { user, profile } = await setup();
    // Cap 4, one already introduced today → 3 left.
    const capped = await createDeck(profile, { name: "Capped", newCardsPerDay: 4 });
    await createCards(capped, 6);
    const introduced = await createCard(capped, learning(NOW, 60));
    await createReview(introduced, { reviewedAt: at(9) });
    // Fewer new cards than the cap → all of them.
    const small = await createDeck(profile, { name: "Small", newCardsPerDay: 10 });
    await createCards(small, 2);
    await createCard(small, dueReview(NOW));

    const stats = await statsByDeck(profile.id, NOW);
    const queue = await buildQueue({ userId: user.id, profileId: profile.id, now: NOW });
    const servedNew = (deckName: string) =>
      queue.filter((c) => c.deckName === deckName && c.state === FsrsState.NEW).length;

    expect(stats.get(capped.id)?.newToday).toBe(3);
    expect(servedNew("Capped")).toBe(3);
    expect(stats.get(small.id)?.newToday).toBe(2);
    expect(servedNew("Small")).toBe(2);
    // And the session size the UI promises is what the queue holds.
    const total = [...stats.values()].reduce(
      (sum, s) => ({ due: sum.due + s.due, newToday: sum.newToday + s.newToday }),
      { due: 0, newToday: 0 },
    );
    expect(sessionSize(total)).toBe(queue.length);
  });

  it("counts only due learning cards as learning, and every due non-new card as due", async () => {
    const { profile } = await setup();
    const deck = await createDeck(profile);
    await createCard(deck, learning(NOW, -1)); // learning, due
    await createCard(deck, { ...learning(NOW, -1), state: FsrsState.RELEARNING }); // relearning, due
    await createCard(deck, learning(NOW, 5)); // learning, not yet
    await createCard(deck, dueReview(NOW)); // review, due
    await createCard(deck, futureReview(NOW)); // review, not yet
    await createCard(deck); // new
    await createCard(deck, { ...dueReview(NOW), suspended: true }); // never counted

    expect((await statsByDeck(profile.id, NOW)).get(deck.id)).toEqual({
      total: 6,
      due: 3,
      fresh: 1,
      newToday: 1,
      learning: 2,
    });
  });
});

describe("profileStats", () => {
  it("leaves out archived decks and counts today's reviews", async () => {
    const { profile } = await setup();
    const deck = await createDeck(profile, { newCardsPerDay: 2 });
    const due = await createCard(deck, dueReview(NOW));
    await createCards(deck, 3);
    const archived = await createDeck(profile, { archivedAt: at(8) });
    await createCard(archived, dueReview(NOW));
    await createCards(archived, 3);
    await createReview(due, { reviewedAt: at(9) }); // today
    await createReview(due, { reviewedAt: at(3, 30) }); // yesterday's study day

    expect(await profileStats(profile.id, NOW)).toEqual({ total: 4, due: 1, newToday: 2, reviewedToday: 1 });
  });
});

describe("loadDeckTree", () => {
  it("splits the study tree from archived subtrees, keeping archived children under their archived parent", async () => {
    const { profile } = await setup();
    const archivedAt = at(8);
    const root = await createDeck(profile, { name: "Svenska" });
    const child = await createDeck(profile, { name: "Mat", parent: root });
    // Archived on its own, under a live parent: an archived root of its own.
    const lone = await createDeck(profile, { name: "Gammalt", parent: root, archivedAt });
    // A whole archived subtree.
    const old = await createDeck(profile, { name: "Arkiv", archivedAt });
    const oldChild = await createDeck(profile, { name: "Arkiv-barn", parent: old, archivedAt });
    await createCards(oldChild, 2);
    await createCards(child, 3);

    const { roots, archivedRoots, byId } = await loadDeckTree(profile.id);

    expect(roots.map((r) => r.id)).toEqual([root.id]);
    expect(roots[0].children.map((c) => c.id)).toEqual([child.id]);
    expect(roots[0].total.total).toBe(3);
    expect(archivedRoots.map((r) => r.id).sort()).toEqual([lone.id, old.id].sort());
    const arkiv = archivedRoots.find((r) => r.id === old.id)!;
    expect(arkiv.children.map((c) => c.id)).toEqual([oldChild.id]);
    expect(arkiv.total.total).toBe(2);
    // Every deck stays reachable by id, archived or not.
    expect([...byId.keys()].sort()).toEqual([root.id, child.id, lone.id, old.id, oldChild.id].sort());
  });
});
