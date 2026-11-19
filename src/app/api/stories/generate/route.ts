import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveProfile } from "@/lib/session";
import { STORY_LENGTH_KEYS } from "@/lib/ai/stories";
import { hasAiCredentials } from "@/lib/ai/model";
import { queueStory, StoryInputError, synthesizeStoryAudio, writeStory } from "@/lib/stories";
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

// The writing (≈30–60 s) and the audio run in `after()`, inside this budget.
export const maxDuration = 300;

/**
 * Queues a story and returns at once (202). The story is written server-side
 * after the response, so the learner can leave the page — or queue another —
 * and the library shows it as "Writing…" until it's ready.
 */
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
    return NextResponse.json({ error: "Create a language profile first" }, { status: 400 });
  }

  // Fail fast rather than queue something that can only fail.
  if (!hasAiCredentials()) {
    return NextResponse.json(
      { error: "Story writing isn't configured (no AI credentials)." },
      { status: 503 },
    );
  }

  const input = { userId: user.id, profile, prompt, length, deckId };
  let id: string;
  try {
    id = await queueStory(input);
  } catch (error) {
    if (error instanceof StoryInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const speak = withAudio && ttsAvailable();
  after(async () => {
    const written = await writeStory(id, input);
    // Sentences are spoken in reading order; the reader fills any gap on demand.
    if (written && speak) await synthesizeStoryAudio(id);
  });

  return NextResponse.json({ id, status: "writing" }, { status: 202 });
}
