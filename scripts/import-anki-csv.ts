import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createEmptyCard } from "ts-fsrs";

/**
 * Imports the CSV decks from the original anki_creator project.
 *
 * Usage:
 *   npm run import:anki -- <path-to-anki_creator/input/language_learning/target_swedish> sv
 *
 * Directory structure is preserved as deck names, so
 * `nouns/professions.csv` becomes a deck called "Nouns · Professions".
 * Audio is not re-generated here — cards get audio the first time you
 * generate or edit them in the app.
 */

const DEFAULT_SOURCE = "en";

async function main() {
  const [inputPath, targetLanguage, sourceLanguage = DEFAULT_SOURCE] =
    process.argv.slice(2);

  if (!inputPath || !targetLanguage) {
    console.error(
      "Usage: npm run import:anki -- <csv-file-or-directory> <target-language> [source-language]\n" +
        "Example: npm run import:anki -- ../personal-projects/anki_creator/input/language_learning/target_swedish sv",
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Run `npm run db:dev` first.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const email = process.env.LARA_USER_EMAIL ?? "you@lara.local";
    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({ data: { email, name: "You" } }));

    const profile =
      (await prisma.languageProfile.findUnique({
        where: { userId_targetLanguage: { userId: user.id, targetLanguage } },
      })) ??
      (await prisma.languageProfile.create({
        data: { userId: user.id, targetLanguage, sourceLanguage, isActive: true },
      }));

    const files = await collectCsvFiles(inputPath);
    if (files.length === 0) {
      console.error(`No .csv files found under ${inputPath}`);
      process.exit(1);
    }

    console.log(`Importing ${files.length} file(s) into ${targetLanguage}…\n`);

    let totalCards = 0;
    let totalSkipped = 0;

    for (const file of files) {
      const rows = parseCsv(await readFile(file, "utf8"));
      if (rows.length === 0) {
        console.log(`  skip  ${path.basename(file)} (empty)`);
        continue;
      }

      const name = deckNameFor(inputPath, file);
      const deck =
        (await prisma.deck.findFirst({
          where: { userId: user.id, profileId: profile.id, name },
        })) ??
        (await prisma.deck.create({
          data: {
            userId: user.id,
            profileId: profile.id,
            name,
            emoji: "📇",
            description: `Imported from ${path.basename(file)}`,
          },
        }));

      // Don't duplicate on a re-run.
      const existing = new Set(
        (
          await prisma.card.findMany({
            where: { deckId: deck.id },
            select: { target: true },
          })
        ).map((c) => c.target.toLowerCase()),
      );

      const fresh = rows.filter(
        (row) => !existing.has(row.target.toLowerCase()),
      );

      if (fresh.length > 0) {
        const empty = createEmptyCard(new Date());
        await prisma.card.createMany({
          data: fresh.map((row) => ({
            userId: user.id,
            deckId: deck.id,
            target: row.target,
            source: row.source,
            targetSentence: row.targetSentence,
            tags: row.tag ? [row.tag] : [],
            due: empty.due,
            stability: empty.stability,
            difficulty: empty.difficulty,
            elapsedDays: empty.elapsed_days,
            scheduledDays: empty.scheduled_days,
            reps: empty.reps,
            lapses: empty.lapses,
            learningSteps: empty.learning_steps,
          })),
        });
      }

      totalCards += fresh.length;
      totalSkipped += rows.length - fresh.length;
      console.log(
        `  ok    ${name} — ${fresh.length} added` +
          (rows.length - fresh.length > 0
            ? `, ${rows.length - fresh.length} already present`
            : ""),
      );
    }

    console.log(
      `\nDone. ${totalCards} cards imported, ${totalSkipped} skipped as duplicates.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

type Row = {
  target: string;
  source: string;
  targetSentence: string | null;
  tag: string | null;
};

async function collectCsvFiles(target: string): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) return target.endsWith(".csv") ? [target] : [];

  const found: string[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) found.push(...(await collectCsvFiles(full)));
    else if (entry.name.endsWith(".csv")) found.push(full);
  }
  return found.sort();
}

/** `nouns/professions.csv` → "Nouns · Professions" */
function deckNameFor(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\.csv$/, "");
  return relative
    .split(/[\\/]/)
    .map((part) =>
      part
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    )
    .join(" · ");
}

/**
 * Minimal RFC-4180 parser — the anki_creator CSVs use quoted fields containing
 * commas, so splitting on "," is not enough.
 */
function parseCsv(text: string): Row[] {
  const records = splitRecords(text.replace(/^﻿/, ""));
  if (records.length < 2) return [];

  const header = records[0].map((h) => h.trim().toLowerCase());
  const columnOf = (name: string) => header.indexOf(name);

  const targetIndex = columnOf("target_language");
  const sourceIndex = columnOf("source_language");
  const sentenceIndex = columnOf("sentence_target_language");
  const tagIndex = columnOf("tag");

  if (targetIndex === -1 || sourceIndex === -1) return [];

  const rows: Row[] = [];
  for (const record of records.slice(1)) {
    const target = (record[targetIndex] ?? "").trim();
    const source = (record[sourceIndex] ?? "").trim();
    if (!target || !source) continue;

    rows.push({
      target,
      source,
      targetSentence:
        sentenceIndex === -1
          ? null
          : (record[sentenceIndex] ?? "").trim() || null,
      tag: tagIndex === -1 ? null : (record[tagIndex] ?? "").trim() || null,
    });
  }
  return rows;
}

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      if (record.some((value) => value.trim() !== "")) records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }

  record.push(field);
  if (record.some((value) => value.trim() !== "")) records.push(record);

  return records;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
