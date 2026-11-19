import "dotenv/config";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { CardDirection, CardType, FsrsState } from "../src/generated/prisma/enums";
import { replayHistory, type RatingValue } from "../src/lib/srs";

/**
 * Brings an Anki profile into Lara: decks, cards, media, scheduling state, and
 * the full review history.
 *
 * Usage:
 *   npm run import:anki-collection -- "<…/Anki2/User 1/collection.anki2>" sv [--dry-run] [--replace] [--force]
 *
 *   --dry-run  Parse and report; write nothing.
 *   --replace  Delete every deck in the target language profile first. Required
 *              when the profile already has cards.
 *   --force    Allow --replace to delete reviews done in Lara (not imported).
 *              Without it the importer refuses, so re-importing a newer Anki
 *              collection can never silently discard Lara-native progress.
 *
 * Anki is never written to: the collection is copied to a temp dir and opened
 * read-only, so this is safe while Anki is running.
 *
 * Content mapping (Anki "Basic" notes, Front/Back):
 *   picture on the front   -> PICTURE      (back: word, translation, sentence, sentence translation)
 *   audio on the front     -> RECOGNITION  (front is the target language)
 *   audio on the back      -> PRODUCTION   (back is the target language)
 *   no audio               -> RECOGNITION
 */

const DAY_MS = 86_400_000;

type Args = {
  collectionPath: string;
  targetLanguage: string;
  sourceLanguage: string;
  dryRun: boolean;
  replace: boolean;
  force: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [collectionPath, targetLanguage, sourceLanguage = "en"] = argv.filter(
    (a) => !a.startsWith("--"),
  );
  if (!collectionPath || !targetLanguage) {
    console.error(
      'Usage: npm run import:anki-collection -- "<path/to/collection.anki2>" <target-language> [source-language] [--dry-run] [--replace] [--force]',
    );
    process.exit(1);
  }
  return {
    collectionPath,
    targetLanguage,
    sourceLanguage,
    dryRun: flags.has("--dry-run"),
    replace: flags.has("--replace"),
    force: flags.has("--force"),
  };
}

// ---------------------------------------------------------------------------
// Reading the Anki collection
// ---------------------------------------------------------------------------

type AnkiCard = {
  id: number;
  nid: number;
  did: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  reps: number;
  lapses: number;
  odue: number;
  odid: number;
  data: string;
};

type AnkiRevlog = {
  id: number;
  cid: number;
  ease: number;
  ivl: number;
  time: number;
  type: number;
};

type AnkiNote = { id: number; mid: number; flds: string; tags: string };

function openCollection(collectionPath: string) {
  // Copy first: Anki may hold the file open, and reading a live SQLite file
  // that another process is writing can see a torn state.
  const dir = mkdtempSync(path.join(os.tmpdir(), "lara-anki-"));
  const copy = path.join(dir, "collection.anki2");
  copyFileSync(collectionPath, copy);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(collectionPath + suffix)) copyFileSync(collectionPath + suffix, copy + suffix);
  }
  const db = new DatabaseSync(copy, { readOnly: true });
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Anki stores review-card due dates as a day number counted from collection
 * creation, with each day starting at the "next day starts at" hour.
 */
function makeDayClock(crtSeconds: number, rolloverHour: number) {
  const origin = crtSeconds * 1000 + rolloverHour * 3_600_000;
  return {
    startOf: (day: number) => new Date(origin + day * DAY_MS),
    dayOf: (date: Date) => Math.floor((date.getTime() - origin) / DAY_MS),
  };
}

/** Minimal protobuf reader — just enough to pull two fields out of a deck preset. */
function readProtoVarints(buffer: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    while (i < buffer.length) {
      const byte = buffer[i++];
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  };
  while (i < buffer.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) out.set(field, varint());
    else if (wire === 1) i += 8;
    else if (wire === 2) {
      // Read the length first: `i += varint()` would capture `i` before
      // varint() advances it.
      const length = varint();
      i += length;
    }
    else if (wire === 5) i += 4;
    else break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Turning Anki fields into Lara card content
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** One visual line of a field: its text with markup removed, plus any media it referenced. */
type FieldLine = { text: string; sounds: string[] };

function splitLines(field: string): FieldLine[] {
  return field
    .split(/<br\s*\/?>|<\/div>|<\/p>|\n/i)
    .map((raw) => {
      const sounds = [...raw.matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1]);
      const text = decodeEntities(
        raw
          .replace(/\[sound:[^\]]+\]/g, "")
          .replace(/<img[^>]*>/gi, "")
          .replace(/<[^>]+>/g, ""),
      )
        .replace(/\s+/g, " ")
        .trim();
      return { text, sounds };
    });
}

function imagesIn(field: string): string[] {
  return [...field.matchAll(/<img[^>]*src=["']?([^"'>\s]+)/gi)].map((m) => decodeEntities(m[1]));
}

function soundsIn(field: string): string[] {
  return [...field.matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1]);
}

function plain(field: string): string {
  return splitLines(field)
    .map((line) => line.text)
    .filter(Boolean)
    .join(" ");
}

type ParsedContent = {
  cardType: CardType;
  target: string;
  source: string;
  targetSentence: string | null;
  sourceSentence: string | null;
  notes: string | null;
  image: string | null;
  audio: string | null;
  sentenceAudio: string | null;
  shape: string;
};

/**
 * A trailing "(Verb: att anse — to consider/deem.)" on a translation is a
 * grammar note, not part of the meaning. Lara shows notes separately.
 */
function splitTrailingNote(text: string): { text: string; note: string | null } {
  const match = text.match(/^(.*?)\s*\(((?:Verb|Phrase|Adverb|Noun|Adjective|Pronoun|Preposition|Conjunction|Note|Grammar)[^()]*:[^()]*)\)\s*$/i);
  if (!match || !match[1]) return { text, note: null };
  return { text: match[1].trim(), note: match[2].trim() };
}

function parseNote(fields: string[]): ParsedContent {
  const [front = "", back = ""] = fields;

  const frontImages = imagesIn(front);
  if (frontImages.length > 0) {
    const lines = splitLines(back).filter((line) => line.text || line.sounds.length);

    // World-flag cards: "EN: …", "PT: …", "SV: …", then an italic fun fact.
    const labelled = new Map<string, string>();
    for (const line of lines) {
      const m = line.text.match(/^([A-Z]{2}):\s*(.+)$/);
      if (m) labelled.set(m[1], m[2]);
    }
    if (labelled.has("EN") && labelled.size >= 2) {
      const extra = lines
        .filter((line) => !/^[A-Z]{2}:/.test(line.text) && line.text)
        .map((line) => line.text);
      const others = [...labelled].filter(([k]) => k !== "EN" && k !== "SV").map(([k, v]) => `${k}: ${v}`);
      return {
        shape: "picture-labelled",
        cardType: CardType.PICTURE,
        target: labelled.get("SV") ?? labelled.get("EN")!,
        source: labelled.get("EN")!,
        targetSentence: null,
        sourceSentence: null,
        notes: [...others, ...extra].join("\n") || null,
        image: frontImages[0],
        audio: lines.flatMap((l) => l.sounds)[0] ?? null,
        sentenceAudio: null,
      };
    }

    const [word, translation, sentence, sentenceTranslation, ...rest] = lines;
    return {
      shape: "picture",
      cardType: CardType.PICTURE,
      target: word?.text || plain(back),
      source: translation?.text ?? "",
      targetSentence: sentence?.text || null,
      sourceSentence: sentenceTranslation?.text || null,
      notes: rest.map((l) => l.text).filter(Boolean).join("\n") || null,
      image: frontImages[0],
      audio: word?.sounds[0] ?? null,
      sentenceAudio: sentence?.sounds[0] ?? null,
    };
  }

  const frontSounds = soundsIn(front);
  const backSounds = soundsIn(back);

  if (frontSounds.length > 0) {
    const { text, note } = splitTrailingNote(plain(back));
    return {
      shape: "target-front",
      cardType: CardType.RECOGNITION,
      target: plain(front),
      source: text,
      targetSentence: null,
      sourceSentence: null,
      notes: note,
      image: null,
      audio: frontSounds[0],
      sentenceAudio: null,
    };
  }

  if (backSounds.length > 0) {
    const { text, note } = splitTrailingNote(plain(front));
    return {
      shape: "target-back",
      cardType: CardType.PRODUCTION,
      target: plain(back),
      source: text,
      targetSentence: null,
      sourceSentence: null,
      notes: note,
      image: null,
      audio: backSounds[0],
      sentenceAudio: null,
    };
  }

  const { text, note } = splitTrailingNote(plain(back));
  return {
    shape: "no-audio",
    cardType: CardType.RECOGNITION,
    target: plain(front),
    source: text,
    targetSentence: null,
    sourceSentence: null,
    notes: note,
    image: null,
    audio: null,
    sentenceAudio: null,
  };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

const MEDIA_DIR = path.join(process.cwd(), ".media");

/**
 * Copies one Anki media file into Lara's media store under a content-hash name
 * (Anki names carry å/ä/ö and spaces; hashed names keep URLs plain ASCII and
 * dedupe identical files). Returns the public URL, or null if the file is gone.
 */
function makeMediaCopier(ankiMediaDir: string, dryRun: boolean) {
  const cache = new Map<string, string | null>();
  const stats = { copied: 0, missing: new Set<string>() };

  function copy(filename: string | null): string | null {
    if (!filename) return null;
    if (cache.has(filename)) return cache.get(filename)!;

    const sourcePath = path.join(ankiMediaDir, filename);
    if (!existsSync(sourcePath)) {
      stats.missing.add(filename);
      cache.set(filename, null);
      return null;
    }

    const bytes = readFileSync(sourcePath);
    const extension = path.extname(filename).slice(1).toLowerCase() || "bin";
    const key = `anki-${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
    const url = `/api/media/${key}.${extension}`;

    if (!dryRun) {
      const destination = path.join(MEDIA_DIR, `${key}.${extension}`);
      if (!existsSync(destination)) {
        mkdirSync(MEDIA_DIR, { recursive: true });
        copyFileSync(sourcePath, destination);
      }
    }
    stats.copied += 1;
    cache.set(filename, url);
    return url;
  }

  return { copy, stats };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const ANKI_TYPE_TO_STATE: Record<number, FsrsState> = {
  0: FsrsState.NEW,
  1: FsrsState.LEARNING,
  2: FsrsState.REVIEW,
  3: FsrsState.RELEARNING,
};

/** Anki review-log entries that are real answers (not manual reschedules). */
function isAnswer(entry: AnkiRevlog): boolean {
  return entry.ease >= 1 && entry.ease <= 4 && entry.type <= 3;
}

function revlogState(entry: AnkiRevlog): FsrsState {
  if (entry.ivl > 0) return FsrsState.REVIEW;
  return entry.type === 0 ? FsrsState.LEARNING : FsrsState.RELEARNING;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const ankiMediaDir = path.join(path.dirname(args.collectionPath), "collection.media");
  const importedAt = new Date();

  const { db, cleanup } = openCollection(args.collectionPath);

  try {
    const col = db.prepare("select crt from col").get() as { crt: number };
    const rolloverRow = db
      .prepare("select cast(val as text) v from config where key = 'rollover'")
      .get() as { v: string } | undefined;
    const clock = makeDayClock(col.crt, Number(rolloverRow?.v ?? 4));

    // Anki deck names are full paths ("Swedish Nouns\x1fAbstract"); Lara stores
    // the leaf name and a parent link, so keep the path parts.
    const deckRows = db.prepare("select id, name from decks").all() as { id: number; name: string }[];
    const decks = new Map(deckRows.map((d) => [d.id, d.name.split("\x1f").join(" · ")]));
    const deckIdByPath = new Map(deckRows.map((d) => [d.name.split("\x1f").join(" · "), d.id]));
    const notes = new Map(
      (db.prepare("select id, mid, flds, tags from notes").all() as AnkiNote[]).map((n) => [n.id, n]),
    );
    const cards = db
      .prepare("select id, nid, did, type, queue, due, ivl, reps, lapses, odue, odid, data from cards order by id")
      .all() as AnkiCard[];
    const revlogByCard = new Map<number, AnkiRevlog[]>();
    for (const entry of db
      .prepare("select id, cid, ease, ivl, time, type from revlog order by id")
      .all() as AnkiRevlog[]) {
      const list = revlogByCard.get(entry.cid) ?? [];
      list.push(entry);
      revlogByCard.set(entry.cid, list);
    }

    // Daily limits, when the collection uses a single deck preset.
    const presets = db.prepare("select config from deck_config").all() as { config: Uint8Array }[];
    const limits =
      presets.length === 1
        ? (() => {
            const fields = readProtoVarints(presets[0].config);
            return { newPerDay: fields.get(9), reviewsPerDay: fields.get(10) };
          })()
        : null;

    const media = makeMediaCopier(ankiMediaDir, args.dryRun);

    // ---- Build every card in memory first; nothing is written until it all parses.
    type Built = {
      ankiId: number;
      deckAnkiId: number;
      content: ParsedContent;
      tags: string[];
      createdAt: Date;
      schedule: {
        state: FsrsState;
        due: Date;
        stability: number;
        difficulty: number;
        elapsedDays: number;
        scheduledDays: number;
        reps: number;
        lapses: number;
        learningSteps: number;
        lastReview: Date | null;
        suspended: boolean;
      };
      reviews: {
        ankiId: number;
        rating: number;
        state: FsrsState;
        due: Date;
        stability: number;
        difficulty: number;
        elapsedDays: number;
        lastElapsedDays: number;
        scheduledDays: number;
        durationMs: number;
        reviewedAt: Date;
      }[];
      imageUrl: string | null;
      audioUrl: string | null;
      sentenceAudioUrl: string | null;
    };

    const built: Built[] = [];
    const report = {
      shapes: new Map<string, number>(),
      memoryFromAnki: 0,
      memoryReplayed: 0,
      memoryMissing: 0,
      dueMismatch: 0,
      dueChecked: 0,
      stabilityDrift: [] as number[],
      skippedNoContent: 0,
    };

    for (const card of cards) {
      const note = notes.get(card.nid);
      if (!note) continue;

      const content = parseNote(note.flds.split("\x1f"));
      if (!content.target || !content.source) {
        // Lara requires both sides; a blank Anki field shouldn't abort the run.
        content.target ||= "(blank)";
        content.source ||= "(blank)";
        report.skippedNoContent += 1;
      }
      report.shapes.set(content.shape, (report.shapes.get(content.shape) ?? 0) + 1);

      const deckAnkiId = card.odid || card.did;
      const rawDue = card.odid ? card.odue : card.due;
      const state = ANKI_TYPE_TO_STATE[card.type] ?? FsrsState.NEW;

      const history = (revlogByCard.get(card.id) ?? []).filter(isAnswer);
      const replay = replayHistory(
        history.map((entry) => ({ rating: entry.ease as RatingValue, reviewedAt: new Date(entry.id) })),
      );

      let fsrsData: { s?: number; d?: number; lrt?: number } = {};
      try {
        fsrsData = card.data ? JSON.parse(card.data) : {};
      } catch {
        fsrsData = {};
      }

      let stability = 0;
      let difficulty = 0;
      if (state !== FsrsState.NEW) {
        if (typeof fsrsData.s === "number" && typeof fsrsData.d === "number") {
          stability = fsrsData.s;
          difficulty = fsrsData.d;
          report.memoryFromAnki += 1;
          const last = replay.at(-1);
          if (last && fsrsData.s > 0) report.stabilityDrift.push(Math.abs(last.stability - fsrsData.s) / fsrsData.s);
        } else if (replay.length > 0) {
          stability = replay.at(-1)!.stability;
          difficulty = replay.at(-1)!.difficulty;
          report.memoryReplayed += 1;
        } else {
          // Reviewed in Anki but with no surviving log: seed from the interval.
          stability = Math.max(card.ivl, 1);
          difficulty = 5;
          report.memoryMissing += 1;
        }
      }

      let due: Date;
      if (state === FsrsState.NEW) {
        due = importedAt;
      } else if (rawDue > 1_000_000_000) {
        due = new Date(rawDue * 1000); // intraday learning: a unix timestamp
      } else {
        due = clock.startOf(rawDue); // review / interday learning: a day number
      }

      const lastAnswer = history.at(-1);
      const lastReview =
        typeof fsrsData.lrt === "number"
          ? new Date(fsrsData.lrt * 1000)
          : lastAnswer
            ? new Date(lastAnswer.id)
            : null;

      // Sanity check the day arithmetic: a review card's due day should equal
      // the day of its last answer plus the interval that answer set. Anki
      // counts days in the timezone it was in *at review time*, and `clock`
      // uses today's, so answers given further east (where the day rolls over
      // earlier in UTC) legitimately land one day later. Anything else is a bug.
      if (state === FsrsState.REVIEW && lastAnswer && lastAnswer.ivl === card.ivl && !card.odid) {
        report.dueChecked += 1;
        const drift = rawDue - (clock.dayOf(new Date(lastAnswer.id)) + card.ivl);
        if (drift !== 0 && drift !== 1) report.dueMismatch += 1;
      }

      const reviews = history.map((entry, i) => {
        const reviewedAt = new Date(entry.id);
        return {
          ankiId: entry.id,
          rating: entry.ease,
          state: revlogState(entry),
          due:
            entry.ivl > 0
              ? clock.startOf(clock.dayOf(reviewedAt) + entry.ivl)
              : new Date(entry.id + -entry.ivl * 1000),
          stability: replay[i].stability,
          difficulty: replay[i].difficulty,
          elapsedDays: replay[i].elapsedDays,
          lastElapsedDays: replay[i].lastElapsedDays,
          scheduledDays: Math.max(entry.ivl, 0),
          durationMs: entry.time,
          reviewedAt,
        };
      });

      built.push({
        ankiId: card.id,
        deckAnkiId,
        content,
        tags: note.tags.split(" ").filter(Boolean),
        createdAt: new Date(note.id),
        schedule: {
          state,
          due,
          stability,
          difficulty,
          elapsedDays: replay.at(-1)?.elapsedDays ?? 0,
          scheduledDays: state === FsrsState.REVIEW ? Math.max(card.ivl, 0) : 0,
          reps: card.reps,
          lapses: card.lapses,
          learningSteps: 0,
          lastReview: state === FsrsState.NEW ? null : lastReview,
          suspended: card.queue === -1,
        },
        reviews,
        imageUrl: media.copy(content.image),
        audioUrl: media.copy(content.audio),
        sentenceAudioUrl: media.copy(content.sentenceAudio),
      });
    }

    // ---- Decks that hold cards, plus every folder above them. Empty leaves
    // (Anki's "Default", abandoned decks) are left behind.
    const deckIds = [...new Set(built.map((b) => b.deckAnkiId))].sort((a, b) =>
      (decks.get(a) ?? "").localeCompare(decks.get(b) ?? ""),
    );
    const treePaths = new Set<string>();
    for (const id of deckIds) {
      const parts = (decks.get(id) ?? `Anki deck ${id}`).split(" · ");
      for (let depth = 1; depth <= parts.length; depth += 1) treePaths.add(parts.slice(0, depth).join(" · "));
    }
    const orderedPaths = [...treePaths].sort((a, b) => a.localeCompare(b));

    const deckDirection = (ankiDeckId: number): CardDirection => {
      const counts = new Map<CardType, number>();
      for (const b of built) {
        if (b.deckAnkiId === ankiDeckId) counts.set(b.content.cardType, (counts.get(b.content.cardType) ?? 0) + 1);
      }
      const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      return top === CardType.RECOGNITION ? CardDirection.RECOGNITION : CardDirection.PRODUCTION;
    };

    // ---- Report
    const now = importedAt;
    const active = built.filter((b) => !b.schedule.suspended);
    console.log(`\nAnki collection: ${args.collectionPath}`);
    console.log(`  ${built.length} cards in ${deckIds.length} decks, ${built.reduce((n, b) => n + b.reviews.length, 0)} reviews`);
    console.log(`  shapes: ${[...report.shapes].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(
      `  active: ${active.length} (new ${active.filter((b) => b.schedule.state === "NEW").length}, ` +
        `due now ${active.filter((b) => b.schedule.state !== "NEW" && b.schedule.due <= now).length}); ` +
        `suspended: ${built.length - active.length}`,
    );
    console.log(
      `  memory state: ${report.memoryFromAnki} from Anki FSRS, ${report.memoryReplayed} replayed from history, ${report.memoryMissing} seeded from interval`,
    );
    if (report.stabilityDrift.length) {
      const sorted = [...report.stabilityDrift].sort((a, b) => a - b);
      console.log(
        `  replay vs Anki stability (relative diff): median ${(sorted[Math.floor(sorted.length / 2)] * 100).toFixed(1)}%, ` +
          `p90 ${(sorted[Math.floor(sorted.length * 0.9)] * 100).toFixed(1)}%  (history snapshots only; card state uses Anki's value)`,
    );
    }
    console.log(
      `  due-date check: ${report.dueChecked - report.dueMismatch}/${report.dueChecked} review cards consistent with Anki's day arithmetic`,
    );
    if (report.dueMismatch > 0) {
      throw new Error(`${report.dueMismatch} review cards have due dates that don't follow from their history — not importing.`);
    }
    console.log(`  media: ${media.stats.copied} files, ${media.stats.missing.size} referenced but missing`);
    if (report.skippedNoContent) console.log(`  ${report.skippedNoContent} cards had a blank side (kept as "(blank)")`);
    if (limits) console.log(`  Anki daily limits: ${limits.newPerDay} new, ${limits.reviewsPerDay} reviews`);
    console.log("\n  deck tree:");
    for (const fullPath of orderedPaths) {
      const parts = fullPath.split(" · ");
      const id = deckIdByPath.get(fullPath);
      const inDeck = built.filter((b) => b.deckAnkiId === id);
      const label = `${"  ".repeat(parts.length - 1)}${parts.at(-1)}`;
      console.log(
        `    ${label.padEnd(48)} ${String(inDeck.length).padStart(4)} cards` +
          `  ${String(inDeck.filter((b) => b.schedule.suspended).length).padStart(4)} suspended` +
          (inDeck.length && id !== undefined ? `  → ${deckDirection(id)}` : ""),
      );
    }

    if (args.dryRun) {
      console.log("\n  samples:");
      for (const shape of report.shapes.keys()) {
        const sample = built.find((b) => b.content.shape === shape)!;
        const { content } = sample;
        console.log(`    [${shape} → ${content.cardType}]`);
        console.log(`      target: ${content.target}`);
        console.log(`      source: ${content.source}`);
        if (content.targetSentence) console.log(`      sentence: ${content.targetSentence} / ${content.sourceSentence}`);
        if (content.notes) console.log(`      notes: ${content.notes.replace(/\n/g, " | ")}`);
        console.log(`      media: image=${!!sample.imageUrl} audio=${!!sample.audioUrl} sentenceAudio=${!!sample.sentenceAudioUrl}`);
      }
      console.log("\nDry run — nothing written.");
      return;
    }

    // ---- Write
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set. Run `npm run db:dev` first.");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

    try {
      const email = process.env.LARA_USER_EMAIL ?? "you@lara.local";
      const user =
        (await prisma.user.findUnique({ where: { email } })) ??
        (await prisma.user.create({ data: { email, name: "You" } }));
      const profile =
        (await prisma.languageProfile.findUnique({
          where: { userId_targetLanguage: { userId: user.id, targetLanguage: args.targetLanguage } },
        })) ??
        (await prisma.languageProfile.create({
          data: { userId: user.id, targetLanguage: args.targetLanguage, sourceLanguage: args.sourceLanguage },
        }));

      const existingCards = await prisma.card.count({ where: { deck: { profileId: profile.id } } });
      if (existingCards > 0) {
        if (!args.replace) {
          throw new Error(
            `The ${args.targetLanguage} profile already has ${existingCards} cards. Re-run with --replace to delete its decks first.`,
          );
        }
        const laraReviews = await prisma.review.count({
          where: { ankiId: null, card: { deck: { profileId: profile.id } } },
        });
        if (laraReviews > 0 && !args.force) {
          throw new Error(
            `Refusing to replace: ${laraReviews} reviews were done in Lara and would be lost. Add --force if that's intended.`,
          );
        }
        const deleted = await prisma.deck.deleteMany({ where: { profileId: profile.id } });
        console.log(`\nDeleted ${deleted.count} existing decks (and their cards, reviews, and tutor threads).`);
      }

      // Created one tree level at a time, so every parent exists before its children.
      const laraIdByPath = new Map<string, string>();
      const deckIdFor = new Map<number, string>();
      const maxDepth = Math.max(...orderedPaths.map((p) => p.split(" · ").length));
      for (let depth = 1; depth <= maxDepth; depth += 1) {
        const level = orderedPaths.filter((p) => p.split(" · ").length === depth);
        const created = await prisma.deck.createManyAndReturn({
          data: level.map((fullPath, index) => {
            const parts = fullPath.split(" · ");
            const ankiId = deckIdByPath.get(fullPath);
            const holdsCards = ankiId !== undefined && deckIds.includes(ankiId);
            return {
              userId: user.id,
              profileId: profile.id,
              parentId: depth > 1 ? laraIdByPath.get(parts.slice(0, -1).join(" · "))! : null,
              name: parts.at(-1)!,
              emoji: emojiFor(fullPath),
              description: "Imported from Anki",
              sortOrder: index,
              direction: holdsCards ? deckDirection(ankiId) : CardDirection.RECOGNITION,
              // Anki's preset "New cards/day" becomes each deck's own limit.
              ...(limits?.newPerDay !== undefined ? { newCardsPerDay: limits.newPerDay } : {}),
              ankiId: ankiId !== undefined ? BigInt(ankiId) : null,
              createdAt: ankiId !== undefined && ankiId > 1e12 ? new Date(ankiId) : importedAt,
            };
          }),
          select: { id: true, ankiId: true },
        });
        level.forEach((fullPath, i) => {
          // createManyAndReturn preserves input order on Postgres.
          laraIdByPath.set(fullPath, created[i].id);
          if (created[i].ankiId !== null) deckIdFor.set(Number(created[i].ankiId), created[i].id);
        });
      }
      const createdDecks = [...laraIdByPath.values()];

      const cardIdFor = new Map<number, string>();
      for (const chunk of chunks(built, 500)) {
        const rows = await prisma.card.createManyAndReturn({
          data: chunk.map((b) => ({
            userId: user.id,
            deckId: deckIdFor.get(b.deckAnkiId)!,
            target: b.content.target,
            source: b.content.source,
            targetSentence: b.content.targetSentence,
            sourceSentence: b.content.sourceSentence,
            notes: b.content.notes,
            cardType: b.content.cardType,
            tags: b.tags,
            imageUrl: b.imageUrl,
            audioUrl: b.audioUrl,
            sentenceAudioUrl: b.sentenceAudioUrl,
            ankiId: BigInt(b.ankiId),
            createdAt: b.createdAt,
            ...b.schedule,
          })),
          select: { id: true, ankiId: true },
        });
        for (const row of rows) cardIdFor.set(Number(row.ankiId), row.id);
      }

      const reviewRows = built.flatMap((b) =>
        b.reviews.map((r) => ({
          ...r,
          ankiId: BigInt(r.ankiId),
          cardId: cardIdFor.get(b.ankiId)!,
          userId: user.id,
        })),
      );
      for (const chunk of chunks(reviewRows, 1000)) {
        await prisma.review.createMany({ data: chunk });
      }


      console.log(
        `\nImported ${createdDecks.length} decks, ${cardIdFor.size} cards, ${reviewRows.length} reviews` +
          (limits?.newPerDay !== undefined ? `; each deck gets ${limits.newPerDay} new cards/day.` : "."),
      );
      console.log("Next: `npm run media:optimize` to shrink the imported pictures for phones.");
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    cleanup();
  }
}

function emojiFor(deckName: string): string {
  const top = deckName.split(" · ")[0].toLowerCase();
  if (deckName.toLowerCase().includes("flag")) return "🚩";
  if (top.includes("archive")) return "🗄️";
  if (top.includes("grammar")) return "📐";
  if (top.includes("noun")) return "🏷️";
  if (top.includes("situation")) return "🗣️";
  return "📇";
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
