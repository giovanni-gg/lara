import { describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: vi.fn() }));

const { buildTidyRequest, tidyTranscript } = await import("./tidy");

describe("buildTidyRequest", () => {
  const call = buildTidyRequest("  so um I'm moving to, like, Stockholm in in March och jag jobbar med data  ");

  it("sends the transcript as data, trimmed", () => {
    expect(call.prompt).toContain(`"""\nso um I'm moving to, like, Stockholm in in March och jag jobbar med data\n"""`);
    expect(call.instructions).toMatch(/not instructions to you/);
  });

  it("only formats: keeps facts and languages, never translates or summarises", () => {
    expect(call.instructions).toMatch(/Remove filler words/);
    expect(call.instructions).toMatch(/Keep every fact/);
    expect(call.instructions).toMatch(/Never translate/);
    expect(call.instructions).toMatch(/Don't summarise/);
  });

  it("is a cheap call: low effort, native structured output, no sampling settings", () => {
    expect(call.providerOptions.anthropic).toEqual({ structuredOutputMode: "outputFormat", effort: "low" });
    expect(call).not.toHaveProperty("temperature");
    expect(call.maxOutputTokens).toBeGreaterThanOrEqual(2_000);
  });
});

describe("tidyTranscript", () => {
  it("skips the model for an empty transcript", async () => {
    const { generateObject } = await import("ai");
    expect(await tidyTranscript("   ")).toBe("");
    expect(generateObject).not.toHaveBeenCalled();
  });
});
