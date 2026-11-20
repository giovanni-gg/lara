/**
 * Speech-to-text via ElevenLabs Scribe, for dictating "About you". Plain
 * fetch with a multipart body, like tts.ts: one endpoint needs no SDK.
 *
 * No language is sent, so Scribe detects it: the learner may speak their own
 * language, the one they're learning, or a mix.
 */

const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
/** Scribe v3 is ElevenLabs' current batch model; overridable without a deploy. */
const DEFAULT_MODEL = "scribe_v3";

/**
 * The largest clip accepted. Vercel refuses request bodies over 4.5 MB, so
 * this leaves room for the multipart envelope. The recorder caps clips at
 * three minutes at 64 kbps (about 1.5 MB), so a real clip is far below it.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
/** How long one recording may run, in seconds (the recorder stops itself). */
export const MAX_RECORDING_SECONDS = 180;

export class SttUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttUnavailableError";
  }
}

export function sttAvailable(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/**
 * Whether an upload's type is audio. Safari records audio/mp4, Chrome and
 * Firefox audio/webm or audio/ogg (each possibly with a codecs parameter).
 */
export function isAudioType(type: string): boolean {
  return /^audio\/[\w.+-]+(\s*;.*)?$/i.test(type.trim());
}

/** The transcript of a recording, trimmed; "" when nothing was said. */
export async function transcribe(audio: Blob, filename = "about"): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new SttUnavailableError("ELEVENLABS_API_KEY is not set");

  const form = new FormData();
  form.set("model_id", process.env.ELEVENLABS_STT_MODEL_ID || DEFAULT_MODEL);
  form.set("file", audio, filename);
  // "(laughs)" and "(music)" are noise in a profile.
  form.set("tag_audio_events", "false");

  const response = await fetch(STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SttUnavailableError(`ElevenLabs returned ${response.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}
