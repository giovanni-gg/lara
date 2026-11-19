// The login action through the next/headers and next/navigation stubs: the
// password alone picks the account, the cookie names it, and session.ts
// resolves that cookie to the right user.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signIn } from "@/app/login/actions";
import { AUTH_COOKIE, sessionEmail, sessionToken } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";
import { getCookie, getCookieOptions, setCookie } from "./stubs/next-headers";
import { RedirectError } from "./stubs/next-navigation";

const ACCOUNTS = {
  "you@lara.local": "first-password",
  "ebba@lara.local": "second-password",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe("signIn with several accounts", () => {
  beforeEach(() => {
    process.env.LARA_ACCOUNTS = JSON.stringify(ACCOUNTS);
  });
  afterEach(() => {
    delete process.env.LARA_ACCOUNTS;
  });

  it("signs in as the account whose password was typed", async () => {
    await expect(signIn(form({ password: "second-password", next: "/decks" }))).rejects.toMatchObject({
      name: "RedirectError",
      url: "/decks",
    });
    const cookie = getCookie(AUTH_COOKIE);
    expect(cookie).toBe(
      await sessionToken({ email: "ebba@lara.local", password: "second-password" }),
    );
    expect(getCookieOptions(AUTH_COOKIE)).toMatchObject({ httpOnly: true, path: "/" });
    expect(await sessionEmail(cookie)).toBe("ebba@lara.local");

    // session.ts turns the cookie into that account's own User row.
    const user = await getCurrentUser();
    expect(user.email).toBe("ebba@lara.local");
    expect(user.name).toBe("Ebba");
  });

  it("keeps the accounts apart", async () => {
    await expect(signIn(form({ password: "first-password", next: "/" }))).rejects.toThrow(RedirectError);
    expect((await getCurrentUser()).email).toBe("you@lara.local");
  });

  it("refuses a wrong password without setting a cookie", async () => {
    const attempt = signIn(form({ password: "nope", next: "//evil.example" }));
    await expect(attempt).rejects.toThrow(RedirectError);
    await expect(attempt).rejects.toMatchObject({ url: "/login?error=1&next=%2F" });
    expect(getCookie(AUTH_COOKIE)).toBeUndefined();
  });

  it("rejects a forged or stale cookie", async () => {
    const real = await sessionToken({ email: "ebba@lara.local", password: "second-password" });
    // Someone else's email with this signature, or a signature from an old password.
    const [, signature] = real.split(".");
    const forged = `${btoa("you@lara.local").replace(/=+$/, "")}.${signature}`;
    expect(await sessionEmail(forged)).toBeNull();
    const stale = await sessionToken({ email: "ebba@lara.local", password: "old-password" });
    expect(await sessionEmail(stale)).toBeNull();
    setCookie(AUTH_COOKIE, stale);
    await expect(getCurrentUser()).rejects.toThrow("Not signed in");
  });
});

describe("single LARA_PASSWORD (backwards compatible)", () => {
  beforeEach(() => {
    process.env.LARA_PASSWORD = "only-password";
  });
  afterEach(() => {
    delete process.env.LARA_PASSWORD;
  });

  it("belongs to LARA_USER_EMAIL (the default account)", async () => {
    await expect(signIn(form({ password: "only-password", next: "/" }))).rejects.toThrow(RedirectError);
    expect(await sessionEmail(getCookie(AUTH_COOKIE))).toBe(
      (process.env.LARA_USER_EMAIL ?? "you@lara.local").toLowerCase(),
    );
  });
});
