// The names and values the test fixtures are built from. PURE: no Prisma, no
// database. Tests import from here, so a test can say `WORLD.decks.food` instead of repeating
// "Mat" and drifting from the seed.
//
// tests/factories.ts → createWorld() builds exactly this.

/** Who src/lib/session.ts resolves as in the integration suite (LARA_USER_EMAIL). */
export const TEST_USER_EMAIL = "test@lara.local";

/** A deck tree two levels deep plus a sibling root, Anki "Svenska::Mat::Frukt" style. */
export const WORLD = {
  profile: { targetLanguage: "sv", sourceLanguage: "en", level: "A2" },
  decks: {
    root: "Svenska",
    /** Child of `root`. */
    food: "Mat",
    /** Child of `food`. */
    fruit: "Frukt",
    /** A second root deck. */
    verbs: "Verb",
  },
  /** One card per kind the app treats differently. `deck` is a key of `decks`. */
  cards: {
    /** NEW, target → meaning. */
    recognition: { target: "hej", source: "hello", deck: "root", cardType: "RECOGNITION" },
    /** NEW, meaning → target. */
    production: { target: "äpple", source: "apple", deck: "food", cardType: "PRODUCTION" },
    /** NEW, picture → target, with a tiny image served from /api/media. */
    picture: { target: "banan", source: "banana", deck: "fruit", cardType: "PICTURE" },
    /** NEW but suspended: never in a queue or a count. */
    suspended: { target: "katt", source: "cat", deck: "root", cardType: "RECOGNITION" },
    /** REVIEW, due yesterday: the one card in the "Due" count. */
    dueReview: { target: "springa", source: "to run", deck: "verbs", cardType: "RECOGNITION" },
  },
} as const;

export type WorldDeckKey = keyof typeof WORLD.decks;
export type WorldCardKey = keyof typeof WORLD.cards;

/** The PICTURE card's image: a filename under the media dir, served at /api/media/<file>. */
export const PICTURE_FILE = "test-banana.png";

