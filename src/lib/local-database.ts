// The one rule every test suite that writes to a database lives by: loopback
// or nothing. The integration suite starts a throwaway PostgreSQL on this
// machine (tests/embedded-postgres.ts) and asks this before a single query
// (tests/integration/setup.ts), so a stray address (production's sits in
// .env.neon-prod on the same machine) stops the run instead of being written to.
//
// Not used by the app itself. It lives in src/lib so the unit suite proves it
// (local-database.test.ts).

/** The host a postgresql:// address points at, "" when it has none or can't be parsed. */
export function databaseHost(url: string | undefined): string {
  if (!url) return "";
  try {
    // WHATWG URL keeps IPv6 brackets: "[::1]".
    return new URL(url).hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  } catch {
    return "";
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Is this address a database on this machine? Also refuses `?host=` and
 * `?hostaddr=`, which libpq and `pg` honour over the URL's own host — so
 * `postgresql://u@127.0.0.1/db?host=db.example.com` is NOT local.
 */
export function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return false;
  if (parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr")) return false;
  return LOOPBACK.has(databaseHost(url));
}

/** Throws unless `url` is a database on this machine. Never prints the URL itself, only its host. */
export function assertLocalDatabase(url: string | undefined, who: string): asserts url is string {
  if (!isLocalDatabase(url)) {
    const host = databaseHost(url);
    throw new Error(
      `${who} only run against a local database (127.0.0.1 / localhost), ` +
        `not ${host ? `"${host}"` : "this address"}. Nothing was run.`,
    );
  }
}
