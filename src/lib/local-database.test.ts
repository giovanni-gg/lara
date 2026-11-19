import { describe, expect, it } from "vitest";
import { assertLocalDatabase, databaseHost, isLocalDatabase } from "./local-database";

describe("isLocalDatabase", () => {
  it.each([
    "postgresql://u:p@127.0.0.1:5432/db",
    "postgresql://u:p@localhost:5432/db",
    "postgres://u@[::1]:5432/db",
  ])("accepts loopback %s", (url) => {
    expect(isLocalDatabase(url)).toBe(true);
  });

  it.each([
    ["a cloud host", "postgresql://u:p@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require"],
    ["a LAN address", "postgresql://u:p@192.168.1.10:5432/db"],
    ["a ?host= override", "postgresql://u:p@127.0.0.1:5432/db?host=db.example.com"],
    ["a ?hostaddr= override", "postgresql://u:p@localhost/db?hostaddr=10.0.0.1"],
    ["a non-postgres scheme", "mysql://u:p@127.0.0.1/db"],
    ["garbage", "not a url"],
    ["nothing", undefined],
  ])("refuses %s", (_label, url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });
});

describe("databaseHost / assertLocalDatabase", () => {
  it("names the host, never the credentials", () => {
    expect(databaseHost("postgresql://user:secret@Example.COM/db")).toBe("example.com");
    expect(() => assertLocalDatabase("postgresql://user:secret@example.com/db", "Tests")).toThrow(
      /not "example\.com"/,
    );
    expect(() => assertLocalDatabase("postgresql://user:secret@example.com/db", "Tests")).not.toThrow(
      /secret/,
    );
  });
});
