// Shared call plumbing: the model id, usage logging, and turning a refusal or
// a cut-off answer into a message a person can act on. Nothing is called.

import { afterEach, describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import { anthropicOptions, loggedCall } from "./call";
import { getModel, MODEL_ID } from "./model";

const usage: LanguageModelUsage = {
  inputTokens: 1200,
  inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 1000, cacheWriteTokens: 0 },
  outputTokens: 300,
  outputTokenDetails: { textTokens: 250, reasoningTokens: 50 },
  totalTokens: 1500,
};

const noObject = (finishReason: "content-filter" | "length" | "stop") =>
  new NoObjectGeneratedError({
    response: { id: "r", timestamp: new Date(0), modelId: MODEL_ID },
    usage,
    finishReason,
  });

const shellKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (shellKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = shellKey;
});

describe("the model", () => {
  it("is Claude Opus 5.5, direct or through the gateway", () => {
    expect(MODEL_ID).toBe("claude-opus-5-5");
    delete process.env.ANTHROPIC_API_KEY;
    expect(getModel()).toBe("anthropic/claude-opus-5-5");
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    expect((getModel() as { modelId: string }).modelId).toBe("claude-opus-5-5");
  });

  it("gets native structured output and, only when asked, an effort", () => {
    expect(anthropicOptions()).toEqual({ anthropic: { structuredOutputMode: "outputFormat" } });
    expect(anthropicOptions("low")).toEqual({ anthropic: { structuredOutputMode: "outputFormat", effort: "low" } });
  });
});

describe("loggedCall", () => {
  it("logs one line with the token usage, cache included", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = { object: 1, usage, finishReason: "stop", response: { modelId: MODEL_ID } };
    await expect(loggedCall("cards", async () => result)).resolves.toBe(result);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toMatch(/^\[ai\] cards model=claude-opus-5-5 finish=stop \d+ms/);
    expect(line).toContain("in=1200 cacheRead=1000 cacheWrite=0 out=300 reasoning=50");
  });

  it.each([
    ["content-filter", "declined"],
    ["length", "cut off"],
    ["stop", "malformed"],
  ] as const)("turns a %s failure into a clear error, and still logs it", async (reason, message) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      loggedCall("cards", async () => {
        throw noObject(reason);
      }),
    ).rejects.toThrow(message);
    expect(String(info.mock.calls[0][0])).toContain(`finish=${reason}`);
  });

  it("passes other errors through untouched", async () => {
    const boom = new Error("rate limited");
    await expect(
      loggedCall("cards", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
