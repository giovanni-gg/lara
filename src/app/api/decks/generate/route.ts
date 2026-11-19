import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveProfile } from "@/lib/session";
import { generateCards } from "@/lib/ai/cards";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { newCardState } from "@/lib/srs";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { cardTypesFor } from "@/lib/card-direction";

const body = z.object({
  prompt: z.string().min(3).max(500),
  count: z.number().int().min(1).max(50).default(15),
  /** Add to an existing deck instead of creating one. */
  deckId: z.string().optional(),
  withAudio: z.boolean().default(true),
  /** Which side faces first. Defaults to the deck's own setting. */
  direction: z.enum(["RECOGNITION", "PRODUCTION", "BOTH"]).optional(),
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
  const { prompt, count, deckId, withAudio, direction: requested } = parsed.data;

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
          direction: requested ?? "RECOGNITION",
        },
      });

  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  // Skip anything that slipped through as a duplicate of an existing card.
  const seen = new Set(existing.map((c) => c.target.toLowerCase()));
  const fresh = batch.cards.filter((c) => !seen.has(c.target.toLowerCase()));

  const shouldSpeak = withAudio && ttsAvailable();
  const cardTypes = cardTypesFor(requested ?? deck.direction);

  // Sequential on purpose. Fanning these out hammers the ElevenLabs rate limit
  // (the original Python script capped itself at 4 workers for the same
  // reason), and the local `prisma dev` Postgres rejects parallel bursts.
  const created: { id: string; target: string; source: string }[] = [];

  for (const card of fresh) {
    let audioUrl: string | null = null;
    let sentenceAudioUrl: string | null = null;

    if (shouldSpeak) {
      audioUrl = await trySynthesize({
        text: card.target,
        language: profile.targetLanguage,
        voiceId: profile.voiceId,
      });
      if (card.targetSentence) {
        sentenceAudioUrl = await trySynthesize({
          text: card.targetSentence,
          language: profile.targetLanguage,
          voiceId: profile.voiceId,
        });
      }
    }

    // "Both" is one card per direction, sharing the same audio.
    for (const cardType of cardTypes) {
      created.push(
        await prisma.card.create({
          data: {
            userId: user.id,
            deckId: deck.id,
            target: card.target,
            source: card.source,
            targetSentence: card.targetSentence || null,
            sourceSentence: card.sourceSentence || null,
            notes: card.notes || null,
            tags: card.tags,
            cardType,
            audioUrl,
            sentenceAudioUrl,
            ...newCardState(),
          },
          select: { id: true, target: true, source: true },
        }),
      );
    }
  }

  return NextResponse.json({
    deck: { id: deck.id, name: deck.name, emoji: deck.emoji },
    created: created.length,
    skipped: batch.cards.length - fresh.length,
    audio: shouldSpeak,
    cards: created,
  });
}
