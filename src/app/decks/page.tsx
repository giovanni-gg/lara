import { redirect } from "next/navigation";
import Link from "next/link";
import { Archive, CircleHelp, Layers, Plus, Sparkles } from "lucide-react";
import { getActiveProfile } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadDeckTree } from "@/lib/deck-tree";
import { DeckTree } from "@/components/deck-tree";
import { unarchiveDeck } from "@/app/actions";
import { ButtonLink, EmptyState, PageHeader, Panel, Screen, Stat } from "@/components/ui";
import { profileStats, sessionSize } from "@/lib/study";
import { getLanguage } from "@/lib/languages";

export default async function DecksPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  // Sequential: both run aggregate queries (see AGENTS.md).
  const stats = await profileStats(active.id);
  const toStudy = sessionSize(stats);
  const language = getLanguage(active.targetLanguage);
  const { roots, archivedRoots } = await loadDeckTree(active.id);
  const count = (nodes: typeof roots): number =>
    nodes.reduce((n, node) => n + 1 + count(node.children), 0);
  const due = roots.reduce((n, r) => n + r.total.due, 0);
  const fresh = roots.reduce((n, r) => n + r.total.newToday, 0);
  const decks = count(roots);

  // Archived decks are listed by everything they hold — the study counts above
  // skip suspended cards, and archived decks are often fully suspended.
  // Sequential after the tree's aggregate (AGENTS.md: never concurrent).
  const heldByDeck = new Map(
    (
      await prisma.card.groupBy({
        by: ["deckId"],
        where: { deck: { profileId: active.id, archivedAt: { not: null } } },
        _count: { _all: true },
      })
    ).map((row) => [row.deckId, row._count._all]),
  );
  const held = (node: (typeof archivedRoots)[number]): number =>
    (heldByDeck.get(node.id) ?? 0) + node.children.reduce((n, c) => n + held(c), 0);

  return (
    <Screen>
      <PageHeader
        title="Decks"
        subtitle={`${language.flag} ${language.name} · ${active.level} · ${decks} ${decks === 1 ? "deck" : "decks"}`}
        action={
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/how-it-works"
              aria-label="How LaraMig works"
              title="How LaraMig works"
              className="grid size-9 place-items-center rounded-xl text-muted transition-colors hover:text-foreground"
            >
              <CircleHelp className="size-5" strokeWidth={1.8} aria-hidden />
            </Link>
            <ButtonLink href="/decks/new" variant="secondary" size="sm">
              <Plus className="size-4" aria-hidden />
              New
            </ButtonLink>
          </div>
        }
      />

      {/* The day at a glance, then the one button that matters. */}
      <div className="flex gap-2">
        <Stat value={due} label="Due" tone={due > 0 ? "accent" : "default"} />
        <Stat value={fresh} label="New" />
        <Stat value={stats.reviewedToday} label="Done" tone="good" />
      </div>
      <div className="mt-3 mb-5">
        {toStudy > 0 ? (
          <ButtonLink href="/study" className="w-full min-h-12 text-base">
            <Sparkles className="size-5" aria-hidden />
            Study {toStudy} {toStudy === 1 ? "card" : "cards"}
          </ButtonLink>
        ) : stats.total > 0 ? (
          <Panel className="text-center text-sm text-muted">
            All caught up — nothing is due right now.
          </Panel>
        ) : null}
      </div>

      {roots.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-8" aria-hidden />}
          title="No decks yet"
          body="Generate a deck from a prompt, or create an empty one and add cards yourself."
          action={<ButtonLink href="/decks/new">New deck</ButtonLink>}
        />
      ) : (
        <DeckTree roots={roots} />
      )}

      {archivedRoots.length > 0 ? (
        // Out of the way by default: archived decks are kept, not studied.
        <details className="deck-group mt-5 mb-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-2 text-sm text-muted">
            <Archive className="size-4" aria-hidden />
            <span className="flex-1">
              Archived · {count(archivedRoots)} {count(archivedRoots) === 1 ? "deck" : "decks"}
            </span>
            <span className="deck-closed font-mono">+</span>
            <span className="deck-open font-mono">−</span>
          </summary>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {archivedRoots.map((deck) => (
              <li key={deck.id} className="flex items-center gap-2 pl-3 pr-2">
                <Link href={`/decks/${deck.id}`} className="flex min-w-0 flex-1 items-baseline gap-2 py-2.5">
                  <span className="truncate text-[15px]">{deck.name}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {held(deck)} cards
                    {deck.children.length > 0 ? ` · ${deck.children.length} subdecks` : ""}
                  </span>
                </Link>
                <form action={unarchiveDeck}>
                  <input type="hidden" name="deckId" value={deck.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted active:bg-raised"
                  >
                    Unarchive
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Screen>
  );
}
