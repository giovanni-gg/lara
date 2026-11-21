"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardJobView } from "@/lib/card-job-status";
import {
  inlineCardJobText,
  jobsForDeck,
  newDeckJobs,
  newDeckJobText,
  type WatchedCardJob,
} from "@/lib/card-job-inline";

/** Fired when a watched job finishes, with its deck id. */
const FINISHED_EVENT = "lara:card-job-finished";

const POLL_MS = 2000;
/** How long "5 new cards added" stays up. Failures stay until dismissed. */
const DONE_VISIBLE_MS = 8000;

type CardJobsApi = {
  jobs: WatchedCardJob[];
  /** Shows a job the generate route just queued, and starts watching it. */
  announce: (job: CardJobView) => void;
  dismiss: (id: string) => void;
  retry: (job: WatchedCardJob) => void;
};

const CardJobsContext = createContext<CardJobsApi | null>(null);

/** The decks section's card jobs, or null outside it (nothing is shown there). */
export function useCardJobs(): CardJobsApi | null {
  return useContext(CardJobsContext);
}

/** Calls back with the deck id whenever a watched job finishes. Returns an unsubscribe. */
export function onCardJobFinished(callback: (deckId: string | null) => void): () => void {
  const listener = (event: Event) => callback((event as CustomEvent<string | null>).detail);
  window.addEventListener(FINISHED_EVENT, listener);
  return () => window.removeEventListener(FINISHED_EVENT, listener);
}

/**
 * Watches the learner's AI card jobs for the decks section (mounted once in
 * its layout, so it survives going from a deck to the list and back). The
 * cards are made server-side (src/lib/card-jobs.ts); this polls
 * /api/card-jobs every 2 s only while a job it knows of is running, and
 * refreshes the page when one finishes or its new deck gets a name, so the
 * server-rendered counts and rows catch up. The status itself is drawn
 * inline, where the deck is: the deck page's "Add cards" box
 * (generate-deck-form.tsx), DeckRowJobs and NewDeckJobRows in the list.
 *
 * Shows a job only once it has seen it in progress, so a reload doesn't
 * replay old results.
 */
export function CardJobsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<WatchedCardJob[]>([]);
  const [polling, setPolling] = useState(false);
  // Every job seen in progress here, as last seen.
  const watched = useRef(new Map<string, WatchedCardJob>());
  const dismissed = useRef(new Set<string>());

  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id);
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const apply = useCallback(
    (views: CardJobView[]) => {
      let refresh = false;
      const next: WatchedCardJob[] = [];
      for (const view of views) {
        if (dismissed.current.has(view.id)) continue;
        const last = watched.current.get(view.id);
        if (view.phase !== "running" && !last) continue;
        if (last?.phase === "running" && view.phase !== "running") {
          // Finished: new counts, new cards in the list.
          refresh = true;
          window.dispatchEvent(new CustomEvent(FINISHED_EVENT, { detail: view.deckId }));
          if (view.phase === "done") setTimeout(() => dismiss(view.id), DONE_VISIBLE_MS);
        } else if (last && !last.deckId && view.deckId) {
          // The model named the new deck: its row can appear.
          refresh = true;
        }
        const job: WatchedCardJob = { ...view, newDeck: last?.newDeck ?? !view.deckId };
        watched.current.set(view.id, job);
        next.push(job);
      }
      setJobs(next);
      setPolling(next.some((job) => job.phase === "running"));
      if (refresh) router.refresh();
    },
    [dismiss, router],
  );

  const announce = useCallback((view: CardJobView) => {
    const job: WatchedCardJob = { ...view, newDeck: !view.deckId };
    watched.current.set(view.id, job);
    setJobs((current) => [...current.filter((j) => j.id !== view.id), job]);
    setPolling(true);
  }, []);

  const retry = useCallback(
    async (job: WatchedCardJob) => {
      const fail = (text: string) =>
        setJobs((current) => current.map((j) => (j.id === job.id ? { ...j, text } : j)));
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
          announce(data.job);
          return;
        }
        fail(data.error ?? "Retry failed");
      } catch {
        fail("Could not reach the server");
      }
    },
    [announce, dismiss],
  );

  // Once on load: a job started before a reload, or on another screen, is still going.
  useEffect(() => {
    fetchJobs().then((views) => views && apply(views));
  }, [apply]);

  useEffect(() => {
    if (!polling) return;
    const tick = () => {
      if (!document.hidden) fetchJobs().then((views) => views && apply(views));
    };
    const timer = setInterval(tick, POLL_MS);
    // Back from another app: catch up at once rather than on the next tick.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [polling, apply]);

  const api = useMemo(() => ({ jobs, announce, dismiss, retry }), [jobs, announce, dismiss, retry]);
  return <CardJobsContext.Provider value={api}>{children}</CardJobsContext.Provider>;
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

/** A small line under a deck's name in the deck list. `indent` lines it up with the name. */
export function DeckRowJobs({ deckId, indent }: { deckId: string; indent: number }) {
  const api = useCardJobs();
  if (!api) return null;
  const jobs = jobsForDeck(api.jobs, deckId);
  if (jobs.length === 0) return null;
  return (
    <div className="-mt-1 flex flex-col items-start gap-1 pr-2 pb-1.5" style={{ paddingLeft: indent }}>
      {jobs.map((job) => (
        <JobLine key={job.id} job={job} text={inlineCardJobText(job)} api={api} small />
      ))}
    </div>
  );
}

/**
 * Placeholder rows for decks still being made, at the top of the deck list.
 * Each turns into the real row once the deck exists and the list has it.
 * Pass `empty` when there is no list yet: shown when there's nothing to hold.
 */
export function NewDeckJobRows({ knownDeckIds, empty }: { knownDeckIds: string[]; empty?: ReactNode }) {
  const api = useCardJobs();
  const known = useMemo(() => new Set(knownDeckIds), [knownDeckIds]);
  const jobs = api ? newDeckJobs(api.jobs, known) : [];
  if (!api || jobs.length === 0) return empty ?? null;
  const rows = jobs.map((job) => (
    <li key={job.id} className="px-1 py-1">
      <JobLine job={job} text={newDeckJobText(job)} api={api} />
    </li>
  ));
  return empty === undefined ? <>{rows}</> : <ul className="rounded-2xl border border-line bg-surface p-1">{rows}</ul>;
}

function JobLine({
  job,
  text,
  api,
  small = false,
}: {
  job: WatchedCardJob;
  text: string;
  api: CardJobsApi;
  small?: boolean;
}) {
  const shell = cn(
    "job-pill-enter flex min-w-0 items-center border bg-surface",
    small ? "max-w-full gap-1.5 rounded-full px-2 py-0.5 text-[11px]" : "w-full gap-2 rounded-xl px-3 py-2 text-sm",
  );
  const icon = small ? "size-3 shrink-0" : "size-4 shrink-0";

  if (job.phase === "running") {
    return (
      <div role="status" className={cn(shell, "job-pill-running border-line", small && "text-muted")}>
        <span className="job-pill-dot size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        <span className="truncate">{text}</span>
      </div>
    );
  }

  if (job.phase === "done") {
    return (
      <div role="status" className={cn(shell, "border-good/40")}>
        <Check className={cn(icon, "text-good")} aria-hidden />
        <span className="truncate">{text}</span>
      </div>
    );
  }

  // Buttons may sit inside a deck row's <summary>: don't let a tap toggle it.
  const press = (action: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return (
    <div role="alert" className={cn(shell, "border-again/40")}>
      <AlertCircle className={cn(icon, "text-again")} aria-hidden />
      <span className={cn("min-w-0 flex-1", small ? "truncate" : "line-clamp-2")}>{text}</span>
      <button type="button" onClick={press(() => api.retry(job))} className="shrink-0 font-semibold text-accent">
        Retry
      </button>
      <button
        type="button"
        onClick={press(() => api.dismiss(job.id))}
        aria-label="Dismiss"
        className={cn(
          "-mr-1.5 flex shrink-0 items-center justify-center rounded-full text-muted active:bg-raised",
          small ? "size-5" : "size-7",
        )}
      >
        <X className={small ? "size-3" : "size-3.5"} aria-hidden />
      </button>
    </div>
  );
}
