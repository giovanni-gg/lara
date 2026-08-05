import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveProfile } from "@/lib/session";
import { countWords, generateArticle } from "@/lib/ai/articles";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { ArticleStatus } from "@/generated/prisma/enums";

const body = z.object({
  topic: z.string().min(3).max(300),
  wordCount: z.number().int().min(60).max(600).default(180),
  withAudio: z.boolean().default(true),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { topic, wordCount?, withAudio? }" },
      { status: 400 },
    );
  }
  const { topic, wordCount, withAudio } = parsed.data;

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json(
      { error: "Create a language profile first" },
      { status: 400 },
    );
  }

  // Lean the text on words the learner has already studied.
  const known = await prisma.card.findMany({
    where: { userId: user.id, deck: { profileId: profile.id } },
    select: { target: true },
    orderBy: { reps: "desc" },
    take: 400,
  });

  let result;
  try {
    result = await generateArticle({
      topic,
      targetLanguage: profile.targetLanguage,
      sourceLanguage: profile.sourceLanguage,
      level: profile.level,
      wordCount,
      knownVocabulary: known.map((c) => c.target),
    });
  } catch (error) {
    if (error instanceof MissingAiCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { article, level } = result;
  const bodyText = article.segments.map((s) => s.target).join(" ");

  const shouldSpeak = withAudio && ttsAvailable();
  const audioUrl = shouldSpeak
    ? await trySynthesize({
        text: bodyText,
        language: profile.targetLanguage,
        voiceId: profile.voiceId,
      })
    : null;

  const saved = await prisma.article.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      title: article.title,
      titleTranslated: article.titleTranslated,
      topic,
      level,
      status: ArticleStatus.READY,
      body: bodyText,
      audioUrl,
      wordCount: countWords(bodyText),
      reusedVocabulary: article.reusedVocabulary,
      newVocabulary: article.newVocabulary,
      sourcePrompt: topic,
      segments: {
        create: article.segments.map((segment, index) => ({
          index,
          target: segment.target,
          translation: segment.translation,
        })),
      },
    },
    select: { id: true, title: true, level: true, wordCount: true },
  });

  return NextResponse.json({ article: saved, audio: Boolean(audioUrl) });
}
