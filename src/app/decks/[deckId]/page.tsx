import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Play } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { deckStats } from "@/lib/study";
import { GenerateDeckForm } from "@/components/generate-deck-form";
import { CardRow } from "@/components/card-row";
import { ButtonLink, Panel, Screen, Stat } from "@/components/ui";

export default async function DeckPage({ params }: PageProps<"/decks/[deckId]">) {
  const { deckId } = await params;
  const user = await getCurrentUser();

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: { id: true, name: true, emoji: true, description: true },
  });
  if (!deck) notFound();

  const [stats, cards] = await Promise.all([
    deckStats(deck.id),
    prisma.card.findMany({
      where: { deckId: deck.id },
      orderBy: [{ due: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: {
        id: true,
        target: true,
        source: true,
        targetSentence: true,
        notes: true,
        audioUrl: true,
        state: true,
        due: true,
        suspended: true,
      },
    }),
  ]);

  return (
    <Screen>
      <div className="pt-5">
        <Link
          href="/decks"
          className="inline-flex items-center gap-1 text-sm text-muted"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Decks
        </Link>
      </div>

      <header className="pt-4 pb-5">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {deck.emoji ?? "🗂️"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {deck.name}
            </h1>
            {deck.description ? (
              <p className="mt-1 text-sm text-muted">{deck.description}</p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex gap-2">
        <Stat value={stats.total} label="Cards" />
        <Stat
          value={stats.due}
          label="Due"
          tone={stats.due > 0 ? "accent" : "default"}
        />
        <Stat value={stats.fresh} label="New" />
      </div>

      {stats.due + stats.fresh > 0 ? (
        <ButtonLink
          href={`/study?deck=${deck.id}`}
          className="mt-4 w-full min-h-13"
        >
          <Play className="size-4" aria-hidden />
          Study this deck
        </ButtonLink>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">
          Add more cards
        </h2>
        <GenerateDeckForm deckId={deck.id} />
        <ButtonLink
          href={`/decks/${deck.id}/cards/new`}
          variant="secondary"
          className="mt-2 w-full"
        >
          Write one by hand
        </ButtonLink>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">Cards</h2>
          {cards.length === 200 ? (
            <span className="text-xs text-muted">first 200</span>
          ) : null}
        </div>

        {cards.length === 0 ? (
          <Panel className="text-center text-sm text-muted">
            This deck is empty. Generate cards above to fill it.
          </Panel>
        ) : (
          <ul className="space-y-2">
            {cards.map((card) => (
              <CardRow key={card.id} card={card} />
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}
