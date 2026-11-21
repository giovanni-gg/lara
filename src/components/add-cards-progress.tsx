"use client";

import { AlertCircle, Check, ImageIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { inlineCardJobText, type WatchedCardJob } from "@/lib/card-job-inline";

/**
 * What a deck's "Add cards" box shows while a batch is being made for it,
 * in place of the form: a small stack of cards being worked on (the top
 * card's face says what's happening; each card recorded or drawn is dealt
 * off the stack), the stage text and a progress bar. Then "5 new cards
 * added", or the reason it failed with Retry. CSS only (add-cards-* in
 * globals.css), still under prefers-reduced-motion.
 */
export function AddCardsProgress({
  job,
  onRetry,
  onDismiss,
}: {
  job: WatchedCardJob;
  onRetry: () => void;
  /** Back to the form. */
  onDismiss: () => void;
}) {
  const text = inlineCardJobText(job);
  const counting = job.phase === "running" && (job.status === "AUDIO" || job.status === "PICTURES");
  const percent = counting && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;

  return (
    <div
      role={job.phase === "failed" ? "alert" : "status"}
      className="job-pill-enter flex h-full flex-col items-center justify-center gap-3 px-4 py-5 text-center"
    >
      <CardStack job={job} />

      <p className={cn("text-sm font-medium", job.phase === "failed" && "line-clamp-3")}>{text}</p>

      {job.phase === "running" ? (
        <>
          <div className="h-1 w-full max-w-56 overflow-hidden rounded-full bg-raised" aria-hidden>
            {counting ? (
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(percent, 4)}%` }}
              />
            ) : (
              <div className="add-cards-indeterminate h-full w-2/5 rounded-full bg-accent/70" />
            )}
          </div>
          <p className="text-xs text-muted">This keeps going if you leave the page.</p>
        </>
      ) : job.phase === "done" ? (
        <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>
          Add more
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden />
            Retry
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}

/** Two cards behind, one in front whose face shows the stage, and one dealt off per card done. */
function CardStack({ job }: { job: WatchedCardJob }) {
  const running = job.phase === "running";
  const card = "absolute inset-0 rounded-lg border border-line";

  return (
    <div className={cn("relative h-16 w-12", running && "add-cards-float")} aria-hidden>
      <div className={cn(card, "bg-raised -translate-x-2.5 -rotate-12")} />
      <div className={cn(card, "bg-raised translate-x-2.5 rotate-6")} />
      <div className={cn(card, "flex items-center justify-center bg-surface shadow-sm")}>
        <CardFace job={job} />
      </div>
      {/* Keyed on progress, so each card recorded or drawn is dealt away once. */}
      {running && job.done > 0 && (job.status === "AUDIO" || job.status === "PICTURES") ? (
        <div key={`${job.status}-${job.done}`} className={cn(card, "add-cards-deal bg-surface")} />
      ) : null}
    </div>
  );
}

function CardFace({ job }: { job: WatchedCardJob }) {
  if (job.phase === "done") {
    return <Check className="add-cards-pop size-5 text-good" strokeWidth={2.5} />;
  }
  if (job.phase === "failed") {
    return <AlertCircle className="size-5 text-again" />;
  }
  if (job.status === "AUDIO") {
    return (
      <span className="flex h-5 items-center gap-[3px]">
        {[0, 1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className="add-cards-bar h-full w-[3px] rounded-full bg-accent"
            style={{ animationDelay: `${bar * -0.22}s` }}
          />
        ))}
      </span>
    );
  }
  if (job.status === "PICTURES") {
    return (
      <span className="job-pill-running flex size-8 items-center justify-center rounded-md">
        <ImageIcon className="size-5 text-accent" />
      </span>
    );
  }
  // Being written: lines of text appear, one after another, over and over.
  return (
    <span className="flex w-7 flex-col gap-1.5">
      {["w-full", "w-4/5", "w-3/5"].map((width, line) => (
        <span
          key={width}
          className={cn("add-cards-line h-1 rounded-full bg-muted/50", width)}
          style={{ animationDelay: `${line * 0.35}s` }}
        />
      ))}
    </span>
  );
}
