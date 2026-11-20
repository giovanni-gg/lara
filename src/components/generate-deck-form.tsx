"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";
import { DirectionPicker, pickerDirection, type Direction } from "@/components/direction-picker";
import type { CardDirection } from "@/generated/prisma/enums";

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
 */
export function GenerateDeckForm({
  deckId,
  deckName,
  targetName,
  sourceName,
  defaultDirection = "RECOGNITION",
  picturesAvailable = true,
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
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(15);
  const [direction, setDirection] = useState<Direction>(pickerDirection(defaultDirection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    setResult(null);

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

      setResult(
        `Added ${data.created} card${data.created === 1 ? "" : "s"} to ${data.deck.name}` +
          (data.skipped > 0 ? ` (${data.skipped} duplicate skipped)` : "") +
          (data.audio ? "" : " — no audio, ELEVENLABS_API_KEY is unset") +
          (data.pictures === "drawing" ? ". Pictures are being drawn and appear in a minute or two." : "") +
          (data.pictures === "unavailable" ? " — no pictures, GEMINI_API_KEY is unset" : ""),
      );
      setPrompt("");
      // A brand-new deck: open it. Adding to an existing deck: stay and refresh.
      if (!deckId) {
        router.push(`/decks/${data.deck.id}`);
        return;
      }
      router.refresh();
      // The deck grew: its chips may be rewritten for what it now covers.
      setChipsVersion((v) => v + 1);
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
              Writing…
            </>
          ) : (
            <>
              <Wand2 className="size-4" aria-hidden />
              Generate
            </>
          )}
        </Button>
      </div>

      {busy ? (
        <p className="mt-2 text-xs text-muted">
          Writing cards and recording audio — this takes a few seconds per card.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-again">{error}</p> : null}
      {result ? <p className="mt-2 text-sm text-good">{result}</p> : null}
    </form>
  );
}
