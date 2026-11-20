import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Resolves which model the generation routes talk to.
 *
 * With ANTHROPIC_API_KEY set we call Anthropic directly. Otherwise we hand the
 * AI SDK a plain "provider/model" string, which routes through the Vercel AI
 * Gateway — the path that needs no per-provider wiring once deployed.
 */
// Opus 5.5: always thinks (depth set per call with `effort`, see ./call.ts)
// and rejects sampling parameters, thinking budgets and forced tool choice.
export const MODEL_ID = "claude-opus-5-5";

export function getModel(): LanguageModel {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return createAnthropic({ apiKey })(MODEL_ID);
  }
  return `anthropic/${MODEL_ID}`;
}

export function hasAiCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY);
}

export class MissingAiCredentialsError extends Error {
  constructor() {
    super(
      "No AI credentials configured. Set ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY) in .env",
    );
    this.name = "MissingAiCredentialsError";
  }
}

export function assertAiCredentials(): void {
  if (!hasAiCredentials()) throw new MissingAiCredentialsError();
}
