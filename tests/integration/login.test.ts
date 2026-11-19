// Proves the next/headers and next/navigation stubs carry a real server action:
// the login action sets its cookie through cookies() and leaves via redirect().

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signIn } from "@/app/login/actions";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";
import { getCookie, getCookieOptions } from "./stubs/next-headers";
import { RedirectError } from "./stubs/next-navigation";

const PASSWORD = "integration-password";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe("signIn", () => {
  beforeEach(() => {
    process.env.LARA_PASSWORD = PASSWORD;
  });
  afterEach(() => {
    delete process.env.LARA_PASSWORD;
  });

  it("sets the session cookie and redirects to `next`", async () => {
    await expect(signIn(form({ password: PASSWORD, next: "/decks" }))).rejects.toMatchObject({
      name: "RedirectError",
      url: "/decks",
    });
    expect(getCookie(AUTH_COOKIE)).toBe(await sessionToken(PASSWORD));
    expect(getCookieOptions(AUTH_COOKIE)).toMatchObject({ httpOnly: true, path: "/" });
  });

  it("refuses a wrong password without setting a cookie", async () => {
    const attempt = signIn(form({ password: "nope", next: "//evil.example" }));
    await expect(attempt).rejects.toThrow(RedirectError);
    await expect(attempt).rejects.toMatchObject({ url: "/login?error=1&next=%2F" });
    expect(getCookie(AUTH_COOKIE)).toBeUndefined();
  });
});
