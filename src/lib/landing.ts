// Pure helpers for the logged-out landing page (/login).

type HeaderReader = { get(name: string): string | null };

/** A bare host with an optional port: no scheme, path, or anything else. */
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/i;
const FALLBACK_ORIGIN = "http://localhost:3000";

function first(value: string | null): string {
  return (value ?? "").split(",")[0].trim();
}

/**
 * The origin this request came in on, for absolute Open Graph URLs. The app
 * can be reached on several domains (vercel.app, the custom one), and a shared
 * link should point back at whichever one was shared. Anything that doesn't
 * look like a plain host falls back to localhost rather than echoing it.
 */
export function requestOrigin(headers: HeaderReader): string {
  const host = first(headers.get("x-forwarded-host")) || first(headers.get("host"));
  if (!HOST.test(host)) return FALLBACK_ORIGIN;
  const forwarded = first(headers.get("x-forwarded-proto"));
  const proto =
    forwarded === "http" || forwarded === "https" ? forwarded : LOCAL_HOST.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * Whether the password field grabs focus on load. A visitor arriving at the
 * bare domain is most likely reading about LaraMig, so the page doesn't jump to
 * the form (or raise a phone keyboard). Someone sent here from a page inside
 * the app, or back after a wrong password, is signing in.
 */
export function focusPasswordOnLoad(next: string, error: unknown): boolean {
  return Boolean(error) || next !== "/";
}
