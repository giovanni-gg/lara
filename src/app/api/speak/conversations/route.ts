import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveProfile } from "@/lib/session";

const text = (max: number) => z.string().trim().min(1).max(max);

const body = z.object({
  /** ElevenLabs' id for the call, from POST /api/speak/session. */
  externalId: z.string().max(128).nullish(),
  topic: text(200),
  deckId: z.string().max(64).nullish(),
  transcript: z
    .array(z.object({ role: z.enum(["user", "agent"]), text: text(4000) }))
    .max(500),
  corrections: z
    .array(z.object({ said: text(500), better: text(500), explanation: z.string().trim().max(500) }))
    .max(100),
});

/**
 * Saves a finished Speak conversation: the transcript and the corrections the
 * tutor showed. A call the learner never spoke in isn't worth a row (204).
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { topic, transcript, corrections }" }, { status: 400 });
  }
  const { externalId, topic, deckId, transcript, corrections } = parsed.data;

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json({ error: "Create a language profile first" }, { status: 400 });
  }

  if (!transcript.some((turn) => turn.role === "user")) {
    return new NextResponse(null, { status: 204 });
  }

  // Only link a deck that is this profile's own.
  const deck = deckId
    ? await prisma.deck.findFirst({ where: { id: deckId, profileId: profile.id }, select: { id: true } })
    : null;

  const { id } = await prisma.speakConversation.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      deckId: deck?.id ?? null,
      topic,
      externalId: externalId ?? null,
      transcript,
      corrections,
    },
    select: { id: true },
  });
  return NextResponse.json({ id }, { status: 201 });
}
