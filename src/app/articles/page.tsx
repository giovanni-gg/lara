import { redirect } from "next/navigation";
import Link from "next/link";
import { Check, Headphones, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveProfile } from "@/lib/session";
import { nextLevelUp } from "@/lib/languages";
import { relativeTime } from "@/lib/utils";
import { ButtonLink, EmptyState, PageHeader, Screen } from "@/components/ui";

/** Listen & Read: the story library. Every story has its text and its audio. */
export default async function ListenAndReadPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const stories = await prisma.article.findMany({
    where: { profileId: active.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      titleTranslated: true,
      level: true,
      wordCount: true,
      readAt: true,
      createdAt: true,
      deck: { select: { name: true } },
    },
  });

  return (
    <Screen>
      <PageHeader
        title="Listen & Read"
        subtitle={`Stories with audio at ${nextLevelUp(active.level)}, one level above you`}
        action={
          stories.length > 0 ? (
            <ButtonLink href="/articles/new" size="sm">
              <Plus className="size-4" aria-hidden />
              New story
            </ButtonLink>
          ) : null
        }
      />

      {stories.length === 0 ? (
        <EmptyState
          icon={<Headphones className="size-8" aria-hidden />}
          title="No stories yet"
          body="Pick one of your decks, or describe a story you'd like. It's written one level above you out of words you know, and read aloud sentence by sentence."
          action={
            <ButtonLink href="/articles/new">
              <Plus className="size-4" aria-hidden />
              Write a story
            </ButtonLink>
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {stories.map((story) => (
            <li key={story.id}>
              <Link
                href={`/articles/${story.id}`}
                className="flex items-center gap-3 px-3 py-2.5 active:bg-raised"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] font-medium leading-snug">
                    {story.title}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[
                      story.titleTranslated,
                      story.deck?.name,
                      `${story.level} · ${story.wordCount} words`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-[11px] text-muted tabular-nums">
                    {relativeTime(story.createdAt)}
                  </span>
                  {story.readAt ? (
                    <Check className="size-4 text-good" aria-label="Finished" />
                  ) : (
                    <span className="size-2 rounded-full bg-accent" aria-label="New" />
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
