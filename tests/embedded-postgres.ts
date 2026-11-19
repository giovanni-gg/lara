// The private PostgreSQL 17 a test run starts on this machine: a fresh temp
// directory, a free loopback port, and every migration applied through
// `prisma migrate deploy` (never raw SQL, so the test schema is exactly what
// production gets). Called once per `npm run test:int` by
// tests/integration/global-setup.ts.
//
// Why embedded, not `prisma dev` or Docker: `embedded-postgres` ships the real
// server binaries as an npm package (the platform package is an optional
// dependency, so `npm ci` installs the right one on Windows, macOS and the
// Linux CI runner), and each run gets its own cluster. Two runs (two
// terminals, a person and an agent) never share a database, and none of them
// can touch the `prisma dev` data you use day to day.
//
// The database starts EMPTY apart from the schema: every test builds the rows
// it needs (tests/factories.ts).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { assertLocalDatabase } from "../src/lib/local-database";

const DB_NAME = "lara_test";
const DB_USER = "lara";
const DB_PASSWORD = "lara";

export type EmbeddedDatabase = {
  /** The URL of this run's private database, always on 127.0.0.1. */
  url: string;
  port: number;
  /** "server 1.2s, migrations 2.0s", for the one line a run prints. */
  timings: string;
  /** Stops the server and deletes its files. */
  stop: () => Promise<void>;
};

export type ProvisionOptions = {
  /** The repo root, where node_modules/ and prisma/ are. */
  root: string;
  /** Temp-directory prefix. Names the run's cluster so `removeStaleClusters` can find leftovers. */
  tmpPrefix: string;
};

/**
 * Environment keys a child Prisma CLI must NOT inherit. prisma.config.ts
 * switches to production on any of the first two; the URLs are replaced with
 * this run's below.
 */
const STRIPPED_FROM_CHILD = [
  "PRISMA_TARGET",
  "npm_lifecycle_event",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "SHADOW_DATABASE_URL",
];

export async function provisionEmbeddedDatabase({
  root,
  tmpPrefix,
}: ProvisionOptions): Promise<EmbeddedDatabase> {
  const port = await freePort();
  // The owner's pid in the name: until `start()` writes postmaster.pid it is
  // the only sign this directory belongs to a run still in progress.
  const dataDir = mkdtempSync(join(tmpdir(), `${tmpPrefix}${process.pid}-`));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: DB_USER,
    password: DB_PASSWORD,
    port,
    persistent: false, // stop() deletes the cluster files
    // Byte-order collation: the same on every machine and OS.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  const started = Date.now();
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  const url = `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${port}/${DB_NAME}`;
  assertLocalDatabase(url, "The test database harness");
  const timings: string[] = [`server ${elapsed(started)}`];

  // Migrate through the Prisma CLI, as production does. prisma.config.ts loads
  // `.env` with dotenv, which never overrides a key that is already set, so
  // the URL in the child's environment is what it uses.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of STRIPPED_FROM_CHILD) delete env[key];
  env.DATABASE_URL = url;
  env.SHADOW_DATABASE_URL = ""; // unused by `migrate deploy`; empty so `.env`'s can't apply
  const t = Date.now();
  try {
    // The CLI by file path: the package doesn't export its entry point.
    execFileSync(process.execPath, [join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    await pg.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`prisma migrate deploy failed against the embedded Postgres:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
  }
  timings.push(`migrations ${elapsed(t)}`);

  return {
    url,
    port,
    timings: timings.join(", "),
    stop: async () => {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Delete the data directories of runs that were killed rather than stopped.
 * An interrupted run (Ctrl-C, a killed terminal) leaves its cluster behind. A directory is
 * left alone while the process that made it is alive (its pid is in the name)
 * or its postmaster.pid names a live process. Returns how many were removed.
 */
export function removeStaleClusters(tmpPrefix: string): number {
  let removed = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(tmpPrefix)) continue;
    const dir = join(tmpdir(), name);
    const owner = Number(/^(\d+)-/.exec(name.slice(tmpPrefix.length))?.[1]);
    if ((owner && processIsAlive(owner)) || clusterIsLive(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // Still in use after all; leave it.
    }
  }
  return removed;
}

function clusterIsLive(dir: string): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(join(dir, "postmaster.pid"), "utf8").split("\n")[0]);
  } catch {
    return false; // never started, or already stopped cleanly
  }
  return !!pid && processIsAlive(pid);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // alive, not ours
  }
}

function elapsed(since: number): string {
  return `${((Date.now() - since) / 1000).toFixed(1)}s`;
}

/** A loopback port nothing is listening on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}
