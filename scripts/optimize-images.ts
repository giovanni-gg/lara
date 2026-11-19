import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Card pictures imported from Anki are 1024×1024 PNGs (~850 KB each) — far
 * more than a phone needs to show a ~350px image. This writes a 640px WebP
 * next to each one in `.media/` (~45 KB) and points the cards at it.
 *
 *   npm run media:optimize                                   # convert + update local DB
 *   npm run media:optimize -- --db-env-file .env.neon-prod   # update another DB
 *
 * Idempotent: existing WebPs are kept, already-updated cards are untouched.
 * Upload the new files with `npm run media:upload` before pointing a
 * deployed database at them. Originals are left in place.
 */

const MEDIA_DIR = path.join(process.cwd(), ".media");
const MAX_SIDE = 640;
const QUALITY = 76;
const SOURCE = /\.(png|jpe?g)$/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function convertAll() {
  const sources = readdirSync(MEDIA_DIR).filter((f) => SOURCE.test(f));
  let made = 0;
  let before = 0;
  let after = 0;
  for (const file of sources) {
    const target = path.join(MEDIA_DIR, file.replace(SOURCE, ".webp"));
    if (!existsSync(target)) {
      await sharp(path.join(MEDIA_DIR, file))
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(target);
      made += 1;
    }
    before += readFileSync(path.join(MEDIA_DIR, file)).length;
    after += readFileSync(target).length;
  }
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  console.log(`${sources.length} images: ${made} converted now; ${mb(before)} → ${mb(after)}`);
}

async function updateDb() {
  const envFile = arg("--db-env-file");
  const url = envFile
    ? (() => {
        const env = parse(readFileSync(envFile));
        return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
      })()
    : process.env.DATABASE_URL;
  if (!url) throw new Error("No database URL");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    // Only repoint cards whose WebP actually exists.
    const cards = await prisma.card.findMany({
      where: { imageUrl: { not: null } },
      select: { id: true, imageUrl: true },
    });
    const pending = cards.filter((c) => SOURCE.test(c.imageUrl!));
    const missing = pending.filter(
      (c) => !existsSync(path.join(MEDIA_DIR, path.basename(c.imageUrl!).replace(SOURCE, ".webp"))),
    );
    if (missing.length) throw new Error(`${missing.length} cards reference images with no WebP — run without --db-env-file first`);

    const updated = await prisma.$executeRaw`
      UPDATE "Card"
      SET "imageUrl" = regexp_replace("imageUrl", '\.(png|jpe?g)$', '.webp', 'i')
      WHERE "imageUrl" ~* '^/api/media/[A-Za-z0-9_-]+\.(png|jpe?g)$'
    `;
    console.log(`${envFile ? new URL(url).host : "local"}: ${updated} cards now use WebP (${cards.length - pending.length} already did)`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await convertAll();
  await updateDb();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
