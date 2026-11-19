import { getLanguage } from "./languages";
import { exists, mediaKey, publicUrl, store } from "./media";

/**
 * Text-to-speech via ElevenLabs, carried over from the anki_creator script
 * (same voice IDs, same slightly-slowed rate that makes speech easier to parse
 * while learning). Called over plain fetch — no SDK needed for one endpoint.
 */

const SPEECH_RATE = 0.9; // 0.7-0.9 reads clearly for a learner
const STABILITY = 0.5;
const SIMILARITY_BOOST = 0.75;
const OUTPUT_FORMAT = "mp3_44100_128";

export class TtsUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TtsUnavailableError";
  }
}

export function ttsAvailable(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export function voiceForLanguage(language: string, override?: string | null) {
  return override ?? getLanguage(language).voiceId ?? null;
}

export type SynthesizeInput = {
  text: string;
  language: string;
  /** Overrides the language's default voice, e.g. from a LanguageProfile. */
  voiceId?: string | null;
};

/**
 * Returns a URL for spoken `text`. Cached by content hash, so re-synthesising
 * the same phrase never costs a second API call.
 */
export async function synthesize({
  text,
  language,
  voiceId,
}: SynthesizeInput): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) throw new TtsUnavailableError("Nothing to synthesize");

  const key = mediaKey("tts", language, trimmed);
  if (await exists(key)) return publicUrl(key);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TtsUnavailableError(
      "ELEVENLABS_API_KEY is not set — add it to .env to generate audio",
    );
  }

  const voice = voiceForLanguage(language, voiceId);
  if (!voice) {
    throw new TtsUnavailableError(
      `No ElevenLabs voice configured for "${language}". Add one in src/lib/languages.ts or on the language profile.`,
    );
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: trimmed,
        model_id: process.env.ELEVENLABS_MODEL_ID ?? "eleven_v4_turbo",
        voice_settings: {
          stability: STABILITY,
          similarity_boost: SIMILARITY_BOOST,
          speed: SPEECH_RATE,
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TtsUnavailableError(
      `ElevenLabs returned ${response.status}: ${detail.slice(0, 200)}`,
    );
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  return store(key, audio);
}

/** Best-effort synthesis: returns null instead of throwing, for bulk jobs. */
export async function trySynthesize(
  input: SynthesizeInput,
): Promise<string | null> {
  try {
    return await synthesize(input);
  } catch {
    return null;
  }
}
