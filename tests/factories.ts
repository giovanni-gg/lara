// Row factories for tests that write to a database (tests/integration).
//
// They go through the app's own client (`prisma` from src/lib/db.ts), so
// DATABASE_URL must already point at the test database before this module is
// first imported. In the integration suite tests/integration/setup.ts sees to
// that; elsewhere, set it and then `await import("../factories")`.
//
// Every factory takes the parent row (not an id) plus any column overrides,
// and fills the rest with valid, distinct defaults:
//
//   const user = await createUser();                     // the session's user
//   const profile = await createProfile(user, { dailyNewLimit: 5 });
//   const deck = await createDeck(profile, { name: "Verbs" });
//   const sub = await createDeck(profile, { parent: deck });
//   await createCard(deck);                              // a NEW card
//   await createCard(deck, { ...dueReview(now), target: "springa" });
//   await createCards(deck, 30);                         // 30 NEW cards
//   await createReview(card, { reviewedAt: now });       // a review log row
//
// or the whole standard fixture at once: `const world = await createWorld()`.

import { prisma } from "@/lib/db";
import type { Card, Deck, LanguageProfile, Prisma, User } from "@/generated/prisma/client";
import { FsrsState } from "@/generated/prisma/enums";
import { PICTURE_FILE, TEST_USER_EMAIL, WORLD, type WorldCardKey, type WorldDeckKey } from "./world";

const DAY_MS = 24 * 60 * 60 * 1000;
let seq = 0;
const nextSeq = () => ++seq;

/**
 * A user. With no email it is THE user src/lib/session.ts resolves to
 * (LARA_USER_EMAIL), so code under test that calls getCurrentUser() sees it.
 * Pass an email for anyone else.
 */
export function createUser(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}): Promise<User> {
  return prisma.user.create({
    data: {
      email: process.env.LARA_USER_EMAIL || TEST_USER_EMAIL,
      name: "Test User",
      ...overrides,
    },
  });
}

/** A language profile, active by default (the app studies the active one). */
export function createProfile(
  user: Pick<User, "id">,
  overrides: Partial<Omit<Prisma.LanguageProfileUncheckedCreateInput, "userId">> = {},
): Promise<LanguageProfile> {
  return prisma.languageProfile.create({
    data: {
      userId: user.id,
      targetLanguage: WORLD.profile.targetLanguage,
      sourceLanguage: WORLD.profile.sourceLanguage,
      level: WORLD.profile.level,
      isActive: true,
      ...overrides,
    },
  });
}

export type DeckOverrides = Partial<Omit<Prisma.DeckUncheckedCreateInput, "userId" | "profileId" | "parentId">> & {
  /** Nest under this deck (Anki's "Parent::Child"). */
  parent?: Pick<Deck, "id">;
};

/** A deck in a profile, optionally inside another deck. */
export function createDeck(
  profile: Pick<LanguageProfile, "id" | "userId">,
  { parent, ...overrides }: DeckOverrides = {},
): Promise<Deck> {
  const n = nextSeq();
  return prisma.deck.create({
    data: {
      userId: profile.userId,
      profileId: profile.id,
      parentId: parent?.id ?? null,
      name: `Deck ${n}`,
      sortOrder: n,
      ...overrides,
    },
  });
}

export type CardOverrides = Partial<Omit<Prisma.CardUncheckedCreateInput, "userId" | "deckId">>;

/** A card in a deck: NEW, due now, RECOGNITION, unless overridden. */
export function createCard(deck: Pick<Deck, "id" | "userId">, overrides: CardOverrides = {}): Promise<Card> {
  const n = nextSeq();
  return prisma.card.create({
    data: {
      userId: deck.userId,
      deckId: deck.id,
      target: `ord ${n}`,
      source: `word ${n}`,
      ...overrides,
    },
  });
}

/**
 * `count` cards in one deck, created one after another so their `createdAt`
 * order (which the new-card queue follows) is their index order.
 * `overrides` may be a function of the index.
 */
export async function createCards(
  deck: Pick<Deck, "id" | "userId">,
  count: number,
  overrides: CardOverrides | ((i: number) => CardOverrides) = {},
): Promise<Card[]> {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const extra = typeof overrides === "function" ? overrides(i) : overrides;
    cards.push(
      await createCard(deck, { createdAt: new Date(Date.now() - (count - i) * 1000), ...extra }),
    );
  }
  return cards;
}

/**
 * One answer in a card's immutable review log. Writes the log row only; the
 * card's own scheduling columns are whatever you created it with (use
 * submitReview from src/lib/study.ts to exercise the real answer path).
 */
export function createReview(
  card: Pick<Card, "id" | "userId" | "state" | "due" | "stability" | "difficulty">,
  overrides: Partial<Omit<Prisma.ReviewUncheckedCreateInput, "cardId" | "userId">> = {},
) {
  return prisma.review.create({
    data: {
      cardId: card.id,
      userId: card.userId,
      rating: 3,
      state: card.state,
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: 0,
      lastElapsedDays: 0,
      scheduledDays: 0,
      ...overrides,
    },
  });
}

// ---- scheduling states (spread into createCard's overrides) ------------------

/** A REVIEW card that fell due `overdueDays` ago: it counts as "Due" and leads the queue. */
export function dueReview(now = new Date(), overdueDays = 1): CardOverrides {
  const due = new Date(now.getTime() - overdueDays * DAY_MS);
  return {
    state: FsrsState.REVIEW,
    due,
    stability: 6,
    difficulty: 5,
    scheduledDays: 5,
    elapsedDays: 5,
    reps: 4,
    lapses: 0,
    lastReview: new Date(due.getTime() - 5 * DAY_MS),
  };
}

/** A REVIEW card due `inDays` from now: reviewed, but not in today's queue. */
export function futureReview(now = new Date(), inDays = 3): CardOverrides {
  const due = new Date(now.getTime() + inDays * DAY_MS);
  return {
    state: FsrsState.REVIEW,
    due,
    stability: 10,
    difficulty: 5,
    scheduledDays: inDays + 2,
    elapsedDays: 2,
    reps: 3,
    lapses: 0,
    lastReview: new Date(now.getTime() - 2 * DAY_MS),
  };
}

/** A LEARNING card on its 10-minute step, due `inMinutes` from now (negative = already due). */
export function learning(now = new Date(), inMinutes = -1): CardOverrides {
  return {
    state: FsrsState.LEARNING,
    due: new Date(now.getTime() + inMinutes * 60_000),
    stability: 0.5,
    difficulty: 6,
    reps: 1,
    learningSteps: 0,
    lastReview: new Date(now.getTime() - 10 * 60_000),
  };
}

// ---- the standard world ------------------------------------------------------

export type World = {
  user: User;
  profile: LanguageProfile;
  decks: Record<WorldDeckKey, Deck>;
  cards: Record<WorldCardKey, Card>;
};

/**
 * The fixture described in tests/world.ts: the session's user, an active
 * Swedish profile, the deck tree Svenska › Mat › Frukt plus Verb, and one card
 * of each kind (RECOGNITION, PRODUCTION, PICTURE, a suspended one, a due
 * review). Profile overrides (level, ...) pass through.
 */
export async function createWorld({
  now = new Date(),
  profile: profileOverrides = {},
}: {
  now?: Date;
  profile?: Parameters<typeof createProfile>[1];
} = {}): Promise<World> {
  const user = await createUser();
  const profile = await createProfile(user, profileOverrides);

  const root = await createDeck(profile, { name: WORLD.decks.root, sortOrder: 0 });
  const food = await createDeck(profile, { name: WORLD.decks.food, parent: root, sortOrder: 0 });
  const fruit = await createDeck(profile, { name: WORLD.decks.fruit, parent: food, sortOrder: 0 });
  const verbs = await createDeck(profile, { name: WORLD.decks.verbs, sortOrder: 1 });
  const decks: World["decks"] = { root, food, fruit, verbs };

  const extra: Record<WorldCardKey, CardOverrides> = {
    recognition: {},
    production: {},
    picture: { imageUrl: `/api/media/${PICTURE_FILE}` },
    suspended: { suspended: true },
    dueReview: dueReview(now),
  };
  const cards = {} as World["cards"];
  let i = 0;
  for (const key of Object.keys(WORLD.cards) as WorldCardKey[]) {
    const { target, source, deck, cardType } = WORLD.cards[key];
    cards[key] = await createCard(decks[deck], {
      target,
      source,
      cardType,
      // Distinct, ordered timestamps: the new-card queue follows createdAt.
      createdAt: new Date(now.getTime() - (10 - i++) * 1000),
      ...extra[key],
    });
  }

  return { user, profile, decks, cards };
}
