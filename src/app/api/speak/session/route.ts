import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveProfile } from "@/lib/session";
import { voiceForLanguage } from "@/lib/tts";
import { speakOverrides, speakSupports } from "@/lib/speak/prompt";
import { learnerContext } from "@/lib/learner-context";
import {
  loadSpeakDeck,
  mintConversationToken,
  SpeakInputError,
  SpeakUnavailableError,
  speakCredentials,
} from "@/lib/speak/session";

const body = z
  .object({
    topic: z
      .string()
      .max(200)
      .optional()
      .transform((value) => value?.trim() || undefined),
    /** Weave in this deck's words (subdecks included). */
    deckId: z.string().min(1).max(64).optional(),
    /** Resuming after a pause: what was said so far (trimmed to fit the prompt). */
    history: z
      .array(z.object({ role: z.enum(["user", "agent"]), text: z.string().max(2000) }))
      .max(200)
      .optional(),
  })
  .refine((value) => value.topic || value.deckId, { message: "Pick a topic or a deck" });

/**
 * Everything the browser needs to start a Speak conversation: a WebRTC
 * conversation token for the tutor agent, and the overrides that make it this
 * learner's tutor (prompt, opening line, language, voice).
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { topic?, deckId? } with at least one" }, { status: 400 });
  }

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json({ error: "Create a language profile first" }, { status: 400 });
  }

  if (!speakSupports(profile)) {
    return NextResponse.json(
      { error: "Speak works in English, Swedish and Portuguese for now." },
      { status: 400 },
    );
  }

  let credentials;
  try {
    credentials = speakCredentials();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }

  let deck;
  if (parsed.data.deckId) {
    try {
      deck = await loadSpeakDeck({ id: profile.id, userId: user.id }, parsed.data.deckId);
    } catch (error) {
      if (error instanceof SpeakInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }
  const topic = parsed.data.topic ?? deck?.label ?? "";

  let minted;
  try {
    minted = await mintConversationToken(credentials);
  } catch (error) {
    // A refusal (bad key, deleted agent) or the network: either way, a 502.
    console.error("[speak]", error instanceof SpeakUnavailableError ? error.message : error);
    return NextResponse.json({ error: "Couldn't reach the voice service. Try again in a moment." }, { status: 502 });
  }

  return NextResponse.json({
    conversationToken: minted.token,
    conversationId: minted.conversationId,
    topic,
    deckId: deck?.id ?? null,
    overrides: speakOverrides({
      learner: profile,
      topic,
      deck,
      history: parsed.data.history,
      about: learnerContext(profile),
      voiceId: voiceForLanguage(profile.targetLanguage, profile.voiceId),
    }),
  });
}
