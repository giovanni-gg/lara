import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Which database the Prisma CLI talks to.
//
// LOCAL, by default: DATABASE_URL and SHADOW_DATABASE_URL from `.env` — the
// `prisma dev` server (`npm run db:dev`). `migrate dev`, `migrate status`,
// `db push`, `studio` and `generate` all land here. A DATABASE_URL already in
// the environment wins over `.env` (dotenv never overrides), which is how the
// test harness (tests/embedded-postgres.ts) points `migrate deploy` at its own
// throwaway server.
//
// PRODUCTION (Neon), only when asked explicitly:
//   - `npm run db:migrate:deploy`        (the ONLY way migrations reach production)
//   - any npm script ending in `:prod`   (e.g. `npm run db:migrate:status:prod`)
//   - PRISMA_TARGET=production
// The URLs then come from `.env.neon-prod` and nowhere else: the file
// overrides the shell and `.env` is not read at all. Deliberately not named
// `.env.production.local` — `next build` would auto-load that file, and a
// local production build (the browser tests run one) could reach production.
//
// Never print a URL from here.

const PRODUCTION_ENV_FILE = ".env.neon-prod";

const script = process.env.npm_lifecycle_event ?? "";
const toProduction =
  process.env.PRISMA_TARGET === "production" ||
  script === "db:migrate:deploy" ||
  script.endsWith(":prod");

let url: string | undefined;
let shadowDatabaseUrl: string | undefined;

if (toProduction) {
  const file = resolve(process.cwd(), PRODUCTION_ENV_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `Targeting production (${script || "PRISMA_TARGET=production"}) needs ${PRODUCTION_ENV_FILE} ` +
        "with DATABASE_URL (and DATABASE_URL_UNPOOLED). It was not found, so nothing was run.",
    );
  }
  // Only the file counts: a URL left in the shell must not redirect a deploy.
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  config({ path: file, override: true, quiet: true });
  // Migrations need a direct (unpooled) connection; fall back to DATABASE_URL.
  url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error(`${PRODUCTION_ENV_FILE} defines neither DATABASE_URL_UNPOOLED nor DATABASE_URL.`);
  process.stderr.write(`prisma.config.ts: targeting PRODUCTION (${PRODUCTION_ENV_FILE})\n`);
} else {
  config({ quiet: true });
  url = process.env.DATABASE_URL;
  // `prisma dev` serves the main database as `template1`, which Prisma cannot
  // clone into an auto-created shadow database — it collides with the types
  // already there. Point migrations at the second server `prisma dev` starts
  // for exactly this purpose.
  shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL || undefined;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: { url, shadowDatabaseUrl },
});
