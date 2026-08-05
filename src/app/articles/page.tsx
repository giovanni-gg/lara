import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Check } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveProfile } from "@/lib/session";
import { nextLevelUp } from "@/lib/languages";
import { relativeTime } from "@/lib/utils";
import { Badge, EmptyState, PageHeader, Screen } from "@/components/ui";
import { GenerateStoryForm } from "@/components/generate-story-form";
import { GenerateArticleForm } from "@/components/generate-article-form";
import { ContentKind } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export default async function ReadPage({ searchParams }: PageProps<"/articles">) {
  const { kind } = await searchParams;
  const showArticles = kind === "articles";
  const activeKind = showArticles ? ContentKind.ARTICLE : ContentKind.STORY;

  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const items = await prisma.article.findMany({
    where: { profileId: active.id, kind: activeKind },
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

      {/* Stories and articles are the same reader, different writing brief. */}
      <div
        role="tablist"
        aria-label="Content type"
        className="mb-5 flex gap-1 rounded-xl border border-line bg-raised p-1"
      >
        <Tab href="/articles" label="Stories" selected={!showArticles} />
        <Tab href="/articles?kind=articles" label="Articles" selected={showArticles} />
      </div>

      {showArticles ? <GenerateArticleForm /> : <GenerateStoryForm />}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">
          {showArticles ? "Your articles" : "Your stories"}
        </h2>

        {items.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-8" aria-hidden />}
            title={showArticles ? "No articles yet" : "No stories yet"}
            body={
              showArticles
                ? "Pick a topic above. Lara writes it using words you already know, plus a few new ones you can work out from context."
                : "Describe a story you'd want to read. It gets written one level above you, mostly out of words you already know."
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/articles/${item.id}`}
                  className="block rounded-2xl border border-line bg-surface p-4 active:border-accent/60"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-medium leading-snug">
                        {item.title}
                      </p>
                      {item.titleTranslated ? (
                        <p className="mt-0.5 text-sm text-muted">
                          {item.titleTranslated}
                        </p>
                      ) : null}
                    </div>
                    {item.readAt ? (
                      <Check
                        className="size-5 shrink-0 text-good"
                        aria-label="Read"
                      />
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="border-accent/50 text-accent">
                      {item.level}
                    </Badge>
                    <Badge>{item.wordCount} words</Badge>
                    {item.newVocabulary.length > 0 ? (
                      <Badge>+{item.newVocabulary.length} new</Badge>
                    ) : null}
                    <Badge>{relativeTime(item.createdAt)}</Badge>
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

function Tab({
  href,
  label,
  selected,
}: {
  href: string;
  label: string;
  selected: boolean;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={selected}
      className={cn(
        "flex-1 rounded-lg py-2 text-center text-sm font-semibold transition-colors",
        selected ? "bg-accent text-accent-ink" : "text-muted",
      )}
    >
      {label}
    </Link>
  );
}
