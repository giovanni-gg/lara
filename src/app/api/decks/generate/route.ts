import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveProfile } from "@/lib/session";
import { generateCards } from "@/lib/ai/cards";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { newCardState } from "@/lib/srs";
import { trySynthesize, ttsAvailable } from "@/lib/tts";

const body = z.object({
  prompt: z.string().min(3).max(500),
  count: z.number().int().min(1).max(50).default(15),
  /** Add to an existing deck instead of creating one. */
  deckId: z.string().optional(),
  withAudio: z.boolean().default(true),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { prompt, count?, deckId?, withAudio? }" },
      { status: 400 },
    );
  }
  const { prompt, count, deckId, withAudio } = parsed.data;

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json(
      { error: "Create a language profile first" },
      { status: 400 },
    );
  }

  // Everything the learner already has, so the model doesn't repeat itself.
  const existing = await prisma.card.findMany({
    where: { userId: user.id, deck: { profileId: profile.id } },
    select: { target: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  let batch;
  try {
    batch = await generateCards({
      prompt,
      targetLanguage: profile.targetLanguage,
      sourceLanguage: profile.sourceLanguage,
      level: profile.level,
      count,
      existingTargets: existing.map((c) => c.target),
    });
  } catch (error) {
    if (error instanceof MissingAiCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const deck = deckId
    ? await prisma.deck.findFirst({
        where: { id: deckId, userId: user.id, profileId: profile.id },
      })
    : await prisma.deck.create({
        data: {
          userId: user.id,
          profileId: profile.id,
          name: batch.deckName,
          emoji: batch.emoji,
          description: prompt,
          sourcePrompt: prompt,
        },
      });

  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  // Skip anything that slipped through as a duplicate of an existing card.
  const seen = new Set(existing.map((c) => c.target.toLowerCase()));
  const fresh = batch.cards.filter((c) => !seen.has(c.target.toLowerCase()));

  const shouldSpeak = withAudio && ttsAvailable();

  const created = await Promise.all(
    fresh.map(async (card) => {
      const [audioUrl, sentenceAudioUrl] = shouldSpeak
        ? await Promise.all([
            trySynthesize({
              text: card.target,
              language: profile.targetLanguage,
              voiceId: profile.voiceId,
            }),
            card.targetSentence
              ? trySynthesize({
                  text: card.targetSentence,
                  language: profile.targetLanguage,
                  voiceId: profile.voiceId,
                })
              : Promise.resolve(null),
          ])
        : [null, null];

      return prisma.card.create({
        data: {
          userId: user.id,
          deckId: deck.id,
          target: card.target,
          source: card.source,
          targetSentence: card.targetSentence || null,
          sourceSentence: card.sourceSentence || null,
          notes: card.notes || null,
          tags: card.tags,
          audioUrl,
          sentenceAudioUrl,
          ...newCardState(),
        },
        select: { id: true, target: true, source: true },
      });
    }),
  );

  return NextResponse.json({
    deck: { id: deck.id, name: deck.name, emoji: deck.emoji },
    created: created.length,
    skipped: batch.cards.length - fresh.length,
    audio: shouldSpeak,
    cards: created,
  });
}
