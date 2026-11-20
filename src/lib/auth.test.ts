import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountForPassword,
  DEFAULT_EMAIL,
  gateState,
  isValidSession,
  safeNext,
  sessionEmail,
  sessionToken,
} from "./auth";

// Everything auth.ts reads from the environment, put back after each test.
const ENV_KEYS = ["LARA_ACCOUNTS", "LARA_PASSWORD", "LARA_USER_EMAIL", "VERCEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const YOU = { email: "you@lara.local", password: "first-password" };
const EBBA = { email: "ebba@lara.local", password: "second-password" };

function lockWith(...accounts: { email: string; password: string }[]) {
  process.env.LARA_ACCOUNTS = JSON.stringify(Object.fromEntries(accounts.map((a) => [a.email, a.password])));
}

describe("safeNext", () => {
  it("keeps same-origin paths, query strings included", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/decks/abc")).toBe("/decks/abc");
    expect(safeNext("/study?deck=abc&mode=all")).toBe("/study?deck=abc&mode=all");
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["absolute URL", "https://evil.com"],
    ["backslash trick", "/\\evil.com"],
    ["relative path", "decks"],
    ["empty", ""],
  ])("sends a %s target home", (_, next) => {
    expect(safeNext(next)).toBe("/");
  });

  it.each([undefined, null, 42, ["/decks"], { next: "/decks" }])("sends a non-string (%j) home", (next) => {
    expect(safeNext(next)).toBe("/");
  });
});

describe("gateState", () => {
  it("is open locally when nothing is configured", () => {
    expect(gateState()).toEqual({ mode: "open" });
  });

  it("fails closed on Vercel when nothing is configured", () => {
    process.env.VERCEL = "1";
    expect(gateState()).toEqual({ mode: "misconfigured" });
  });

  it("parses LARA_ACCOUNTS, lower-casing emails and skipping empty passwords", () => {
    process.env.LARA_ACCOUNTS = JSON.stringify({
      "You@Lara.local": "first-password",
      "ebba@lara.local": "second-password",
      "nobody@lara.local": "",
      "broken@lara.local": 7,
    });
    expect(gateState()).toEqual({ mode: "locked", accounts: [YOU, EBBA] });
  });

  it("treats unparseable LARA_ACCOUNTS as unconfigured, so Vercel fails closed", () => {
    process.env.LARA_ACCOUNTS = "{not json";
    process.env.LARA_PASSWORD = "ignored-when-accounts-is-set";
    expect(gateState()).toEqual({ mode: "open" });
    process.env.VERCEL = "1";
    expect(gateState()).toEqual({ mode: "misconfigured" });
  });

  it("falls back to a single LARA_PASSWORD for LARA_USER_EMAIL, default you@lara.local", () => {
    process.env.LARA_PASSWORD = "only-password";
    expect(gateState()).toEqual({ mode: "locked", accounts: [{ email: DEFAULT_EMAIL, password: "only-password" }] });
    process.env.LARA_USER_EMAIL = "Me@Lara.local";
    expect(gateState()).toEqual({ mode: "locked", accounts: [{ email: "me@lara.local", password: "only-password" }] });
  });
});

describe("session cookies", () => {
  beforeEach(() => lockWith(YOU, EBBA));

  it("round-trips each account's token to its own email", async () => {
    expect(await sessionEmail(await sessionToken(YOU))).toBe(YOU.email);
    expect(await sessionEmail(await sessionToken(EBBA))).toBe(EBBA.email);
    expect(await isValidSession(await sessionToken(EBBA))).toBe(true);
  });

  it("rejects a missing, malformed or tampered cookie", async () => {
    const token = await sessionToken(EBBA);
    const [id, signature] = token.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
    const youId = btoa(YOU.email).replace(/=+$/, "");

    for (const cookie of [
      undefined,
      "",
      "garbage",
      id, // no signature
      `${id}.${flipped}`, // signature altered
      `${youId}.${signature}`, // someone else's email on this signature
      `${btoa("stranger@lara.local").replace(/=+$/, "")}.${signature}`, // no such account
      await sessionToken({ ...EBBA, password: "old-password" }), // signed with an old password
    ]) {
      expect(await sessionEmail(cookie), String(cookie)).toBeNull();
      expect(await isValidSession(cookie)).toBe(false);
    }
  });

  it("lets nobody in on a misconfigured Vercel deployment", async () => {
    const token = await sessionToken(YOU);
    delete process.env.LARA_ACCOUNTS;
    process.env.VERCEL = "1";
    expect(await sessionEmail(token)).toBeNull();
  });

  it("treats every request as the default account when the gate is open", async () => {
    delete process.env.LARA_ACCOUNTS;
    expect(await sessionEmail(undefined)).toBe(DEFAULT_EMAIL);
    process.env.LARA_USER_EMAIL = "local@lara.local";
    expect(await sessionEmail(undefined)).toBe("local@lara.local");
  });
});

describe("accountForPassword", () => {
  it("maps each password to its own account", async () => {
    lockWith(YOU, EBBA);
    expect(await accountForPassword("first-password")).toEqual(YOU);
    expect(await accountForPassword("second-password")).toEqual(EBBA);
    expect(await accountForPassword("wrong")).toBeNull();
  });

  it("refuses an empty password instead of throwing", async () => {
    // A form posted without a password; Web Crypto rejects a zero-length HMAC key.
    lockWith(YOU, EBBA);
    expect(await accountForPassword("")).toBeNull();
  });

  it("opens nothing when the gate isn't locked", async () => {
    expect(await accountForPassword("anything")).toBeNull();
    process.env.VERCEL = "1";
    expect(await accountForPassword("anything")).toBeNull();
  });
});
