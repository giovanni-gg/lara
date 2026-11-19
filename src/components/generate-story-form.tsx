"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Headphones, Loader2 } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";
import { cn } from "@/lib/utils";

const LENGTHS = [
  { value: "short", label: "Short", hint: "~250 words · 2 min" },
  { value: "medium", label: "Medium", hint: "~550 words · 4 min" },
  { value: "long", label: "Long", hint: "~1,100 words · 8 min" },
  { value: "epic", label: "Very long", hint: "~2,000 words · 15 min" },
] as const;

const IDEAS = [
  "a detective who is afraid of the dark",
  "two strangers stuck in a lift",
  "a letter that arrives fifty years late",
  "the last day of a small shop",
  "a morning at a city market",
  "someone moving to a new country",
];

export type StoryDeckOption = {
  id: string;
  /** Full path, "Nouns · Abstract". */
  label: string;
  depth: number;
  cards: number;
};

export function GenerateStoryForm({
  decks,
  defaultDeckId,
}: {
  decks: StoryDeckOption[];
  defaultDeckId?: string;
}) {
  const router = useRouter();
  const [deckId, setDeckId] = useState(defaultDeckId ?? "");
  const [prompt, setPrompt] = useState("");
  const [length, setLength] = useState<(typeof LENGTHS)[number]["value"]>("short");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/stories/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim() || undefined,
          length,
          deckId: deckId || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Generation failed");
        setBusy(false);
        return;
      }

      // Queued: it's written server-side, so go back to the library, where it
      // shows as "Writing…" and appears when ready. Busy stays on through the
      // navigation, so the button can't fire twice.
      router.push("/articles");
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Words from</span>
        <select
          value={deckId}
          onChange={(event) => setDeckId(event.target.value)}
          className={inputStyles}
        >
          <option value="">All my cards</option>
          {decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {"  ".repeat(deck.depth)}
              {deck.label} ({deck.cards})
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted">
          {deckId
            ? "Built around this deck's words, subdecks included, plus a few new ones."
            : "Built from the words you've studied, plus a few new ones."}
        </span>
      </label>

      <div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder={
            deckId ? "Anything it should be about? (optional)" : "What should it be about? (optional)"
          }
          className={`${inputStyles} resize-none`}
          aria-label="Story idea"
        />
        <div className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setPrompt(idea)}
              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-muted active:border-accent/60"
            >
              {idea}
            </button>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Length</legend>
        <div className="grid grid-cols-2 gap-2">
          {LENGTHS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setLength(option.value)}
              aria-pressed={length === option.value}
              className={cn(
                "rounded-xl border px-3 py-2 text-left transition-colors",
                length === option.value ? "border-accent/60 bg-accent/10" : "border-line",
              )}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block text-[11px] text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <Button type="submit" disabled={busy} className="w-full min-h-13">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Writing the story…
          </>
        ) : (
          <>
            <Headphones className="size-4" aria-hidden />
            Write the story
          </>
        )}
      </Button>

      {busy ? (
        <p className="text-xs text-muted">
          {length === "long" || length === "epic"
            ? "A story this long takes a minute or two. You can leave this screen; it'll be in Listen & Read when it's done."
            : "This takes about half a minute, audio included."}
        </p>
      ) : null}
      {error ? <p className="text-sm text-again">{error}</p> : null}
    </form>
  );
}
