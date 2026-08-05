import { redirect } from "next/navigation";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveProfile } from "@/lib/session";
import { EMPTY_DECK_STATS, statsByDeck } from "@/lib/study";
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  Screen,
} from "@/components/ui";

export default async function DecksPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const decks = await prisma.deck.findMany({
    where: { profileId: active.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, emoji: true, description: true },
  });

  const stats = await statsByDeck(active.id);
  const withStats = decks.map((deck) => ({
    ...deck,
    stats: stats.get(deck.id) ?? EMPTY_DECK_STATS,
  }));

  return (
    <Screen>
      <PageHeader
        title="Decks"
        subtitle={`${decks.length} ${decks.length === 1 ? "deck" : "decks"}`}
        action={
          <ButtonLink href="/decks/new" variant="secondary" className="shrink-0">
            <Plus className="size-4" aria-hidden />
            New
          </ButtonLink>
        }
      />

      {withStats.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-8" aria-hidden />}
          title="No decks yet"
          body="Generate one from a prompt on the Today screen, or create an empty deck and add cards yourself."
          action={
            <ButtonLink href="/">Go to Today</ButtonLink>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {withStats.map((deck) => (
            <li key={deck.id}>
              <Link
                href={`/decks/${deck.id}`}
                className="block rounded-2xl border border-line bg-surface p-4 active:border-accent/60"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none" aria-hidden>
                    {deck.emoji ?? "🗂️"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{deck.name}</p>
                    {deck.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                        {deck.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Badge>{deck.stats.total} cards</Badge>
                  {deck.stats.due > 0 ? (
                    <Badge className="border-accent/50 text-accent">
                      {deck.stats.due} due
                    </Badge>
                  ) : null}
                  {deck.stats.fresh > 0 ? (
                    <Badge>{deck.stats.fresh} new</Badge>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
