// Runs ONCE per `npm run test:int`, before any test file: starts a private
// PostgreSQL 17 on this machine, migrates it with `prisma migrate deploy`, and
// hands its URL to the workers. Tears it all down when the run ends.
//
// The recipe lives in tests/embedded-postgres.ts.

import type { TestProject } from "vitest/node";
import { provisionEmbeddedDatabase, removeStaleClusters } from "../embedded-postgres";

declare module "vitest" {
  export interface ProvidedContext {
    /** The URL of this run's private database, always on 127.0.0.1. */
    databaseUrl: string;
  }
}

const TMP_PREFIX = "lara-int-pg-";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    throw new Error("Integration tests must not run on Vercel: they write real rows.");
  }
  removeStaleClusters(TMP_PREFIX);
  const db = await provisionEmbeddedDatabase({ root: project.config.root, tmpPrefix: TMP_PREFIX });

  project.provide("databaseUrl", db.url);
  // Straight to stderr: Vitest swallows console.log from setup code.
  process.stderr.write(
    `\n  integration tests -> embedded PostgreSQL 17 on 127.0.0.1:${db.port}` +
      ` (fresh: ${db.timings}; deleted after the run)\n\n`,
  );

  return db.stop;
}
