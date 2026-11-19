// The Anki importer end to end, on a tiny synthetic collection built with
// node:sqlite: just the tables and columns scripts/anki/import.ts reads.
// The field parsing itself is unit-tested in scripts/anki/parse.test.ts.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { CardType, FsrsState } from "@/generated/prisma/enums";
import { importAnkiCollection, type ImportArgs } from "../../scripts/anki/import";
import { makeDayClock } from "../../scripts/anki/parse";
import { createReview } from "../factories";

const DAY = 86_400_000;
const MINUTE = 60_000;
const CRT = 1763953200; // collection creation, unix seconds
const clock = makeDayClock(CRT, 4);

// A real preset blob (see parse.test.ts) with "new cards/day" changed from 5,
// the schema default, to 7, so the test can tell it was copied.
const PRESET = Buffer.from(
  "0A0400002041120400002041221C0000803F0000803F0000803F0000803F0000803F0000803F0000803F4807508F4E5D00002040656666A63F6D9A99993F7D0000803F8001949D02880101900101980104A80101B00108C0013C",
  "hex",
);

const DECKS = { default: 1, svenska: 1_700_000_000_001, mat: 1_700_000_000_002, flags: 1_700_000_000_003 };

// The review card's history: learn (Again, Good), one review, and a manual
// reschedule (ease 0), which isn't an answer and must not be imported.
const T1 = CRT * 1000 + 100 * DAY + 10 * 3_600_000;
const T2 = T1 + 10 * MINUTE;
const T3 = T1 + DAY + 3_600_000;
const REVLOG = [
  { id: T1, ease: 1, ivl: -600, time: 8000, type: 0 },
  { id: T2, ease: 3, ivl: 1, time: 4000, type: 0 },
  { id: T3, ease: 3, ivl: 12, time: 5000, type: 1 },
  { id: T3 + 5 * 3_600_000, ease: 0, ivl: 12, time: 0, type: 4 },
];
const REVIEW_DUE_DAY = clock.dayOf(new Date(T3)) + 12;
const FSRS = { s: 14.2, d: 5.5, lrt: Math.floor(T3 / 1000) };

type NoteSpec = { front: string; back: string; deck: number; tags?: string; card?: Record<string, number | string> };
const NOTES: Record<string, NoteSpec> = {
  picture: {
    front: '<img src="handled.png">',
    back: "Handled[sound:handled.mp3]<br>Wrist<br>Min handled är svullen.[sound:min.mp3]<br>My wrist is swollen.",
    deck: DECKS.mat,
  },
  flag: {
    front: '<img src="bouvet.png">',
    back: "EN: Bouvet Island<br>PT: Ilha Bouvet<br>SV: Bouvetön<br><br><i>fun fact</i>",
    deck: DECKS.flags,
  },
  review: {
    front: "Jag vill vara här[sound:a.mp3]",
    back: "I want to be here. (Verb: att vara — to be; used for states.)",
    deck: DECKS.svenska,
    tags: " verb anki ",
    card: { type: 2, queue: 2, due: REVIEW_DUE_DAY, ivl: 12, reps: 3, data: JSON.stringify(FSRS) },
  },
  production: { front: "to consider", back: "att anse[sound:anse.mp3]", deck: DECKS.mat },
  plain: { front: "it&#x27;s fine", back: "det &#228;r&nbsp;bra", deck: DECKS.svenska },
  suspended: { front: "katt[sound:katt.mp3]", back: "cat", deck: DECKS.svenska, card: { queue: -1 } },
};

/** Writes collection.anki2 and collection.media/ into `dir`; returns the collection path. */
function writeCollection(dir: string): string {
  const file = path.join(dir, "collection.anki2");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE col (crt INTEGER);
    CREATE TABLE config (key TEXT, val BLOB);
    CREATE TABLE decks (id INTEGER, name TEXT);
    CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, type INTEGER, queue INTEGER, due INTEGER,
      ivl INTEGER, reps INTEGER, lapses INTEGER, odue INTEGER, odid INTEGER, data TEXT);
    CREATE TABLE revlog (id INTEGER, cid INTEGER, ease INTEGER, ivl INTEGER, time INTEGER, type INTEGER);
    CREATE TABLE deck_config (config BLOB);
  `);
  db.prepare("INSERT INTO col VALUES (?)").run(CRT);
  db.prepare("INSERT INTO config VALUES ('rollover', ?)").run("4");
  db.prepare("INSERT INTO deck_config VALUES (?)").run(PRESET);
  const deck = db.prepare("INSERT INTO decks VALUES (?, ?)");
  deck.run(DECKS.default, "Default"); // holds no cards: left behind
  deck.run(DECKS.svenska, "Svenska");
  deck.run(DECKS.mat, "Svenska\x1fMat");
  deck.run(DECKS.flags, "Flaggor");

  const note = db.prepare("INSERT INTO notes VALUES (?, 1, ?, ?)");
  const card = db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)");
  Object.values(NOTES).forEach((spec, i) => {
    const noteId = 1_710_000_000_000 + i;
    const cardId = 1_720_000_000_000 + i;
    note.run(noteId, `${spec.front}\x1f${spec.back}`, spec.tags ?? "");
    const c = { type: 0, queue: 0, due: i + 1, ivl: 0, reps: 0, data: "", ...spec.card };
    card.run(cardId, noteId, spec.deck, c.type, c.queue, c.due, c.ivl, c.reps, c.data);
    if (spec === NOTES.review) {
      const log = db.prepare("INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?)");
      for (const r of REVLOG) log.run(r.id, cardId, r.ease, r.ivl, r.time, r.type);
    }
  });
  db.close();

  // One media file present; the sounds are referenced but missing.
  mkdirSync(path.join(dir, "collection.media"));
  writeFileSync(path.join(dir, "collection.media", "handled.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  return file;
}

let dir: string;
let mediaDir: string;
let collectionPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "lara-import-test-"));
  mediaDir = path.join(dir, "lara-media");
  collectionPath = writeCollection(dir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const run = (flags: Partial<ImportArgs> = {}) =>
  importAnkiCollection(
    { collectionPath, targetLanguage: "sv", sourceLanguage: "en", dryRun: false, replace: false, force: false, ...flags },
    { mediaDir },
  );

describe("importAnkiCollection", () => {
  it("imports the deck tree, cards, scheduling state, history and media", async () => {
    await run();

    // Decks: the tree, with parent links; the empty "Default" left behind.
    const decks = await prisma.deck.findMany();
    const byName = new Map(decks.map((d) => [d.name, d]));
    expect([...byName.keys()].sort()).toEqual(["Flaggor", "Mat", "Svenska"]);
    expect(byName.get("Svenska")).toMatchObject({ parentId: null, ankiId: BigInt(DECKS.svenska), direction: "RECOGNITION" });
    expect(byName.get("Mat")).toMatchObject({ parentId: byName.get("Svenska")!.id, ankiId: BigInt(DECKS.mat) });
    expect(byName.get("Flaggor")?.parentId).toBeNull();
    // The preset's "new cards/day" on every deck.
    expect(decks.every((d) => d.newCardsPerDay === 7)).toBe(true);

    // Cards: one per shape, in the right deck, with the right type.
    const cards = await prisma.card.findMany({ include: { deck: true } });
    const card = (target: string) => {
      const found = cards.find((c) => c.target === target);
      expect(found, target).toBeDefined();
      return found!;
    };
    expect(cards).toHaveLength(6);
    expect(card("Handled")).toMatchObject({ cardType: CardType.PICTURE, source: "Wrist", deckId: byName.get("Mat")!.id });
    expect(card("Bouvetön")).toMatchObject({ cardType: CardType.PICTURE, source: "Bouvet Island", deckId: byName.get("Flaggor")!.id });
    expect(card("Jag vill vara här")).toMatchObject({
      cardType: CardType.RECOGNITION,
      source: "I want to be here.",
      notes: "Verb: att vara — to be; used for states.",
      tags: ["verb", "anki"],
    });
    expect(card("att anse")).toMatchObject({ cardType: CardType.PRODUCTION, source: "to consider" });
    expect(card("it's fine")).toMatchObject({ cardType: CardType.RECOGNITION, source: "det är bra" });

    // Suspended stays suspended; nothing else is.
    expect(cards.filter((c) => c.suspended).map((c) => c.target)).toEqual(["katt"]);

    // The review card: FSRS memory straight from Anki, due on its Anki day.
    expect(card("Jag vill vara här")).toMatchObject({
      state: FsrsState.REVIEW,
      stability: FSRS.s,
      difficulty: FSRS.d,
      lastReview: new Date(FSRS.lrt * 1000),
      due: clock.startOf(REVIEW_DUE_DAY),
      scheduledDays: 12,
      reps: 3,
    });
    expect(card("att anse")).toMatchObject({ state: FsrsState.NEW, stability: 0, lastReview: null });

    // History: the three real answers, keyed by their revlog ids.
    const reviews = await prisma.review.findMany({ orderBy: { reviewedAt: "asc" } });
    expect(reviews.map((r) => r.ankiId)).toEqual([BigInt(T1), BigInt(T2), BigInt(T3)]);
    expect(reviews.map((r) => r.rating)).toEqual([1, 3, 3]);
    expect(reviews.map((r) => r.reviewedAt)).toEqual([new Date(T1), new Date(T2), new Date(T3)]);
    expect(reviews.every((r) => r.cardId === card("Jag vill vara här").id)).toBe(true);

    // Media: the picture copied under a content-hash name into the media dir;
    // missing sounds leave the URL empty rather than dangling.
    const picture = card("Handled");
    expect(picture.imageUrl).toMatch(/^\/api\/media\/anki-[0-9a-f]{24}\.png$/);
    expect(readdirSync(mediaDir)).toEqual([path.basename(picture.imageUrl!)]);
    expect(picture.audioUrl).toBeNull();
  });

  it("writes nothing on a dry run", async () => {
    await run({ dryRun: true });

    expect(await prisma.deck.count()).toBe(0);
    expect(await prisma.card.count()).toBe(0);
    expect(() => readdirSync(mediaDir)).toThrow();
  });

  it("requires --replace over existing cards, and --force to drop reviews done in Lara", async () => {
    await run();
    await expect(run()).rejects.toThrow(/already has 6 cards.*--replace/);

    const card = await prisma.card.findFirstOrThrow({ where: { target: "att anse" } });
    const laraReview = await createReview(card, { reviewedAt: new Date() });

    await expect(run({ replace: true })).rejects.toThrow(/Refusing to replace: 1 reviews were done in Lara/);
    // Refused before deleting anything.
    expect(await prisma.card.count()).toBe(6);
    expect(await prisma.review.findUnique({ where: { id: laraReview.id } })).not.toBeNull();

    await run({ replace: true, force: true });

    expect(await prisma.deck.count()).toBe(3);
    expect(await prisma.card.count()).toBe(6);
    expect(await prisma.review.count({ where: { ankiId: null } })).toBe(0);
    expect(await prisma.review.count()).toBe(3);
  });
});
