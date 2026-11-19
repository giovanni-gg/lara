// The password gate. One shared password, no accounts: this decides whether a
// request gets in at all, not who it is (that's `session.ts`). Pure Web Crypto
// so it runs unchanged in `proxy.ts` and in server actions.

export const AUTH_COOKIE = "lara_session";

/** 400 days — the most a browser will honour, so the phone stays signed in. */
export const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export type GateState =
  | { mode: "open" } // no password and not on Vercel: local dev, gate off
  | { mode: "misconfigured" } // no password on Vercel: fail closed
  | { mode: "locked"; password: string };

export function gateState(): GateState {
  const password = process.env.LARA_PASSWORD;
  if (password) return { mode: "locked", password };
  return process.env.VERCEL ? { mode: "misconfigured" } : { mode: "open" };
}

/**
 * The cookie value: HMAC-SHA256 of a fixed label, keyed by the password. Not
 * the password itself, and changing the password invalidates every device.
 */
export async function sessionToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("lara-session-v1"),
  );
  return Array.from(new Uint8Array(mac), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether a cookie value unlocks the gate. True when the gate is off. */
export async function isValidSession(
  cookieValue: string | undefined,
): Promise<boolean> {
  const gate = gateState();
  if (gate.mode === "open") return true;
  if (gate.mode === "misconfigured" || !cookieValue) return false;
  return constantTimeEqual(cookieValue, await sessionToken(gate.password));
}

/**
 * Checks a typed password. Compares the derived tokens rather than the raw
 * strings, so the comparison is fixed-length and leaks nothing about length.
 */
export async function checkPassword(attempt: string): Promise<boolean> {
  const gate = gateState();
  if (gate.mode !== "locked") return gate.mode === "open";
  const [given, expected] = await Promise.all([
    sessionToken(attempt),
    sessionToken(gate.password),
  ]);
  return constantTimeEqual(given, expected);
}

/** Only same-origin relative paths; anything else (`//evil`, `https:`) → "/". */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
