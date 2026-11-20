import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ChevronRight, FolderPlus, Headphones, Play } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getLanguage } from "@/lib/languages";
import { flattenWithPaths, loadDeckTree, type DeckNode } from "@/lib/deck-tree";
import { EMPTY_DECK_STATS } from "@/lib/study";
import { imagesAvailable } from "@/lib/images";
import { archiveDeck, moveDeck, unarchiveDeck, updateDeckNewCardsPerDay } from "@/app/actions";
import { GenerateDeckForm } from "@/components/generate-deck-form";
import { CardRow } from "@/components/card-row";
import { DeckTree } from "@/components/deck-tree";
import { Button, ButtonLink, Panel, Screen, Stat } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ConfirmSubmit } from "@/components/confirm-submit";

const CARD_LIMIT = 200;

export default async function DeckPage({ params }: PageProps<"/decks/[deckId]">) {
  const { deckId } = await params;
  const user = await getCurrentUser();

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: {
      id: true,
      name: true,
      emoji: true,
      description: true,
      direction: true,
      parentId: true,
      profileId: true,
      archivedAt: true,
      newCardsPerDay: true,
      profile: { select: { targetLanguage: true, sourceLanguage: true } },
    },
  });
  if (!deck) notFound();

  // The tree's stats are one raw aggregate; the card list is a plain findMany,
  // so these two may run side by side (AGENTS.md forbids parallel aggregates).
  const [{ roots, byId }, cards] = await Promise.all([
    loadDeckTree(deck.profileId),
    prisma.card.findMany({
      where: { deckId: deck.id },
      orderBy: [{ due: "asc" }, { createdAt: "asc" }],
      take: CARD_LIMIT,
      select: {
        id: true,
        target: true,
        source: true,
        targetSentence: true,
        notes: true,
        audioUrl: true,
        imageUrl: true,
        cardType: true,
        state: true,
        due: true,
        suspended: true,
      },
    }),
  ]);

  const node = byId.get(deck.id);
  const stats = node?.total ?? EMPTY_DECK_STATS;
  const ownCount = node?.own.total ?? cards.length;
  const subdecks = node?.children ?? [];

  // Ancestry from the tree already in memory — no per-level queries.
  const ancestors: { id: string; name: string }[] = [];
  for (let id = deck.parentId; id && ancestors.length < 20; ) {
    const parent = byId.get(id);
    if (!parent) break;
    ancestors.unshift({ id: parent.id, name: parent.name });
    id = parent.parentId;
  }

  // "Move to" can't target this deck or anything beneath it.
  const excluded = new Set(node ? collectIds(node) : [deck.id]);
  const destinations = flattenWithPaths(roots).filter((d) => !excluded.has(d.id));

  const target = getLanguage(deck.profile.targetLanguage);
  const source = getLanguage(deck.profile.sourceLanguage);
  const learning = stats.learning;
  const review = Math.max(0, stats.due - stats.learning);

  return (
    <Screen>
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-0.5 pt-4 text-xs text-muted"
      >
        <Link href="/decks" className="shrink-0 py-1">
          Decks
        </Link>
        {ancestors.map((a) => (
          <Fragment key={a.id}>
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            <Link href={`/decks/${a.id}`} className="min-w-0 truncate py-1">
              {a.name}
            </Link>
          </Fragment>
        ))}
      </nav>

      <header className="flex items-start gap-2.5 pt-1 pb-3">
        <span className="text-2xl leading-8" aria-hidden>
          {deck.emoji ?? "🗂️"}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold leading-8 tracking-tight">
            {deck.name}
          </h1>
          <p className="text-xs text-muted">
            {stats.total} {stats.total === 1 ? "card" : "cards"}
            {subdecks.length > 0
              ? ` · ${subdecks.length} ${subdecks.length === 1 ? "subdeck" : "subdecks"}`
              : null}
            {deck.description ? ` · ${deck.description}` : null}
          </p>
        </div>
      </header>

      {deck.archivedAt ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-sm">
          <Archive className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="flex-1 text-muted">Archived — not studied</span>
          <form action={unarchiveDeck}>
            <input type="hidden" name="deckId" value={deck.id} />
            <Button type="submit" variant="secondary" size="sm">
              Unarchive
            </Button>
          </form>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Stat value={stats.newToday} label="New" />
        <Stat value={learning} label="Learn" tone={learning > 0 ? "accent" : "default"} />
        <Stat value={review} label="Due" tone={review > 0 ? "good" : "default"} />
      </div>

      {!deck.archivedAt && stats.due + stats.newToday > 0 ? (
        <ButtonLink href={`/study?deck=${deck.id}`} className="mt-3 w-full">
          <Play className="size-4" aria-hidden />
          Study {subdecks.length > 0 ? "all" : "this deck"}
        </ButtonLink>
      ) : null}

      {!deck.archivedAt && stats.total > 0 ? (
        <ButtonLink
          href={`/articles/new?deck=${deck.id}`}
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
        >
          <Headphones className="size-4" aria-hidden />
          Make a story from this deck
        </ButtonLink>
      ) : null}

      {subdecks.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-base font-semibold">Subdecks</h2>
          <DeckTree roots={subdecks} />
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 font-display text-base font-semibold">Add cards</h2>
        <GenerateDeckForm
          deckId={deck.id}
          deckName={deck.name}
          targetName={target.name}
          sourceName={source.name}
          defaultDirection={deck.direction}
          picturesAvailable={imagesAvailable()}
        />
        <ButtonLink
          href={`/decks/${deck.id}/cards/new`}
          variant="secondary"
          size="sm"
          className="mt-2 w-full"
        >
          Write one by hand
        </ButtonLink>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-display text-base font-semibold">Deck options</h2>
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-2.5">
          <form action={updateDeckNewCardsPerDay} className="flex items-center gap-2">
            <input type="hidden" name="deckId" value={deck.id} />
            <label htmlFor="new-per-day" className="flex-1 text-xs text-muted">
              New cards / day
            </label>
            <input
              id="new-per-day"
              name="newCardsPerDay"
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              defaultValue={deck.newCardsPerDay}
              className="w-16 rounded-lg border border-line bg-raised px-2 py-1.5 text-right text-base text-foreground tabular-nums outline-none focus:border-accent"
            />
            <Button type="submit" variant="secondary" size="sm" className="shrink-0">
              Save
            </Button>
          </form>
          <form action={moveDeck} className="flex items-center gap-2">
            <input type="hidden" name="deckId" value={deck.id} />
            <label htmlFor="move-parent" className="shrink-0 text-xs text-muted">
              Move to
            </label>
            <select
              id="move-parent"
              name="parentId"
              defaultValue={deck.parentId ?? ""}
              className={cn(
                "min-w-0 flex-1 rounded-lg border border-line bg-raised px-2 py-1.5 text-sm",
                "text-foreground outline-none focus:border-accent",
              )}
            >
              <option value="">Top level</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm" className="shrink-0">
              Move
            </Button>
          </form>
          <ButtonLink
            href={`/decks/new?parent=${deck.id}`}
            variant="ghost"
            size="sm"
            className="w-full justify-start px-1"
          >
            <FolderPlus className="size-4" aria-hidden />
            New subdeck
          </ButtonLink>
          {deck.archivedAt ? null : (
            <form action={archiveDeck}>
              <input type="hidden" name="deckId" value={deck.id} />
              <ConfirmSubmit
                message={`Archive "${deck.name}"${subdecks.length > 0 ? " and its subdecks" : ""}? It won't be studied, but nothing is deleted — you can unarchive it from the Archived section.`}
                variant="ghost"
                size="sm"
                className="w-full justify-start px-1"
              >
                <Archive className="size-4" aria-hidden />
                Archive deck{subdecks.length > 0 ? " and its subdecks" : ""}
              </ConfirmSubmit>
            </form>
          )}
        </div>
      </section>

      {cards.length > 0 || subdecks.length === 0 ? (
        // Collapsed by default: a deck can hold hundreds of cards, and the list
        // shouldn't push everything else off the screen.
        <details className="deck-group mt-6 mb-4">
          <summary className="mb-2 flex cursor-pointer list-none items-baseline justify-between">
            <h2 className="font-display text-base font-semibold">
              <span className="deck-closed mr-1.5 font-mono text-muted">+</span>
              <span className="deck-open mr-1.5 font-mono text-muted">−</span>
              Cards
              {subdecks.length > 0 ? (
                <span className="ml-1 text-xs font-normal text-muted">in this deck</span>
              ) : null}
            </h2>
            <span className="text-xs text-muted tabular-nums">
              {ownCount > cards.length ? `first ${cards.length} of ${ownCount}` : ownCount}
            </span>
          </summary>

          {cards.length === 0 ? (
            <Panel className="text-center text-sm text-muted">
              This deck is empty. Generate cards above to fill it.
            </Panel>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {cards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  languages={{ target: target.code, source: source.code }}
                />
              ))}
            </ul>
          )}
        </details>
      ) : null}

    </Screen>
  );
}

function collectIds(node: DeckNode): string[] {
  return [node.id, ...node.children.flatMap(collectIds)];
}
