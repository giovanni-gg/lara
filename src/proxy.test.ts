import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";
import { config, proxy } from "./proxy";

// The gate as Next runs it: which paths the matcher sends through proxy() at
// all, and what proxy() answers. auth.test.ts covers the cookie and password
// logic underneath; tests/integration/login.test.ts the sign-in action.

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

const ACCOUNT = { email: "you@lara.local", password: "first-password" };

function request(path: string, cookie?: string) {
  const req = new NextRequest(new URL(path, "https://lara.test"));
  if (cookie) req.cookies.set(AUTH_COOKIE, cookie);
  return req;
}

/** NextResponse.next() marks the response with this header. */
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each(["/", "/decks/abc", "/api/stories/generate", "/api/media/banana.png", "/login"])(
    "runs the gate on %s",
    (url) => expect(matches(url)).toBe(true),
  );

  it.each(["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/manifest.webmanifest", "/icon.png", "/logo.svg"])(
    "skips %s",
    (url) => expect(matches(url)).toBe(false),
  );
});

describe("proxy", () => {
  it("lets everything through with the gate off", async () => {
    expect(passesThrough(await proxy(request("/decks")))).toBe(true);
  });

  it("answers 503 on a misconfigured Vercel deployment, except on public paths", async () => {
    process.env.VERCEL = "1";
    expect((await proxy(request("/decks"))).status).toBe(503);
    expect((await proxy(request("/api/cards"))).status).toBe(503);
    expect(passesThrough(await proxy(request("/login")))).toBe(true);
    expect(passesThrough(await proxy(request("/api/health")))).toBe(true);
  });

  describe("with the gate locked", () => {
    beforeEach(() => {
      process.env.LARA_ACCOUNTS = JSON.stringify({ [ACCOUNT.email]: ACCOUNT.password });
    });

    it("sends a page visit to /login, remembering where it was going", async () => {
      const res = await proxy(request("/study?deck=abc"));
      expect(getRedirectUrl(res)).toBe("https://lara.test/login?next=%2Fstudy%3Fdeck%3Dabc");
    });

    it("answers 401 to an API call instead of redirecting", async () => {
      const res = await proxy(request("/api/stories/generate"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("lets a valid cookie through and turns a forged one away", async () => {
      expect(passesThrough(await proxy(request("/decks", await sessionToken(ACCOUNT))))).toBe(true);
      const forged = await sessionToken({ ...ACCOUNT, password: "guess" });
      expect(getRedirectUrl(await proxy(request("/decks", forged)))).toMatch(/\/login\?next=/);
    });

    it("keeps /login and /api/health public", async () => {
      expect(passesThrough(await proxy(request("/login")))).toBe(true);
      expect(passesThrough(await proxy(request("/api/health")))).toBe(true);
    });
  });
});
