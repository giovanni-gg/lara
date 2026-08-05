import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { synthesize, TtsUnavailableError } from "@/lib/tts";

export const maxDuration = 120;

/**
 * Synthesises one sentence of an article or story, on demand.
 *
 * Long stories don't get a single whole-text clip — it is slow to generate and
 * awkward to listen to. Instead the reader asks for a sentence the first time
 * you tap it, and the URL is cached on the row so the second tap is instant.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;
  const user = await getCurrentUser();

  const segment = await prisma.articleSegment.findFirst({
    where: { id: segmentId, article: { userId: user.id } },
    select: {
      id: true,
      target: true,
      audioUrl: true,
      article: {
        select: {
          profile: { select: { targetLanguage: true, voiceId: true } },
        },
      },
    },
  });

  if (!segment) {
    return NextResponse.json({ error: "Sentence not found" }, { status: 404 });
  }

  if (segment.audioUrl) {
    return NextResponse.json({ audioUrl: segment.audioUrl, cached: true });
  }

  try {
    const audioUrl = await synthesize({
      text: segment.target,
      language: segment.article.profile.targetLanguage,
      voiceId: segment.article.profile.voiceId,
    });

    await prisma.articleSegment.update({
      where: { id: segment.id },
      data: { audioUrl },
    });

    return NextResponse.json({ audioUrl, cached: false });
  } catch (error) {
    if (error instanceof TtsUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
