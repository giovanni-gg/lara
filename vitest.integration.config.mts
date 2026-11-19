import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests: `npm run test:int`. The real library code and server
// actions against a REAL database: a private PostgreSQL 17 that
// tests/integration/global-setup.ts starts on this machine for the run,
// migrates with `prisma migrate deploy`, and deletes afterwards.
//
// Kept out of `npm test` on purpose: the unit suite is pure and runs in a
// second; this one starts a database server first.
//
// The aliases swap out the Next.js modules that only work inside a live HTTP
// request. Everything else (actions, Prisma, the scheduler) is the real code.

const root = import.meta.dirname;
const stubs = resolve(root, "tests/integration/stubs");

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "src"),
      "server-only": resolve(stubs, "server-only.ts"),
      "next/cache": resolve(stubs, "next-cache.ts"),
      "next/headers": resolve(stubs, "next-headers.ts"),
      "next/navigation": resolve(stubs, "next-navigation.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Once per run: start the embedded Postgres, migrate, hand its URL to the
    // workers. Once per file: force that URL onto process.env, reset per test.
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // One database per RUN, shared by every file, and every test truncates it
    // first: two files at once would wipe each other's rows mid-test.
    fileParallelism: false,
    // A write path is several queries and the first query in a file also opens
    // the pool; the unit suite's 5 s default is too tight on a busy machine.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
