"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, Loader2 } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";
import { cn } from "@/lib/utils";

const LENGTHS = [
  { value: "short", label: "Short", hint: "~250 words · one scene" },
  { value: "medium", label: "Medium", hint: "~550 words · a few scenes" },
  { value: "long", label: "Long", hint: "~1,100 words · full arc" },
  { value: "epic", label: "Very long", hint: "~2,000 words" },
] as const;

const IDEAS = [
  "a detective who is afraid of the dark",
  "two strangers stuck in a lift",
  "a letter that arrives fifty years late",
  "the last day of a small shop",
  "someone who can hear other people's thoughts, badly",
];

export function GenerateStoryForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [length, setLength] = useState<(typeof LENGTHS)[number]["value"]>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/stories/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), length }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Generation failed");
        return;
      }

      setPrompt("");
      router.push(`/articles/${data.story.id}`);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-4">
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        placeholder="What should the story be about?"
        className={`${inputStyles} resize-none`}
        aria-label="Story idea"
      />

      <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
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

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium">Length</legend>
        <div className="grid grid-cols-2 gap-2">
          {LENGTHS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setLength(option.value)}
              aria-pressed={length === option.value}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors",
                length === option.value
                  ? "border-accent/60 bg-accent/10"
                  : "border-line",
              )}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block text-[11px] text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <Button
        type="submit"
        disabled={busy || !prompt.trim()}
        className="mt-4 w-full min-h-13"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Writing the story…
          </>
        ) : (
          <>
            <BookOpenText className="size-4" aria-hidden />
            Write the story
          </>
        )}
      </Button>

      {busy && (length === "long" || length === "epic") ? (
        <p className="mt-3 text-xs text-muted">
          A story this long takes a minute or two. You can leave this screen —
          it&rsquo;ll be in your library when it&rsquo;s done.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-again">{error}</p> : null}
    </form>
  );
}
