"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, MessageCircleQuestion, X } from "lucide-react";
import { AudioButton } from "@/components/audio-button";
import { CardChat } from "@/components/card-chat";
import { Button, ButtonLink } from "@/components/ui";
import { RATING_LABELS, type RatingValue } from "@/lib/srs";
import type { QueueCard } from "@/lib/study";
import { cn } from "@/lib/utils";

const RATING_ORDER: RatingValue[] = [1, 2, 3, 4];

const RATING_STYLES: Record<RatingValue, string> = {
  1: "bg-again/15 text-again border-again/40",
  2: "bg-hard/15 text-hard border-hard/40",
  3: "bg-good/15 text-good border-good/40",
  4: "bg-easy/15 text-easy border-easy/40",
};

export function StudySession({
  cards,
  deckName,
}: {
  cards: QueueCard[];
  deckName: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [again, setAgain] = useState(0);
  const [pending, setPending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Stamped in an effect rather than during render — reading the clock while
  // rendering is impure and React lints against it.
  const shownAt = useRef(0);

  const card = cards[index];
  const done = index >= cards.length;

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const answer = useCallback(
    async (rating: RatingValue) => {
      if (!card || pending) return;
      setPending(true);

      const durationMs = shownAt.current ? Date.now() - shownAt.current : undefined;
      try {
        await fetch("/api/reviews", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cardId: card.id, rating, durationMs }),
        });
      } catch {
        // Offline or a dropped request: keep the session moving rather than
        // stranding the learner. The card stays due and comes back next time.
      }

      setAnswered((n) => n + 1);
      if (rating === 1) setAgain((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
      setPending(false);
    },
    [card, pending],
  );

  // Desktop keyboard shortcuts: space reveals, 1-4 grades. Suspended while the
  // chat sheet is open, or typing a question would grade the card.
  useEffect(() => {
    if (chatOpen) return;
    function onKey(event: KeyboardEvent) {
      if (done) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;
      const rating = Number(event.key);
      if (rating >= 1 && rating <= 4) {
        void answer(rating as RatingValue);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, revealed, done, chatOpen]);

  if (done) {
    const recalled = answered - again;
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="font-display text-5xl">🎉</div>
        <div>
          <h1 className="font-display text-3xl font-semibold">Session done</h1>
          <p className="mt-2 text-sm text-muted">
            {answered} {answered === 1 ? "card" : "cards"} reviewed
            {answered > 0
              ? ` · ${Math.round((recalled / answered) * 100)}% recalled`
              : ""}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button
            onClick={() => {
              router.refresh();
              setIndex(0);
              setAnswered(0);
              setAgain(0);
            }}
          >
            Study more
          </Button>
          <ButtonLink href="/" variant="secondary">
            Back to today
          </ButtonLink>
        </div>
      </div>
    );
  }

  const progress = (index / cards.length) * 100;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-safe">
      {/* Progress + exit */}
      <div className="flex items-center gap-3 py-3">
        <Link
          href="/"
          aria-label="End session"
          className="-ml-1 flex size-9 items-center justify-center rounded-full text-muted active:bg-raised"
        >
          <X className="size-5" aria-hidden />
        </Link>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={cards.length}
          aria-label="Session progress"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="w-12 text-right text-xs tabular-nums text-muted">
          {index + 1}/{cards.length}
        </span>
        {/* Always reachable, never in the way, and it doesn't spoil the answer. */}
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label={`Ask about ${card.target}`}
          className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
        >
          <MessageCircleQuestion className="size-5" aria-hidden />
        </button>
      </div>

      <p className="pb-3 text-center text-xs uppercase tracking-wide text-muted">
        {card.deckName || deckName}
        {card.state === "NEW" ? " · new" : ""}
      </p>

      {/* The card. Tap anywhere to reveal. */}
      <button
        type="button"
        onClick={() => setRevealed(true)}
        disabled={revealed}
        className="flex flex-1 items-center justify-center py-2 disabled:cursor-default"
        aria-label={revealed ? "Answer shown" : "Show answer"}
      >
        <div className="w-full">
          {/* Prompt */}
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="font-display text-4xl font-semibold leading-tight break-words">
              {card.target}
            </p>
            <AudioButton
              src={card.audioUrl}
              label={`Hear ${card.target}`}
              autoPlay={!revealed}
              size="md"
            />
          </div>

          {/* Answer */}
          <div
            className={cn(
              "mt-8 border-t border-line pt-6 text-center transition-opacity duration-200",
              revealed ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden={!revealed}
          >
            <p className="text-2xl font-medium">{card.source}</p>

            {card.targetSentence ? (
              <div className="mt-6 rounded-2xl border border-line bg-surface p-4 text-left">
                <div className="flex items-start gap-3">
                  <p className="font-display flex-1 text-lg leading-snug">
                    {card.targetSentence}
                  </p>
                  <AudioButton
                    src={card.sentenceAudioUrl}
                    label="Hear the example sentence"
                    size="sm"
                  />
                </div>
                {card.sourceSentence ? (
                  <p className="mt-2 text-sm text-muted">{card.sourceSentence}</p>
                ) : null}
              </div>
            ) : null}

            {card.notes ? (
              <p className="mt-4 text-left text-sm text-muted">
                <Check className="mr-1 inline size-4 text-good" aria-hidden />
                {card.notes}
              </p>
            ) : null}
          </div>
        </div>
      </button>

      {/* The natural moment to ask is right after seeing the answer, so repeat
          the affordance here as a labelled target rather than a bare icon. */}
      {revealed ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-muted active:border-accent/60"
        >
          <MessageCircleQuestion className="size-4" aria-hidden />
          Ask about this card
        </button>
      ) : null}

      {/* Controls */}
      <div className="sticky bottom-0 bg-background/95 pb-safe pt-3 backdrop-blur">
        {revealed ? (
          <div className="grid grid-cols-4 gap-2">
            {RATING_ORDER.map((rating) => (
              <button
                key={rating}
                type="button"
                disabled={pending}
                onClick={() => void answer(rating)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-semibold transition-transform active:scale-95 disabled:opacity-50",
                  RATING_STYLES[rating],
                )}
              >
                {RATING_LABELS[rating]}
                <span className="text-[11px] font-normal opacity-70 tabular-nums">
                  {card.intervals[rating]}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Button className="w-full min-h-14" onClick={() => setRevealed(true)}>
            Show answer
          </Button>
        )}
      </div>

      {/* key remounts the sheet per card, clearing the previous thread. */}
      <CardChat
        key={card.id}
        card={card}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
