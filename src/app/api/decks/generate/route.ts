import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveProfile } from "@/lib/session";
import { hasAiCredentials } from "@/lib/ai/model";
import { CardJobInputError, queueCardJob, runCardJob } from "@/lib/card-jobs";

const body = z
  .object({
    /** Required for a new deck; adding to a deck it only refines, and may be empty. */
    prompt: z.string().trim().max(500).default(""),
    count: z.number().int().min(1).max(50).default(15),
    /** Add to an existing deck instead of creating one. */
    deckId: z.string().optional(),
    withAudio: z.boolean().default(true),
    /** Which side faces first. Defaults to the deck's own setting. */
    direction: z.enum(["RECOGNITION", "PRODUCTION", "BOTH", "PICTURE"]).optional(),
  })
  .refine((b) => b.deckId || b.prompt.length >= 3, { path: ["prompt"] });

// The model call, the audio and the pictures all run in `after()`, inside this budget.
export const maxDuration = 300;

/**
 * Queues a batch of AI cards and returns at once (202) with the job. The cards
 * are made server-side after the response (src/lib/card-jobs.ts), so the
 * learner can leave the page; the status pill polls /api/card-jobs.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { prompt, count?, deckId?, withAudio?, direction? }; prompt may be empty only with deckId" },
      { status: 400 },
    );
  }

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json({ error: "Create a language profile first" }, { status: 400 });
  }

  // Fail fast rather than queue something that can only fail.
  if (!hasAiCredentials()) {
    return NextResponse.json(
      { error: "Card generation isn't configured (no AI credentials)." },
      { status: 503 },
    );
  }

  const input = { userId: user.id, profile, ...parsed.data };
  let job;
  try {
    job = await queueCardJob(input);
  } catch (error) {
    if (error instanceof CardJobInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  after(() => runCardJob(job.id, input, { started }));

  return NextResponse.json({ id: job.id, deckId: job.deckId, job }, { status: 202 });
}
