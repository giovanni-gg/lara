"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";
import { DirectionPicker, type Direction } from "@/components/direction-picker";

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
  targetName,
  sourceName,
  defaultDirection = "RECOGNITION",
}: {
  deckId?: string;
  targetName: string;
  sourceName: string;
  /** The deck's own default when adding to one. */
  defaultDirection?: Direction;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(15);
  const [direction, setDirection] = useState<Direction>(defaultDirection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || busy) return;

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
          (data.audio ? "" : " — no audio, ELEVENLABS_API_KEY is unset"),
      );
      setPrompt("");
      router.refresh();
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
        placeholder="What do you want to learn?"
        className={`${inputStyles} resize-none`}
        aria-label="Describe the cards to generate"
      />

      <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {SUGGESTIONS.map((suggestion) => (
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

      <DirectionPicker
        target={targetName}
        source={sourceName}
        value={direction}
        onChange={setDirection}
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
        <Button type="submit" size="sm" disabled={busy || !prompt.trim()} className="flex-1">
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
