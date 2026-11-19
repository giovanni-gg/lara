import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { StoryReader } from "@/components/story-reader";
import { Screen } from "@/components/ui";

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
