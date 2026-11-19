// Database helpers for integration tests. Use `prisma` from "@/lib/db" as the
// app does; these are the extras a test needs around it.

import { prisma } from "@/lib/db";

/**
 * Empties every table except Prisma's migration history, in one statement.
 * tests/integration/setup.ts runs it before every test, so a test only calls
 * it directly to wipe data mid-test. Table names are read from the database,
 * so a model added later is covered without touching this.
 */
export async function resetDatabase(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
