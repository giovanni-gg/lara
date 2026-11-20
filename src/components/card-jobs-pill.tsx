"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardJobPhase, CardJobView } from "@/lib/card-job-status";

/** Fired by the generate form with the job the route just queued. */
const QUEUED_EVENT = "lara:card-job-queued";
/** Fired here when a watched job finishes, with its deck id. */
const FINISHED_EVENT = "lara:card-job-finished";

const POLL_MS = 2000;
/** How long "5 new cards in Adjectives" stays up. Failures stay until dismissed. */
const DONE_VISIBLE_MS = 5000;

/** Shows a job the route just queued, and starts watching it. */
export function announceCardJob(job: CardJobView) {
  window.dispatchEvent(new CustomEvent(QUEUED_EVENT, { detail: job }));
}

/** Calls back with the deck id whenever a job this page watched finishes. Returns an unsubscribe. */
export function onCardJobFinished(callback: (deckId: string | null) => void): () => void {
  const listener = (event: Event) => callback((event as CustomEvent<string | null>).detail);
  window.addEventListener(FINISHED_EVENT, listener);
  return () => window.removeEventListener(FINISHED_EVENT, listener);
}

/**
 * The floating "making cards" status, on every screen (root layout). It never
 * blocks: the cards are made server-side (src/lib/card-jobs.ts) and this only
 * polls /api/card-jobs every 2 s while something it knows of is in progress,
 * and not at all otherwise. Shows a job only once it has seen it in progress,
 * so a reload doesn't replay old results.
 */
export function CardJobsPill() {
  const pathname = usePathname();
  const router = useRouter();
  const [shown, setShown] = useState<CardJobView[]>([]);
  const [polling, setPolling] = useState(false);
  // Jobs seen in progress on this page, by id → the phase last seen.
  const watched = useRef(new Map<string, { phase: CardJobPhase; status: string }>());
  const dismissed = useRef(new Set<string>());
  const onLogin = pathname === "/login";

  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id);
    setShown((jobs) => jobs.filter((job) => job.id !== id));
  }, []);

  const apply = useCallback(
    (jobs: CardJobView[]) => {
      let refresh = false;
      const next: CardJobView[] = [];
      for (const job of jobs) {
        if (dismissed.current.has(job.id)) continue;
        const last = watched.current.get(job.id);
        if (job.phase !== "running" && !last) continue;
        if (last?.phase === "running" && job.phase !== "running") {
          // Finished: the deck page and the decks list show new counts.
          refresh = true;
          window.dispatchEvent(new CustomEvent(FINISHED_EVENT, { detail: job.deckId }));
          if (job.phase === "done") setTimeout(() => dismiss(job.id), DONE_VISIBLE_MS);
        } else if (last && last.status !== job.status && job.status === "AUDIO") {
          // The deck exists now (a new one appears in the list).
          refresh = true;
        }
        watched.current.set(job.id, { phase: job.phase, status: job.status });
        next.push(job);
      }
      setShown(next);
      setPolling(next.some((job) => job.phase === "running"));
      if (refresh) router.refresh();
    },
    [dismiss, router],
  );

  // Once on load: a job started before a reload is still going.
  useEffect(() => {
    if (onLogin) return;
    fetchJobs().then((jobs) => jobs && apply(jobs));
  }, [onLogin, apply]);

  useEffect(() => {
    const onQueued = (event: Event) => {
      const job = (event as CustomEvent<CardJobView>).detail;
      watched.current.set(job.id, { phase: job.phase, status: job.status });
      setShown((jobs) => [...jobs.filter((j) => j.id !== job.id), job]);
      setPolling(true);
    };
    window.addEventListener(QUEUED_EVENT, onQueued);
    return () => window.removeEventListener(QUEUED_EVENT, onQueued);
  }, []);

  useEffect(() => {
    if (!polling) return;
    const tick = () => {
      if (!document.hidden) fetchJobs().then((jobs) => jobs && apply(jobs));
    };
    const timer = setInterval(tick, POLL_MS);
    // Back from another app: catch up at once rather than on the next tick.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [polling, apply]);

  async function retry(job: CardJobView) {
    try {
      const response = await fetch("/api/decks/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: job.prompt,
          count: job.count,
          deckId: job.deckId ?? undefined,
          direction: job.direction ?? undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.job) {
        dismiss(job.id);
        announceCardJob(data.job);
        return;
      }
      setShown((jobs) => jobs.map((j) => (j.id === job.id ? { ...j, text: data.error ?? "Retry failed" } : j)));
    } catch {
      setShown((jobs) => jobs.map((j) => (j.id === job.id ? { ...j, text: "Could not reach the server" } : j)));
    }
  }

  if (onLogin || shown.length === 0) return null;

  // Studying: one compact pill over the progress bar, clear of the card and
  // the grade buttons; anything else waits for the end of the session.
  const studying = pathname.startsWith("/study");
  const visible = studying ? shown.slice(-1) : shown;

  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-1.5 px-4",
        studying ? "job-pills-study" : "job-pills-above-nav",
      )}
    >
      {visible.map((job) => (
        <JobPill
          key={job.id}
          job={job}
          compact={studying}
          more={studying ? shown.length - 1 : 0}
          onDismiss={() => dismiss(job.id)}
          onRetry={() => retry(job)}
        />
      ))}
    </div>
  );
}

/** The learner's recent jobs, or null when the server can't be reached (the next tick tries again). */
async function fetchJobs(): Promise<CardJobView[] | null> {
  try {
    const response = await fetch("/api/card-jobs?active=1", { cache: "no-store" });
    if (!response.ok) return null;
    return ((await response.json()) as { jobs: CardJobView[] }).jobs;
  } catch {
    return null;
  }
}

function JobPill({
  job,
  compact,
  more,
  onDismiss,
  onRetry,
}: {
  job: CardJobView;
  compact: boolean;
  /** Other jobs not shown (studying). */
  more: number;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const shell = cn(
    "job-pill-enter pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border bg-surface/95 shadow-lg shadow-black/20 backdrop-blur",
    compact ? "max-w-[11rem] px-2.5 py-1 text-[11px]" : "max-w-sm px-3.5 py-2 text-xs",
  );
  const extra = more > 0 ? <span className="shrink-0 text-muted">+{more}</span> : null;

  if (job.phase === "running") {
    return (
      <div role="status" className={cn(shell, "job-pill-running border-line")}>
        <span className="job-pill-dot size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        <span className="truncate">{job.text}</span>
        {extra}
      </div>
    );
  }

  if (job.phase === "done") {
    const body = (
      <>
        <Check className="size-3.5 shrink-0 text-good" aria-hidden />
        <span className="truncate">{job.text}</span>
        {extra}
      </>
    );
    return job.deckId && job.created > 0 ? (
      <Link href={`/decks/${job.deckId}`} onClick={onDismiss} className={cn(shell, "border-good/40")}>
        {body}
      </Link>
    ) : (
      <div className={cn(shell, "border-line")}>{body}</div>
    );
  }

  return (
    <div role="alert" className={cn(shell, "border-again/40")}>
      <AlertCircle className="size-3.5 shrink-0 text-again" aria-hidden />
      <span className="truncate">{job.text}</span>
      {extra}
      {compact ? null : (
        <button type="button" onClick={onRetry} className="shrink-0 font-semibold text-accent">
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
