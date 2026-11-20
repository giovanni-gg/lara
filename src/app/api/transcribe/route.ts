import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { transcriptionsLeftToday } from "@/lib/allowance";
import { transcriptionLimitMessage } from "@/lib/limits";
import { isAudioType, MAX_AUDIO_BYTES, sttAvailable, transcribe } from "@/lib/stt";
import { hasAiCredentials } from "@/lib/ai/model";
import { tidyTranscript } from "@/lib/ai/tidy";

// Scribe takes a few seconds for a minute of speech, the tidy-up a few more.
export const maxDuration = 60;

const tooLarge = () =>
  NextResponse.json({ error: "That recording is too long. Keep it under three minutes." }, { status: 413 });

/**
 * "About you" dictation: one recorded clip in (multipart field `audio`), its
 * transcript out ({ text }). The audio is passed straight to ElevenLabs and
 * never stored. Accounts other than the owner's get a daily cap.
 */
export async function POST(request: Request) {
  // Refuse an oversized body before reading it, when the client says its size.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) return tooLarge();

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "Expected an audio recording in the `audio` field" }, { status: 400 });
  }
  if (!isAudioType(audio.type)) {
    return NextResponse.json({ error: "That file isn't an audio recording" }, { status: 415 });
  }
  if (audio.size > MAX_AUDIO_BYTES) return tooLarge();

  if (!sttAvailable()) {
    return NextResponse.json({ error: "Voice input isn't configured. You can still type." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if ((await transcriptionsLeftToday(user)) === 0) {
    return NextResponse.json({ error: transcriptionLimitMessage() }, { status: 429 });
  }
  // Counted before the call: a clip sent costs whether or not it comes back.
  await prisma.transcription.create({ data: { userId: user.id } });

  let raw: string;
  try {
    raw = await transcribe(audio, audio instanceof File && audio.name ? audio.name : "about");
  } catch (error) {
    console.error("[transcribe]", error);
    return NextResponse.json(
      { error: "Couldn't transcribe that. Try again, or type instead." },
      { status: 502 },
    );
  }

  // Loose speech → readable text (fillers out, punctuation in). Formatting
  // only; if the model is unavailable the raw transcript is still useful.
  if (!hasAiCredentials()) return NextResponse.json({ text: raw });
  try {
    return NextResponse.json({ text: (await tidyTranscript(raw)) || raw });
  } catch (error) {
    console.error("[transcribe] tidy failed, returning the raw transcript", error);
    return NextResponse.json({ text: raw });
  }
}
