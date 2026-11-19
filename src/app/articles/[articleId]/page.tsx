import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { StoryReader } from "@/components/story-reader";
import { ButtonLink, Screen } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { storyState } from "@/lib/stories";

export default async function StoryPage({
  params,
}: PageProps<"/articles/[articleId]">) {
  const { articleId } = await params;
  const user = await getCurrentUser();

  const story = await prisma.article.findFirst({
    where: { id: articleId, userId: user.id },
    select: {
      id: true,
      title: true,
      titleTranslated: true,
      level: true,
      wordCount: true,
      readAt: true,
      status: true,
      createdAt: true,
      newVocabulary: true,
      deck: { select: { id: true, name: true } },
      segments: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          target: true,
          translation: true,
          audioUrl: true,
        },
      },
    },
  });
  if (!story) notFound();

  const state = storyState(story);
  if (state !== "ready") {
    return (
      <Screen>
        <AutoRefresh active={state === "writing"} />
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
          <p className="font-display text-xl font-semibold">
            {state === "writing" ? "Still writing this story…" : "Couldn't write this story"}
          </p>
          <p className="max-w-xs text-sm text-muted">
            {state === "writing"
              ? "It's being written on the server — you can leave; it'll be in Listen & Read when it's ready."
              : "Something went wrong while writing it. Delete it from Listen & Read and try again."}
          </p>
          <ButtonLink href="/articles" variant="secondary" size="sm">
            Back to Listen & Read
          </ButtonLink>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="pt-4">
        <Link href="/articles" className="inline-flex items-center gap-1 py-1 text-sm text-muted">
          <ChevronLeft className="size-4" aria-hidden />
          Listen &amp; Read
        </Link>
      </div>
      {/* Keyed so a different story starts with a fresh player. */}
      <StoryReader key={story.id} story={story} />
    </Screen>
  );
}
