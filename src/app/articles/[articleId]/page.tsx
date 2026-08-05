import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { ArticleReader } from "@/components/article-reader";
import { Screen } from "@/components/ui";

export default async function ArticlePage({
  params,
}: PageProps<"/articles/[articleId]">) {
  const { articleId } = await params;
  const user = await getCurrentUser();

  const article = await prisma.article.findFirst({
    where: { id: articleId, userId: user.id },
    select: {
      id: true,
      title: true,
      titleTranslated: true,
      level: true,
      wordCount: true,
      audioUrl: true,
      readAt: true,
      newVocabulary: true,
      segments: {
        orderBy: { index: "asc" },
        select: { id: true, index: true, target: true, translation: true },
      },
    },
  });
  if (!article) notFound();

  return (
    <Screen>
      <div className="pt-5">
        <Link
          href="/articles"
          className="inline-flex items-center gap-1 text-sm text-muted"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Read
        </Link>
      </div>
      <ArticleReader article={article} />
    </Screen>
  );
}
