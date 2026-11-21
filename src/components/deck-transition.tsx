import Link from "next/link";
import { ArrowDown, Check } from "lucide-react";
import { Button } from "@/components/ui";
import { UndoButton } from "@/components/undo-button";

const cards = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/**
 * Between two decks of one session: what was just finished, what's next. A
 * beat to switch subjects (verbs to adjectives) before the next card shows.
 * The study session renders it in place of the next deck's first card, so
 * nothing about grading changes; Continue just lets that card show.
 */
export function DeckTransition({
  finished,
  finishedCount,
  next,
  nextCount,
  onContinue,
  onUndo,
}: {
  finished: string;
  finishedCount: number;
  next: string;
  nextCount: number;
  onContinue: () => void;
  /** Takes back the finished deck's last answer, returning to that card. */
  onUndo?: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-safe pb-safe">
      {/* Top-left, as on the card screen. */}
      <div className="-mx-3 flex h-13 items-center">
        {onUndo ? <UndoButton onUndo={onUndo} /> : null}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="flex flex-col items-center gap-2" role="status">
          <span className="deck-done-pop flex size-11 items-center justify-center rounded-full bg-good/15 text-good">
            <Check className="size-6" strokeWidth={2.5} aria-hidden />
          </span>
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{finished}</span> done
            · {cards(finishedCount)}
          </p>
        </div>

        <ArrowDown className="deck-next-rise size-4 text-muted/60" aria-hidden />

        <div className="deck-next-rise w-full rounded-2xl border border-line bg-surface px-5 py-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-muted">Next</p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight break-words">
            {next}
          </h1>
          <p className="mt-1.5 text-sm tabular-nums text-muted">{cards(nextCount)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1 pb-2">
        {/* Focused so Enter/space carry on from the keyboard, as they would
            reveal a card. */}
        <Button autoFocus className="min-h-14 w-full" onClick={onContinue}>
          Continue
        </Button>
        <Link href="/decks" className="py-2.5 text-center text-sm text-muted active:text-foreground">
          Stop here
        </Link>
      </div>
    </div>
  );
}
