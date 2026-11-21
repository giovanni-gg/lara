import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Copies every row from one Lara database to another, ids and timestamps
 * intact — used to move the local `prisma dev` data into production (Neon).
 *
 *   npm run db:copy -- --to-env-file .env.production.local [--dry-run]
 *
 * Source: DATABASE_URL from the normal environment (.env).
 * Target: DATABASE_URL_UNPOOLED (preferred for bulk writes) or DATABASE_URL
 *         read from --to-env-file, so the two never get mixed up.
 *
 * The target must already be migrated (`prisma migrate deploy`) and empty;
 * the script refuses to write into a database that has any users.
 * Rows are written sequentially in chunks (see AGENTS.md on concurrency).
 */

const CHUNK = 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function client(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable url)";
  }
}

async function main() {
  const envFile = arg("--to-env-file");
  const dryRun = process.argv.includes("--dry-run");
  if (!envFile) {
    console.error("Usage: npm run db:copy -- --to-env-file <file> [--dry-run]");
    process.exit(1);
  }

  const sourceUrl = process.env.DATABASE_URL;
  const targetEnv = parse(readFileSync(envFile));
  const targetUrl = targetEnv.DATABASE_URL_UNPOOLED || targetEnv.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL (source) is not set");
  if (!targetUrl) throw new Error(`No DATABASE_URL_UNPOOLED or DATABASE_URL in ${envFile}`);
  if (sourceUrl === targetUrl) throw new Error("Source and target are the same database");

  // Hosts only — never print credentials.
  console.log(`source: ${hostOf(sourceUrl)}\ntarget: ${hostOf(targetUrl)}`);

  const source = client(sourceUrl);
  const target = client(targetUrl);

  try {
    const existing = await target.user.count();
    if (existing > 0) throw new Error(`Target already has ${existing} user(s) — refusing to copy into a non-empty database.`);

    const users = await source.user.findMany();
    const profiles = await source.languageProfile.findMany();
    const decks = await source.deck.findMany();
    const cards = await source.card.findMany();
    const reviews = await source.review.findMany();
    const messages = await source.cardChatMessage.findMany();
    const articles = await source.article.findMany();
    const segments = await source.articleSegment.findMany();

    // Parents before children: the deck tree references itself.
    const depth = new Map<string, number>();
    const byId = new Map(decks.map((d) => [d.id, d]));
    const depthOf = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!;
      const parent = byId.get(id)?.parentId;
      const value = parent ? depthOf(parent) + 1 : 0;
      depth.set(id, value);
      return value;
    };
    const orderedDecks = [...decks].sort((a, b) => depthOf(a.id) - depthOf(b.id));

    const plan = [
      ["users", users.length],
      ["profiles", profiles.length],
      ["decks", decks.length],
      ["cards", cards.length],
      ["reviews", reviews.length],
      ["tutor messages", messages.length],
      ["articles", articles.length],
      ["article segments", segments.length],
    ] as const;
    for (const [name, n] of plan) console.log(`  ${name.padEnd(18)} ${n}`);
    if (dryRun) {
      console.log("Dry run — nothing written.");
      return;
    }

    const write = async <T>(label: string, rows: T[], fn: (chunk: T[]) => Promise<unknown>) => {
      for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
      console.log(`  wrote ${label}`);
    };

    await write("users", users, (data) => target.user.createMany({ data }));
    await write("profiles", profiles, (data) => target.languageProfile.createMany({ data }));
    await write("decks", orderedDecks, (data) => target.deck.createMany({ data }));
    await write("cards", cards, (data) => target.card.createMany({ data }));
    await write("reviews", reviews, (data) =>
      target.review.createMany({
        // A read JSON null can't be written back as-is; leaving it out is null.
        data: data.map(({ previousState, ...review }) => ({
          ...review,
          previousState: previousState ?? undefined,
        })),
      }),
    );
    await write("tutor messages", messages, (data) => target.cardChatMessage.createMany({ data }));
    await write("articles", articles, (data) => target.article.createMany({ data }));
    await write("article segments", segments, (data) => target.articleSegment.createMany({ data }));

    // Verify by recount.
    const counts = [
      await target.user.count(),
      await target.languageProfile.count(),
      await target.deck.count(),
      await target.card.count(),
      await target.review.count(),
      await target.cardChatMessage.count(),
      await target.article.count(),
      await target.articleSegment.count(),
    ];
    const mismatch = plan.filter(([, n], i) => counts[i] !== n);
    if (mismatch.length) throw new Error(`Count mismatch after copy: ${mismatch.map(([name]) => name).join(", ")}`);
    console.log("Done — target counts match source.");
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
