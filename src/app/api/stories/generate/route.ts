import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveProfile } from "@/lib/session";
import { STORY_LENGTH_KEYS, STORY_LENGTHS } from "@/lib/ai/stories";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { createStory, StoryInputError, synthesizeStoryAudio } from "@/lib/stories";
import { ttsAvailable } from "@/lib/tts";

const body = z.object({
  /** Optional: without one, the model picks a premise (around the deck's words, if any). */
  prompt: z
    .string()
    .max(500)
    .optional()
    .transform((value) => value?.trim() || undefined),
  length: z.enum(STORY_LENGTH_KEYS).default("medium"),
  /** Build the story around this deck and its subdecks; omit for all cards. */
  deckId: z.string().min(1).max(64).optional(),
  withAudio: z.boolean().default(true),
});

/** Sentences spoken before responding, so pressing play in the reader is instant. */
const LEAD_SENTENCES = 3;

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { prompt?, length?, deckId?, withAudio? }" },
      { status: 400 },
    );
  }
  const { prompt, length, deckId, withAudio } = parsed.data;

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json(
      { error: "Create a language profile first" },
      { status: 400 },
    );
  }

  let story;
  try {
    story = await createStory({ userId: user.id, profile, prompt, length, deckId });
  } catch (error) {
    if (error instanceof StoryInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof MissingAiCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const speak = withAudio && ttsAvailable();
  if (speak) {
    await synthesizeStoryAudio(story.id, { limit: LEAD_SENTENCES });
    // The rest is spoken after the response, in reading order — far faster
    // than anyone listens, and the reader fills any gap on demand.
    after(() => synthesizeStoryAudio(story.id));
  }

  return NextResponse.json({
    story,
    audio: speak,
    requestedWords: STORY_LENGTHS[length].words,
  });
}
