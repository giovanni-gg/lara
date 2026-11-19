// Pure helpers for reading an Anki collection: field parsing, the day clock,
// and the protobuf varint reader. No I/O, so they are unit-tested directly
// (parse.test.ts); scripts/import-anki.ts does the reading and writing.

import { CardType } from "../../src/generated/prisma/enums";

const DAY_MS = 86_400_000;

/**
 * Anki stores review-card due dates as a day number counted from collection
 * creation, with each day starting at the "next day starts at" hour.
 */
export function makeDayClock(crtSeconds: number, rolloverHour: number) {
  const origin = crtSeconds * 1000 + rolloverHour * 3_600_000;
  return {
    startOf: (day: number) => new Date(origin + day * DAY_MS),
    dayOf: (date: Date) => Math.floor((date.getTime() - origin) / DAY_MS),
  };
}

/** Minimal protobuf reader — just enough to pull two fields out of a deck preset. */
export function readProtoVarints(buffer: Uint8Array): Map<number, number> {
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

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** One visual line of a field: its text with markup removed, plus any media it referenced. */
export type FieldLine = { text: string; sounds: string[] };

export function splitLines(field: string): FieldLine[] {
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

export function imagesIn(field: string): string[] {
  return [...field.matchAll(/<img[^>]*src=["']?([^"'>\s]+)/gi)].map((m) => decodeEntities(m[1]));
}

export function soundsIn(field: string): string[] {
  return [...field.matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1]);
}

export function plain(field: string): string {
  return splitLines(field)
    .map((line) => line.text)
    .filter(Boolean)
    .join(" ");
}

export type ParsedContent = {
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
export function splitTrailingNote(text: string): { text: string; note: string | null } {
  const match = text.match(/^(.*?)\s*\(((?:Verb|Phrase|Adverb|Noun|Adjective|Pronoun|Preposition|Conjunction|Note|Grammar)[^()]*:[^()]*)\)\s*$/i);
  if (!match || !match[1]) return { text, note: null };
  return { text: match[1].trim(), note: match[2].trim() };
}

/**
 * Content mapping (Anki "Basic" notes, Front/Back):
 *   picture on the front   -> PICTURE      (back: word, translation, sentence, sentence translation)
 *   audio on the front     -> RECOGNITION  (front is the target language)
 *   audio on the back      -> PRODUCTION   (back is the target language)
 *   no audio               -> RECOGNITION
 *
 * `targetCode` / `sourceCode` (ISO 639-1; default "sv" / "en") pick the lines
 * of a labelled flag card ("EN: …", "PT: …", "SV: …"): the learner's target
 * language is the answer, their source language the translation, and any
 * other labelled lines become notes. A missing label falls back to EN.
 */
export function parseNote(
  fields: string[],
  { targetCode = "sv", sourceCode = "en" }: { targetCode?: string; sourceCode?: string } = {},
): ParsedContent {
  const [front = "", back = ""] = fields;
  const targetCodeLabel = targetCode.toUpperCase();
  const sourceCodeLabel = sourceCode.toUpperCase();

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
      const targetLabel = labelled.has(targetCodeLabel) ? targetCodeLabel : "EN";
      const sourceLabel =
        labelled.has(sourceCodeLabel) && sourceCodeLabel !== targetLabel ? sourceCodeLabel : "EN";
      const others = [...labelled]
        .filter(([k]) => k !== targetLabel && k !== sourceLabel)
        .map(([k, v]) => `${k}: ${v}`);
      return {
        shape: "picture-labelled",
        cardType: CardType.PICTURE,
        target: labelled.get(targetLabel)!,
        source: labelled.get(sourceLabel)!,
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
