import { describe, expect, it, vi } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
process.env.DATABASE_URL ??= "postgres://localhost/test";

const { explicitSslMode } = await import("./db");

describe("explicitSslMode", () => {
  it("spells out verify-full for Neon's sslmode=require", () => {
    expect(explicitSslMode("postgres://u:p@h/db?sslmode=require&channel_binding=require")).toBe(
      "postgres://u:p@h/db?sslmode=verify-full&channel_binding=require",
    );
    expect(explicitSslMode("postgres://u:p@h/db?x=1&sslmode=require")).toBe("postgres://u:p@h/db?x=1&sslmode=verify-full");
  });

  it("leaves local URLs and other modes alone", () => {
    expect(explicitSslMode("postgres://localhost:51214/template1?sslmode=disable")).toBe(
      "postgres://localhost:51214/template1?sslmode=disable",
    );
    expect(explicitSslMode("postgres://localhost/db")).toBe("postgres://localhost/db");
  });
});
