import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Check } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveProfile } from "@/lib/session";
import { nextLevelUp } from "@/lib/languages";
import { relativeTime } from "@/lib/utils";
import { Badge, EmptyState, PageHeader, Screen } from "@/components/ui";
import { GenerateArticleForm } from "@/components/generate-article-form";

export default async function ArticlesPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const articles = await prisma.article.findMany({
    where: { profileId: active.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      titleTranslated: true,
      level: true,
      wordCount: true,
      readAt: true,
      createdAt: true,
      newVocabulary: true,
    },
  });

  return (
    <Screen>
      <PageHeader
        title="Read"
        subtitle={`Written at ${nextLevelUp(active.level)} — one step above you`}
      />

      <GenerateArticleForm />

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">Your library</h2>

        {articles.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-8" aria-hidden />}
            title="Nothing to read yet"
            body="Pick a topic above. Lara writes it using words you already know, plus a few new ones you can work out from context."
          />
        ) : (
          <ul className="space-y-2.5">
            {articles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/articles/${article.id}`}
                  className="block rounded-2xl border border-line bg-surface p-4 active:border-accent/60"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-medium leading-snug">
                        {article.title}
                      </p>
                      {article.titleTranslated ? (
                        <p className="mt-0.5 text-sm text-muted">
                          {article.titleTranslated}
                        </p>
                      ) : null}
                    </div>
                    {article.readAt ? (
                      <Check
                        className="size-5 shrink-0 text-good"
                        aria-label="Read"
                      />
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="border-accent/50 text-accent">
                      {article.level}
                    </Badge>
                    <Badge>{article.wordCount} words</Badge>
                    {article.newVocabulary.length > 0 ? (
                      <Badge>+{article.newVocabulary.length} new</Badge>
                    ) : null}
                    <Badge>{relativeTime(article.createdAt)}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}
