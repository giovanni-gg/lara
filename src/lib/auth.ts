// The password gate. A few accounts, each with one password and no username:
// the password you type decides whose app you get. This file decides whether
// a request gets in and as whom; `session.ts` turns that into a User row.
// Pure Web Crypto, so it runs unchanged in `proxy.ts` and in server code.
//
// Accounts come from LARA_ACCOUNTS, a JSON object of email → password:
//   LARA_ACCOUNTS={"you@lara.local":"…","ebba@lara.local":"…"}
// For a single account, LARA_PASSWORD alone still works (it belongs to
// LARA_USER_EMAIL, default you@lara.local).

export const AUTH_COOKIE = "lara_session";

/** 400 days — the most a browser will honour, so the phone stays signed in. */
export const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export const DEFAULT_EMAIL = "you@lara.local";

export type Account = { email: string; password: string };

export type GateState =
  | { mode: "open" } // no accounts and not on Vercel: local dev, gate off
  | { mode: "misconfigured" } // no accounts on Vercel: fail closed
  | { mode: "locked"; accounts: Account[] };

function configuredAccounts(): Account[] {
  const raw = process.env.LARA_ACCOUNTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
        .map(([email, password]) => ({ email: email.toLowerCase(), password }));
    } catch {
      return []; // unparseable → treated as unconfigured, which fails closed on Vercel
    }
  }
  const password = process.env.LARA_PASSWORD;
  if (!password) return [];
  return [{ email: (process.env.LARA_USER_EMAIL ?? DEFAULT_EMAIL).toLowerCase(), password }];
}

export function gateState(): GateState {
  const accounts = configuredAccounts();
  if (accounts.length > 0) return { mode: "locked", accounts };
  return process.env.VERCEL ? { mode: "misconfigured" } : { mode: "open" };
}

const encoder = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The cookie value for an account: `<email, base64url>.<HMAC of the email,
 * keyed by its password>`. Not the password, unforgeable without it, and
 * changing an account's password signs that account out everywhere.
 */
export async function sessionToken(account: Account): Promise<string> {
  const id = btoa(account.email).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${id}.${await hmac(account.password, `lara-session-v2:${account.email}`)}`;
}

function decodeEmail(id: string): string | null {
  try {
    return atob(id.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Who a cookie belongs to: the account's email, or null if it opens nothing.
 * With the gate off (local dev) every request is the default account.
 */
export async function sessionEmail(cookieValue: string | undefined): Promise<string | null> {
  const gate = gateState();
  if (gate.mode === "open") return process.env.LARA_USER_EMAIL ?? DEFAULT_EMAIL;
  if (gate.mode === "misconfigured" || !cookieValue) return null;

  const email = decodeEmail(cookieValue.split(".")[0] ?? "");
  const account = gate.accounts.find((a) => a.email === email);
  if (!account) return null;
  return constantTimeEqual(cookieValue, await sessionToken(account)) ? account.email : null;
}

/** Whether a cookie gets through the gate at all. */
export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  return (await sessionEmail(cookieValue)) !== null;
}

/**
 * Which account a typed password opens, if any. Compares derived HMACs rather
 * than raw strings, so each comparison is fixed-length and leaks no length.
 */
export async function accountForPassword(attempt: string): Promise<Account | null> {
  const gate = gateState();
  if (gate.mode !== "locked") return null;
  let match: Account | null = null;
  for (const account of gate.accounts) {
    const [given, expected] = await Promise.all([
      hmac(attempt, "lara-password-check"),
      hmac(account.password, "lara-password-check"),
    ]);
    if (constantTimeEqual(given, expected)) match = account;
  }
  return match;
}

/** Only same-origin relative paths; anything else (`//evil`, `https:`) → "/". */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
