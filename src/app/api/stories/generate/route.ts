import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireActiveProfile } from "@/lib/session";
import { countWords } from "@/lib/ai/articles";
import { generateStory, STORY_LENGTHS } from "@/lib/ai/stories";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { ArticleStatus, ContentKind } from "@/generated/prisma/enums";

const body = z.object({
  prompt: z.string().min(3).max(500),
  length: z.enum(["short", "medium", "long", "epic"]).default("medium"),
  withAudio: z.boolean().default(true),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { prompt, length?, withAudio? }" },
      { status: 400 },
    );
  }
  const { prompt, length, withAudio } = parsed.data;

  let user, profile;
  try {
    ({ user, profile } = await requireActiveProfile());
  } catch {
    return NextResponse.json(
      { error: "Create a language profile first" },
      { status: 400 },
    );
  }

  // Lean the story on words the learner has actually studied.
  const known = await prisma.card.findMany({
    where: { userId: user.id, deck: { profileId: profile.id } },
    select: { target: true },
    orderBy: { reps: "desc" },
    take: 400,
  });

  let result;
  try {
    result = await generateStory({
      prompt,
      targetLanguage: profile.targetLanguage,
      sourceLanguage: profile.sourceLanguage,
      level: profile.level,
      length,
      knownVocabulary: known.map((c) => c.target),
    });
  } catch (error) {
    if (error instanceof MissingAiCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { story, level } = result;
  const bodyText = story.segments.map((s) => s.target).join(" ");
  const wordCount = countWords(bodyText);

  // Long stories are synthesised per sentence on demand in the reader rather
  // than as one file — a 2,000-word single clip is slow to make and unwieldy to
  // listen to. Short ones get a whole-story clip up front.
  const wantsWholeClip = withAudio && ttsAvailable() && length === "short";
  const audioUrl = wantsWholeClip
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
      kind: ContentKind.STORY,
      title: story.title,
      titleTranslated: story.titleTranslated,
      topic: prompt,
      level,
      status: ArticleStatus.READY,
      body: bodyText,
      audioUrl,
      wordCount,
      reusedVocabulary: story.reusedVocabulary,
      newVocabulary: story.newVocabulary,
      sourcePrompt: prompt,
      segments: {
        create: story.segments.map((segment, index) => ({
          index,
          target: segment.target,
          translation: segment.translation,
        })),
      },
    },
    select: { id: true, title: true, level: true, wordCount: true },
  });

  return NextResponse.json({
    story: saved,
    audio: Boolean(audioUrl),
    requestedWords: STORY_LENGTHS[length].words,
  });
}
