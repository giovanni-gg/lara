import { describe, expect, it } from "vitest";
import { focusPasswordOnLoad, requestOrigin } from "./landing";

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("requestOrigin", () => {
  it("uses the forwarded host and protocol behind a proxy", () => {
    expect(
      requestOrigin(headers({ host: "internal:8080", "x-forwarded-host": "lara.example.com", "x-forwarded-proto": "https" })),
    ).toBe("https://lara.example.com");
  });

  it("takes the first value of a forwarded list", () => {
    expect(
      requestOrigin(headers({ "x-forwarded-host": "lara.example.com, proxy.local", "x-forwarded-proto": "https, http" })),
    ).toBe("https://lara.example.com");
  });

  it("assumes https for a public host and http for a local one", () => {
    expect(requestOrigin(headers({ host: "lara.example.com" }))).toBe("https://lara.example.com");
    expect(requestOrigin(headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(requestOrigin(headers({ host: "192.168.1.20:3000" }))).toBe("http://192.168.1.20:3000");
  });

  it("ignores an unknown protocol", () => {
    expect(requestOrigin(headers({ host: "lara.example.com", "x-forwarded-proto": "javascript" }))).toBe(
      "https://lara.example.com",
    );
  });

  it("falls back to localhost for a missing or malformed host", () => {
    expect(requestOrigin(headers({}))).toBe("http://localhost:3000");
    expect(requestOrigin(headers({ host: "evil.example/path?x=1" }))).toBe("http://localhost:3000");
    expect(requestOrigin(headers({ host: "a b" }))).toBe("http://localhost:3000");
  });
});

describe("focusPasswordOnLoad", () => {
  it("leaves a visitor at the bare domain to read", () => {
    expect(focusPasswordOnLoad("/", undefined)).toBe(false);
  });

  it("focuses for someone sent from inside the app", () => {
    expect(focusPasswordOnLoad("/decks", undefined)).toBe(true);
  });

  it("focuses after a wrong password", () => {
    expect(focusPasswordOnLoad("/", "1")).toBe(true);
  });
});
