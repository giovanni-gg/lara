import { NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";

/**
 * What every model call shares: provider options, the prompt-cache marker,
 * and one log line with the token usage (so cost shows in the Vercel logs).
 *
 * Claude Opus 5.5 always thinks; how much is set by `effort` (default
 * "medium"). It rejects temperature/top_p/top_k, a thinking budget, a forced
 * tool choice and assistant prefill, so none of those are ever sent.
 */

export type Effort = NonNullable<AnthropicLanguageModelOptions["effort"]>;

/** Calls retried on 429/5xx before giving up (the AI SDK backs off between tries). */
export const MAX_RETRIES = 2;

/**
 * Provider options for a call. Structured output always goes through the
 * API's native JSON schema (`output_config.format`): the fallback, a forced
 * "json" tool call, is rejected by Opus 5.5.
 */
export function anthropicOptions(effort?: Effort) {
  const anthropic = {
    structuredOutputMode: "outputFormat",
    ...(effort ? { effort } : {}),
  } satisfies AnthropicLanguageModelOptions;
  return { anthropic };
}

/**
 * Marks the end of a prompt prefix for Anthropic's prompt cache (5 minutes).
 * Put it on the last part that stays the same between calls; anything after
 * it may change freely. Prefixes under the model's minimum aren't cached.
 */
export const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

type CallOutcome = {
  usage?: LanguageModelUsage;
  finishReason?: string;
  response?: { modelId?: string };
};

export function logUsage(task: string, outcome: CallOutcome, ms: number): void {
  const u = outcome.usage;
  console.info(
    `[ai] ${task} model=${outcome.response?.modelId ?? "?"} finish=${outcome.finishReason ?? "?"} ${ms}ms` +
      ` in=${u?.inputTokens ?? "?"} cacheRead=${u?.inputTokenDetails?.cacheReadTokens ?? 0}` +
      ` cacheWrite=${u?.inputTokenDetails?.cacheWriteTokens ?? 0}` +
      ` out=${u?.outputTokens ?? "?"} reasoning=${u?.outputTokenDetails?.reasoningTokens ?? "?"}`,
  );
}

/**
 * Runs one structured call and logs its usage. A refusal, a truncated answer
 * or one that doesn't fit the schema becomes an error a person can act on
 * (the routes show the message as is).
 */
export async function loggedCall<R extends CallOutcome>(task: string, call: () => Promise<R>): Promise<R> {
  const started = Date.now();
  try {
    const result = await call();
    logUsage(task, result, Date.now() - started);
    return result;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      logUsage(task, error, Date.now() - started);
      if (error.finishReason === "content-filter") {
        throw new Error("The model declined this request. Try rewording it.", { cause: error });
      }
      if (error.finishReason === "length") {
        throw new Error("The answer was cut off before it finished. Try asking for fewer.", { cause: error });
      }
      throw new Error("The model's answer came back malformed. Try again.", { cause: error });
    }
    throw error;
  }
}
