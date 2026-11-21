import type { ReactNode } from "react";
import Link from "next/link";
import { DeckRowJobs } from "@/components/card-jobs";
import type { DeckNode } from "@/lib/deck-tree";
import type { DeckStats } from "@/lib/study";
import { cn } from "@/lib/utils";

/**
 * The deck list, laid out like Anki's: plain indented names, a +/− toggle on
 * decks that have subdecks, and New / Learn / Due in fixed columns
 * (blue / red / green, zeros dimmed) so the numbers scan straight down.
 *
 * Groups use native <details>, so toggling needs no client JS. A group starts
 * expanded when something inside it is due.
 *
 * A deck that AI cards are being added to shows their progress under its
 * name (DeckRowJobs, a client island; nothing outside the decks section).
 */
export function DeckTree({
  roots,
  openFolders = "due",
  top,
}: {
  roots: DeckNode[];
  /** Rows above the decks: the deck list's placeholders for decks being made. */
  top?: ReactNode;
  /** "due": expand groups with due cards. "none": start collapsed. */
  openFolders?: "due" | "none";
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-1 pb-1">
      <div className="flex h-8 items-center border-b border-line pl-3 text-xs font-semibold text-foreground">
        <span className="flex-1">Deck</span>
        <ColumnLabels />
      </div>
      <ul className="pt-0.5">
        {top}
        {roots.map((node) => (
          <DeckTreeItem
            key={node.id}
            node={node}
            depth={0}
            openFolders={openFolders}
          />
        ))}
      </ul>
    </div>
  );
}

function DeckTreeItem({
  node,
  depth,
  openFolders,
}: {
  node: DeckNode;
  depth: number;
  openFolders: "due" | "none";
}) {
  const indent = { paddingLeft: `${depth * 16}px` };
  // Lines a job's status up with the name: the row's padding, depth, toggle.
  const jobIndent = 8 + depth * 16 + 24;

  if (node.children.length === 0) {
    return (
      <li>
        <Link href={`/decks/${node.id}`} className={ROW}>
          <span className="flex min-w-0 flex-1 items-center" style={indent}>
            <span className="w-6 shrink-0" aria-hidden />
            <span className="truncate">{node.name}</span>
            <Unseen count={node.total.fresh} />
          </span>
          <Counts stats={node.total} />
        </Link>
        <DeckRowJobs deckId={node.id} indent={jobIndent} />
      </li>
    );
  }

  return (
    <li>
      <details open={openFolders === "due" && node.total.due > 0} className="deck-group">
        <summary className="cursor-pointer list-none">
          <span className={ROW}>
            <span className="flex min-w-0 flex-1 items-center" style={indent}>
              <span
                className="w-6 shrink-0 text-center font-mono text-base leading-none text-muted"
                aria-hidden
              >
                <span className="deck-closed">+</span>
                <span className="deck-open">−</span>
              </span>
              {/* The name opens the deck; the rest of the row expands/collapses. */}
              <Link href={`/decks/${node.id}`} className="truncate">
                {node.name}
              </Link>
              <Unseen count={node.total.fresh} />
            </span>
            <Counts stats={node.total} />
          </span>
          {/* Inside the summary, so it shows while the group is collapsed. */}
          <DeckRowJobs deckId={node.id} indent={jobIndent} />
        </summary>
        <ul>
          {node.children.map((child) => (
            <DeckTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              openFolders={openFolders}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

/** All the new cards a deck still holds (not just today's allowance), e.g. "(120)". */
function Unseen({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 shrink-0 text-xs text-muted tabular-nums" title={`${count} new cards not seen yet`}>
      ({count})
    </span>
  );
}

const ROW = "flex h-10 items-center rounded-lg pl-2 pr-2 text-[15px] active:bg-raised";

const COLUMN = "w-11 text-right tabular-nums";

function ColumnLabels() {
  return (
    <span className="flex shrink-0 pr-2">
      <span className={COLUMN}>New</span>
      <span className={COLUMN}>Learn</span>
      <span className={COLUMN}>Due</span>
    </span>
  );
}

function Counts({ stats }: { stats: DeckStats }) {
  // Today's allowance per deck (Deck.newCardsPerDay), summed up the tree.
  const fresh = stats.newToday;
  const learn = stats.learning;
  const review = stats.due - stats.learning;
  return (
    <span className="flex shrink-0 text-sm">
      <span className={cn(COLUMN, fresh > 0 ? "text-easy" : "text-muted/35")}>{fresh}</span>
      <span className={cn(COLUMN, learn > 0 ? "text-again" : "text-muted/35")}>{learn}</span>
      <span className={cn(COLUMN, review > 0 ? "text-good" : "text-muted/35")}>{review}</span>
    </span>
  );
}
