"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { Button, inputStyles } from "@/components/ui";

const TOPICS = [
  "a morning at a city market",
  "someone moving to a new country",
  "a small argument between neighbours",
  "how the seasons change here",
  "a job that no longer exists",
];

export function GenerateArticleForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [wordCount, setWordCount] = useState(180);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!topic.trim() || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/articles/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), wordCount }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Generation failed");
        return;
      }

      setTopic("");
      router.push(`/articles/${data.article.id}`);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-4">
      <textarea
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        rows={2}
        placeholder="What should it be about?"
        className={`${inputStyles} resize-none`}
        aria-label="Article topic"
      />

      <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {TOPICS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setTopic(suggestion)}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-muted active:border-accent/60"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          Length
          <select
            value={wordCount}
            onChange={(event) => setWordCount(Number(event.target.value))}
            className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-foreground"
          >
            <option value={100}>Short</option>
            <option value={180}>Medium</option>
            <option value={320}>Long</option>
            <option value={500}>Very long</option>
          </select>
        </label>
        <Button type="submit" disabled={busy || !topic.trim()} className="flex-1">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Writing…
            </>
          ) : (
            <>
              <PenLine className="size-4" aria-hidden />
              Write it
            </>
          )}
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-again">{error}</p> : null}
    </form>
  );
}
