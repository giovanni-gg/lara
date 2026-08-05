import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Layers, Plus, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveProfile } from "@/lib/session";
import { profileStats, sessionSize } from "@/lib/study";
import { getLanguage } from "@/lib/languages";
import {
  Badge,
  ButtonLink,
  EmptyState,
  Panel,
  Screen,
  Stat,
} from "@/components/ui";
import { GenerateDeckForm } from "@/components/generate-deck-form";

export default async function TodayPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const language = getLanguage(active.targetLanguage);
  const stats = await profileStats(active.id);
  const toStudy = sessionSize(stats, active);

  const [decks, unreadArticles] = await Promise.all([
    prisma.deck.findMany({
      where: { profileId: active.id },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: {
        id: true,
        name: true,
        emoji: true,
        _count: { select: { cards: true } },
      },
    }),
    prisma.article.findMany({
      where: { profileId: active.id, readAt: null, status: "READY" },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { id: true, title: true, level: true, wordCount: true },
    }),
  ]);

  return (
    <Screen>
      <header className="flex items-center justify-between pt-6 pb-5">
        <div>
          <p className="text-sm text-muted">
            {language.flag} {language.name} · {active.level}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Today
          </h1>
        </div>
        <Link
          href="/settings"
          className="flex size-11 items-center justify-center rounded-full border border-line bg-surface text-xl"
          aria-label="Settings"
        >
          {language.flag}
        </Link>
      </header>

      <div className="flex gap-2">
        <Stat
          value={stats.due}
          label="Due"
          tone={stats.due > 0 ? "accent" : "default"}
        />
        <Stat value={stats.fresh} label="New" />
        <Stat value={stats.reviewedToday} label="Done" tone="good" />
      </div>

      <div className="mt-4">
        {toStudy > 0 ? (
          <ButtonLink href="/study" className="w-full min-h-14 text-base">
            <Sparkles className="size-5" aria-hidden />
            Study {toStudy} {toStudy === 1 ? "card" : "cards"}
          </ButtonLink>
        ) : (
          <Panel className="text-center">
            <p className="font-display text-lg font-semibold">
              {stats.total === 0 ? "No cards yet" : "All caught up"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {stats.total === 0
                ? "Describe what you want to learn and Lara will build the deck."
                : "Nothing is due. Read something, or add new cards below."}
            </p>
          </Panel>
        )}
      </div>

      {/* Prompt-to-deck — the reason this app exists on a phone. */}
      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">Make cards</h2>
        <GenerateDeckForm />
      </section>

      {unreadArticles.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">
              Waiting to read
            </h2>
            <Link href="/articles" className="text-sm text-accent">
              All
            </Link>
          </div>
          <ul className="space-y-2">
            {unreadArticles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/articles/${article.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:border-accent/60"
                >
                  <BookOpen
                    className="size-5 shrink-0 text-accent"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-display block truncate font-medium">
                      {article.title}
                    </span>
                    <span className="text-xs text-muted">
                      {article.level} · {article.wordCount} words
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">Recent decks</h2>
          <Link href="/decks" className="text-sm text-accent">
            All
          </Link>
        </div>
        {decks.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-8" aria-hidden />}
            title="No decks yet"
            body="Generate one above, or build it card by card."
            action={
              <ButtonLink href="/decks/new" variant="secondary">
                <Plus className="size-4" aria-hidden />
                New deck
              </ButtonLink>
            }
          />
        ) : (
          <ul className="space-y-2">
            {decks.map((deck) => (
              <li key={deck.id}>
                <Link
                  href={`/decks/${deck.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:border-accent/60"
                >
                  <span className="text-2xl" aria-hidden>
                    {deck.emoji ?? "🗂️"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {deck.name}
                  </span>
                  <Badge>{deck._count.cards}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}
