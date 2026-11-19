/**
 * One-time (and re-runnable) copy of `.media/` into the private Vercel Blob
 * store that production reads with MEDIA_STORAGE=blob.
 *
 *   npm run media:upload -- --env-file .env.production.local [--dry-run] [--concurrency 8]
 *
 * - Lists the store once up front (paginated) and skips every file already
 *   there at the same size, so re-running after an interruption — Ctrl-C
 *   included — picks up where it stopped.
 * - Uploads to `media/<filename>`, the pathname src/lib/media.ts reads.
 * - `--dry-run` counts and uploads nothing. Without a token it can only count
 *   local files, and says so.
 * - Without `--env-file`, reads `.env`.
 * - Authenticates with BLOB_READ_WRITE_TOKEN, or failing that with
 *   VERCEL_OIDC_TOKEN + BLOB_STORE_ID if the pulled env has those instead.
 */
import { config } from "dotenv";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  BlobAccessError,
  BlobContentTypeNotAllowedError,
  BlobFileTooLargeError,
  BlobServiceRateLimited,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  list,
  put,
} from "@vercel/blob";
import {
  blobPathname,
  contentTypeFor,
  isMediaFilename,
  MAX_MEDIA_BYTES,
} from "../src/lib/media";

const MEDIA_DIR = path.join(process.cwd(), ".media");
const PROGRESS_EVERY = 100;
const MAX_ATTEMPTS = 5;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// --- arguments ---------------------------------------------------------------

type Args = { envFile: string | null; dryRun: boolean; concurrency: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { envFile: null, dryRun: false, concurrency: 8 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--env-file") args.envFile = requireValue(argv, ++i, arg);
    else if (arg.startsWith("--env-file=")) args.envFile = arg.slice("--env-file=".length);
    else if (arg === "--concurrency") {
      args.concurrency = Number(requireValue(argv, ++i, arg));
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
        fail("--concurrency must be a positive integer");
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run media:upload -- [--env-file <path>] [--dry-run] [--concurrency <n>]",
      );
      process.exit(0);
    } else fail(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const value = argv[i];
  if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
  return value;
}

function fail(message: string): never {
  console.error(`upload-media: ${message}`);
  process.exit(1);
}

// --- helpers -----------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Errors that will fail for every file, so retrying or continuing is pointless. */
function isFatal(error: unknown): boolean {
  return (
    error instanceof BlobAccessError ||
    error instanceof BlobStoreNotFoundError ||
    error instanceof BlobStoreSuspendedError
  );
}

/** Errors specific to one file that a retry won't fix. */
function isPermanent(error: unknown): boolean {
  return (
    isFatal(error) ||
    error instanceof BlobContentTypeNotAllowedError ||
    error instanceof BlobFileTooLargeError
  );
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Belt and braces: never let a token reach the terminal.
  return message.replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, "vercel_blob_rw_***");
}

/**
 * Retries with exponential backoff and jitter; honours Retry-After when the
 * service rate-limits. The SDK already retries 5xx/network errors internally
 * (VERCEL_BLOB_RETRIES, lowered below), this covers what it gives up on.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isPermanent(error) || attempt >= MAX_ATTEMPTS) throw error;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      const wait =
        error instanceof BlobServiceRateLimited && error.retryAfter > 0
          ? error.retryAfter * 1000
          : backoff / 2 + Math.random() * (backoff / 2);
      console.warn(
        `  retry ${attempt}/${MAX_ATTEMPTS - 1} for ${label} in ${(wait / 1000).toFixed(1)}s: ${describe(error)}`,
      );
      await sleep(wait);
    }
  }
}

// --- main --------------------------------------------------------------------

type LocalFile = { name: string; size: number };

async function localFiles(): Promise<{ files: LocalFile[]; ignored: string[] }> {
  let names: string[];
  try {
    names = await readdir(MEDIA_DIR);
  } catch {
    fail(`No media directory at ${MEDIA_DIR}`);
  }
  const files: LocalFile[] = [];
  const ignored: string[] = [];
  for (const name of names.sort()) {
    if (!isMediaFilename(name)) {
      ignored.push(name);
      continue;
    }
    const info = await stat(path.join(MEDIA_DIR, name));
    if (info.isFile()) files.push({ name, size: info.size });
    else ignored.push(name);
  }
  return { files, ignored };
}

/** An explicit read-write token, or nothing to let the SDK use OIDC from the env. */
type BlobAuth = { token?: string };

/** Every `media/` object in the store, pathname → size. */
async function remoteSizes(auth: BlobAuth): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await withRetry("list", () =>
      list({ prefix: "media/", limit: 1000, cursor, ...auth }),
    );
    for (const blob of page.blobs) sizes.set(blob.pathname, blob.size);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return sizes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const envFile = args.envFile ?? ".env";
  const loaded = config({ path: envFile, quiet: true });
  if (loaded.error && args.envFile) fail(`Could not read env file ${args.envFile}`);

  // The SDK retries 5xx/network errors 10 times by default with long waits;
  // keep it short so our own backoff (which also handles rate limits) governs.
  process.env.VERCEL_BLOB_RETRIES ??= "2";

  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
  if (token && !/^vercel_blob_rw_[A-Za-z0-9]+_/.test(token)) {
    fail(
      `BLOB_READ_WRITE_TOKEN from ${envFile} doesn't look like a read-write token (expected vercel_blob_rw_…)`,
    );
  }

  const { files, ignored } = await localFiles();
  const localBytes = files.reduce((sum, f) => sum + f.size, 0);
  const oversized = files.filter((f) => f.size > MAX_MEDIA_BYTES);
  console.log(`Local: ${files.length} files, ${formatBytes(localBytes)} in ${MEDIA_DIR}`);
  if (ignored.length) {
    console.log(`  ignoring ${ignored.length} non-media entries (e.g. ${ignored.slice(0, 3).join(", ")})`);
  }
  if (oversized.length) {
    console.warn(
      `  ${oversized.length} files exceed ${formatBytes(MAX_MEDIA_BYTES)} and won't be served by /api/media: ` +
        oversized.slice(0, 5).map((f) => f.name).join(", "),
    );
  }

  // A store connected to a project may hand out short-lived OIDC credentials
  // (VERCEL_OIDC_TOKEN + BLOB_STORE_ID) instead of a read-write token; the SDK
  // reads those from the environment itself when no token is passed.
  const oidc = Boolean(process.env.VERCEL_OIDC_TOKEN?.trim() && process.env.BLOB_STORE_ID?.trim());
  if (!token && !oidc) {
    fail(
      args.dryRun
        ? `BLOB_READ_WRITE_TOKEN is not set (looked in the environment and ${envFile}); ` +
            "counted local files only. Pass --env-file .env.production.local to compare with the store."
        : `BLOB_READ_WRITE_TOKEN is not set (looked in the environment and ${envFile}). ` +
            "Run `vercel env pull .env.production.local`, then pass --env-file .env.production.local.",
    );
  }
  const auth: BlobAuth = token ? { token } : {};
  console.log(`Auth: ${token ? "BLOB_READ_WRITE_TOKEN" : "VERCEL_OIDC_TOKEN + BLOB_STORE_ID"}`);

  console.log("Listing the Blob store…");
  let remote: Map<string, number>;
  try {
    remote = await remoteSizes(auth);
  } catch (error) {
    fail(`Could not list the Blob store: ${describe(error)}`);
  }

  const todo = files.filter((f) => remote.get(blobPathname(f.name)) !== f.size);
  const replacing = todo.filter((f) => remote.has(blobPathname(f.name))).length;
  const skipped = files.length - todo.length;
  const todoBytes = todo.reduce((sum, f) => sum + f.size, 0);
  console.log(
    `Store: ${remote.size} objects under media/. ` +
      `${skipped} already uploaded, ${todo.length} to upload (${formatBytes(todoBytes)})` +
      (replacing ? `, of which ${replacing} differ in size and will be replaced.` : "."),
  );

  if (args.dryRun) {
    console.log("Dry run: nothing uploaded.");
    return;
  }
  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Ctrl-C finishes the uploads in flight, then prints the summary; a re-run
  // resumes. A second Ctrl-C quits immediately.
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping after in-flight uploads… (Ctrl-C again to quit now)");
  });

  const started = Date.now();
  let uploaded = 0;
  let uploadedBytes = 0;
  let done = 0;
  let fatal: unknown = null;
  const failed: { name: string; reason: string }[] = [];
  let next = 0;

  const progress = () => {
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `[${done}/${todo.length}] uploaded ${uploaded}, failed ${failed.length}` +
        ` — ${formatBytes(uploadedBytes)} at ${formatBytes(uploadedBytes / Math.max(seconds, 0.001))}/s`,
    );
  };

  async function worker() {
    while (!stopping && fatal === null && next < todo.length) {
      const file = todo[next++];
      try {
        const data = await readFile(path.join(MEDIA_DIR, file.name));
        await withRetry(file.name, () =>
          put(blobPathname(file.name), data, {
            access: "private",
            addRandomSuffix: false,
            // Deterministic content-hashed names: overwriting is idempotent,
            // and it's what replaces a size-mismatched object.
            allowOverwrite: true,
            contentType: contentTypeFor(file.name),
            cacheControlMaxAge: ONE_YEAR_SECONDS,
            ...auth,
          }),
        );
        uploaded++;
        uploadedBytes += data.byteLength;
      } catch (error) {
        if (isFatal(error)) fatal = error;
        failed.push({ name: file.name, reason: describe(error) });
      }
      done++;
      if (done % PROGRESS_EVERY === 0) progress();
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, todo.length) }, worker));

  const seconds = (Date.now() - started) / 1000;
  const notAttempted = todo.length - done;
  console.log("");
  console.log(`Done in ${seconds.toFixed(1)}s.`);
  console.log(`  uploaded: ${uploaded} (${formatBytes(uploadedBytes)})`);
  console.log(`  skipped:  ${skipped} (already in the store)`);
  console.log(`  failed:   ${failed.length}`);
  if (notAttempted) console.log(`  not attempted: ${notAttempted} (re-run to continue)`);
  for (const { name, reason } of failed.slice(0, 20)) console.log(`    ${name}: ${reason}`);
  if (failed.length > 20) console.log(`    …and ${failed.length - 20} more`);
  if (fatal !== null) console.error(`Aborted: ${describe(fatal)}`);

  if (failed.length || notAttempted) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`upload-media: ${describe(error)}`);
  process.exit(1);
});
