"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";
import { DirectionPicker, pickerDirection, type Direction } from "@/components/direction-picker";
import { onCardJobFinished, useCardJobs } from "@/components/card-jobs";
import type { CardDirection } from "@/generated/prisma/enums";
import { DAILY_CARD_LIMIT } from "@/lib/limits";

/** Topics for a brand-new deck. Inside a deck the chips come from the deck itself. */
const SUGGESTIONS = [
  "ordering food at a restaurant",
  "50 most common verbs",
  "talking about the weather",
  "at the doctor's office",
  "phrases for a job interview",
];

/**
 * Prompt-to-deck. This is the whole point of moving off the desktop script:
 * describe what you want, get cards with audio, study immediately.
 *
 * Never blocks: the route queues a job and answers at once, the cards are made
 * server-side, and the decks section follows it inline (card-jobs.tsx): at
 * the top of the deck and under this form, or as a placeholder row in the
 * deck list for a new deck.
 */
export function GenerateDeckForm({
  deckId,
  deckName,
  targetName,
  sourceName,
  defaultDirection = "RECOGNITION",
  picturesAvailable = true,
  cardsLeft = null,
}: {
  deckId?: string;
  /** The deck being added to, named in the placeholder. */
  deckName?: string;
  targetName: string;
  sourceName: string;
  /** The deck's own default when adding to one. */
  defaultDirection?: CardDirection;
  /** False when the server can't draw pictures (no GEMINI_API_KEY). */
  picturesAvailable?: boolean;
  /** Today's allowance when the page loaded (limits.ts); null for the owner, who has none. */
  cardsLeft?: number | null;
}) {
  const router = useRouter();
  const cardJobs = useCardJobs();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(15);
  const [direction, setDirection] = useState<Direction>(pickerDirection(defaultDirection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In an existing deck the deck says what to make; the prompt only refines it.
  const ready = deckId ? true : prompt.trim().length >= 3;

  // A deck's chips are written from the deck by the AI (cached server-side),
  // fetched after render so the page never waits on them. null = loading;
  // [] = none to show (no AI, or it failed).
  const [chips, setChips] = useState<string[] | null>(deckId ? null : SUGGESTIONS);
  const [chipsVersion, setChipsVersion] = useState(0);
  useEffect(() => {
    if (!deckId) return;
    const controller = new AbortController();
    fetch(`/api/decks/${deckId}/suggestions`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { suggestions: [] }))
      .then((data: { suggestions?: string[] }) => setChips(data.suggestions ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setChips([]);
      });
    return () => controller.abort();
  }, [deckId, chipsVersion]);

  // The deck grew: its chips may be rewritten for what it now covers.
  useEffect(() => {
    if (!deckId) return;
    return onCardJobFinished((finished) => {
      if (finished === deckId) setChipsVersion((v) => v + 1);
    });
  }, [deckId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/decks/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), count, deckId, direction }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Generation failed");
        return;
      }

      // Queued: the inline status takes it from here. In a deck it shows on
      // this page; a brand-new deck is a placeholder row in the list until
      // the model has named it.
      cardJobs?.announce(data.job);
      setPrompt("");
      if (!deckId) router.push("/decks");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-3">
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        placeholder={
          deckId
            ? `More ${deckName ?? "of this deck"} — or narrow it down${chips?.[0] ? `, e.g. ${chips[0]}` : ""}`
            : "What do you want to learn?"
        }
        className={`${inputStyles} resize-none`}
        aria-label="Describe the cards to generate"
      />

      {chips === null ? (
        <div className="mt-2 flex gap-1.5 pb-0.5" aria-hidden>
          {["w-16", "w-20", "w-14"].map((width) => (
            <span key={width} className={`h-[26px] ${width} shrink-0 animate-pulse rounded-full border border-line`} />
          ))}
        </div>
      ) : chips.length > 0 ? (
        <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {chips.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setPrompt(suggestion)}
              className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted active:border-accent/60"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <DirectionPicker
        target={targetName}
        source={sourceName}
        value={direction}
        onChange={setDirection}
        picturesAvailable={picturesAvailable}
        className="mt-2"
      />

      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          Cards
          <select
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-foreground"
          >
            {[5, 10, 15, 25, 40].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={busy || !ready} className="flex-1">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Starting…
            </>
          ) : (
            <>
              <Wand2 className="size-4" aria-hidden />
              Generate
            </>
          )}
        </Button>
      </div>

      {cardsLeft !== null ? (
        <p className="mt-2 text-xs text-muted">
          {cardsLeft} of {DAILY_CARD_LIMIT} cards left today
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-again">{error}</p> : null}
    </form>
  );
}
