// Runs in every worker before each integration test file, BEFORE the file's
// own imports. That ordering is load-bearing: src/lib/db.ts reads DATABASE_URL
// when it is first imported and caches its PrismaClient on globalThis, so the
// URL has to be in place before anything imports it. (Hence the dynamic
// imports below: a static import of anything reaching src/lib/db.ts would be
// hoisted above the assignments.)
//
// Its job is to point the tests at THIS RUN's private database (the embedded
// PostgreSQL tests/integration/global-setup.ts started) and to make it
// impossible to point anywhere else. The URL comes from the global setup,
// never from a file or the shell, is FORCED onto process.env, and anything
// that is not loopback is refused, so neither `.env` nor a stray
// `export DATABASE_URL=...` can leak in.

import { afterAll, beforeEach, inject } from "vitest";
import { assertLocalDatabase } from "../../src/lib/local-database";
import { TEST_USER_EMAIL } from "../world";
import { clearRevalidated } from "./stubs/next-cache";
import { resetRequest } from "./stubs/next-headers";
import { clearAfter } from "./stubs/next-server";

const url = inject("databaseUrl");
if (!url) {
  throw new Error(
    "Integration tests got no database URL from tests/integration/global-setup.ts. " +
      "Run them through `npm run test:int`, which loads vitest.integration.config.mts.",
  );
}
if (process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error("Integration tests must not run on Vercel: they write real rows.");
}
assertLocalDatabase(url, "Integration tests");

// Override, don't merge: the global setup is the only accepted source.
process.env.DATABASE_URL = url;
process.env.DATABASE_URL_UNPOOLED = url;
// Who src/lib/session.ts resolves as (it reads this at import).
process.env.LARA_USER_EMAIL = TEST_USER_EMAIL;
// Never real AI, TTS, images or Blob from a test: with these empty the app
// takes its "not configured" paths (503 for AI, silent content for TTS, picture
// cards without pictures, local media).
process.env.ANTHROPIC_API_KEY = "";
process.env.AI_GATEWAY_API_KEY = "";
process.env.ELEVENLABS_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.BLOB_READ_WRITE_TOKEN = "";
process.env.VERCEL_OIDC_TOKEN = "";
process.env.MEDIA_STORAGE = "local";
// The password gate is off unless a test sets LARA_PASSWORD itself.
delete process.env.LARA_PASSWORD;

// Every test starts from an empty database and a blank request. Build the
// rows a test needs in the test or in `beforeEach`, never in `beforeAll`:
// this reset runs after `beforeAll` and would wipe them.
beforeEach(async () => {
  const { resetDatabase } = await import("./db");
  await resetDatabase();
  resetRequest();
  clearRevalidated();
  clearAfter();
});

afterAll(async () => {
  const cached = (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma;
  await cached?.$disconnect();
});
