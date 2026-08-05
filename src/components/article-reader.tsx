"use client";

import { useState, useTransition } from "react";
import { Check, Languages, Loader2, Volume2, VolumeX } from "lucide-react";
import { markArticleRead, saveWordFromArticle } from "@/app/actions";
import { AudioButton } from "@/components/audio-button";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { CefrLevel } from "@/generated/prisma/enums";

type Segment = {
  id: string;
  index: number;
  target: string;
  translation: string;
  audioUrl: string | null;
};

type Article = {
  id: string;
  title: string;
  titleTranslated: string | null;
  level: CefrLevel;
  wordCount: number;
  audioUrl: string | null;
  readAt: Date | null;
  newVocabulary: string[];
  segments: Segment[];
};

/**
 * The reader. Two things make this work as immersion rather than translation
 * practice: translations stay hidden until you tap a sentence, and any new word
 * can become a flashcard without leaving the page.
 */
export function ArticleReader({ article }: { article: Article }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [read, setRead] = useState(Boolean(article.readAt));
  const [pending, startTransition] = useTransition();

  function toggleSegment(id: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <article className="pb-8">
      <header className="pt-4 pb-6">
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">
          {article.title}
        </h1>
        {article.titleTranslated ? (
          <p className="mt-2 text-sm text-muted">{article.titleTranslated}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge className="border-accent/50 text-accent">{article.level}</Badge>
          <Badge>{article.wordCount} words</Badge>
          <AudioButton
            src={article.audioUrl}
            label="Listen to the whole article"
            size="sm"
          />
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              showAll
                ? "border-accent/50 text-accent"
                : "border-line text-muted",
            )}
          >
            <Languages className="size-3.5" aria-hidden />
            {showAll ? "Hide translations" : "Show all"}
          </button>
        </div>
      </header>

      {/* Body: tap a sentence to see its translation, with audio per sentence. */}
      <div className="space-y-1">
        {article.segments.map((segment) => {
          const open = showAll || revealed.has(segment.id);
          return (
            <div key={segment.id}>
              <button
                type="button"
                onClick={() => toggleSegment(segment.id)}
                className={cn(
                  "w-full rounded-lg px-2 py-1.5 text-left transition-colors",
                  open ? "bg-raised" : "active:bg-raised/60",
                )}
                aria-expanded={open}
              >
                <span className="font-display text-lg leading-relaxed">
                  {segment.target}
                </span>
              </button>
              {open ? (
                <div className="flex items-start gap-2 px-2 pb-2">
                  <p className="flex-1 text-sm text-muted">
                    {segment.translation}
                  </p>
                  <SentenceAudio segment={segment} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* The "+1": the words this text introduced on purpose. */}
      {article.newVocabulary.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-base font-semibold">
            New in this text
          </h2>
          <p className="mt-1 text-xs text-muted">
            Tap to add to your &ldquo;From reading&rdquo; deck.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {article.newVocabulary.map((word) => (
              <SaveWordChip key={word} word={word} />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8">
        {read ? (
          <p className="flex items-center justify-center gap-2 text-sm text-good">
            <Check className="size-4" aria-hidden />
            Marked as read
          </p>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await markArticleRead(article.id);
                setRead(true);
              })
            }
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Mark as read
          </Button>
        )}
      </div>
    </article>
  );
}

/**
 * Sentence-level audio. Synthesised the first time it's requested rather than
 * up front — a 2,000-word story would otherwise mean 150 TTS calls at write
 * time, most of which are never played.
 */
function SentenceAudio({ segment }: { segment: Segment }) {
  const [audioUrl, setAudioUrl] = useState(segment.audioUrl);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  if (audioUrl) {
    return (
      <AudioButton
        src={audioUrl}
        size="sm"
        autoPlay
        label="Replay this sentence"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={state === "loading"}
      onClick={async () => {
        setState("loading");
        try {
          const response = await fetch(`/api/segments/${segment.id}/audio`, {
            method: "POST",
          });
          const data = await response.json();
          if (!response.ok) {
            setState("error");
            return;
          }
          // Setting the URL swaps in AudioButton with autoPlay, so the tap that
          // requested the audio also plays it.
          setAudioUrl(data.audioUrl);
        } catch {
          setState("error");
        }
      }}
      aria-label="Hear this sentence"
      title={state === "error" ? "Audio unavailable" : "Hear this sentence"}
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-muted active:border-accent/60 disabled:opacity-50"
    >
      {state === "loading" ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : state === "error" ? (
        <VolumeX className="size-3.5" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

function SaveWordChip({ word }: { word: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  return (
    <li>
      <button
        type="button"
        disabled={state !== "idle"}
        onClick={async () => {
          setState("saving");
          // The translation is filled in by the card generator later; storing
          // the word itself is enough to not lose it mid-read.
          await saveWordFromArticle(word, "");
          setState("saved");
        }}
        className={cn(
          "font-display inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
          state === "saved"
            ? "border-good/50 text-good"
            : "border-line text-foreground active:border-accent/60",
        )}
      >
        {state === "saving" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : state === "saved" ? (
          <Check className="size-3.5" aria-hidden />
        ) : null}
        {word}
      </button>
    </li>
  );
}
