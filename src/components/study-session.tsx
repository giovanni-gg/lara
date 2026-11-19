"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, MessageCircleQuestion, X } from "lucide-react";
import { AudioButton } from "@/components/audio-button";
import { CardChat } from "@/components/card-chat";
import { Button, ButtonLink } from "@/components/ui";
import { prefetch, unlock } from "@/lib/audio-cache";
import { RATING_LABELS, type RatingValue } from "@/lib/srs";
import type { QueueCard } from "@/lib/study";
import { cn } from "@/lib/utils";
import { cardKind, KIND_LABELS, remainingByKind, type CardKind } from "@/lib/study-counts";

// Anki's colours: New blue, Learn red, Due green (as in the deck list).
const KIND_COLORS: Record<CardKind, string> = {
  new: "text-easy",
  learn: "text-again",
  due: "text-good",
};

const RATING_ORDER: RatingValue[] = [1, 2, 3, 4];

/** Cards past the current one whose audio and images are warmed ahead. */
const LOOKAHEAD = 3;

const RATING_STYLES: Record<RatingValue, string> = {
  1: "bg-again/15 text-again border-again/40",
  2: "bg-hard/15 text-hard border-hard/40",
  3: "bg-good/15 text-good border-good/40",
  4: "bg-easy/15 text-easy border-easy/40",
};

/**
 * What the front of a card asks for. CLOZE/TYPING are unused and fall back to
 * recognition; a PICTURE card without an image, or a PRODUCTION card without a
 * prompt to produce from, degrades to the nearest mode it can actually show.
 */
type PromptMode = "recognition" | "production" | "picture";

function promptMode(card: QueueCard): PromptMode {
  if (card.cardType === "PICTURE" && card.imageUrl) return "picture";
  if (
    (card.cardType === "PICTURE" || card.cardType === "PRODUCTION") &&
    card.source.trim()
  ) {
    return "production";
  }
  return "recognition";
}

/** Waits between attempts; after the last, the review counts as lost. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/** A card's schedule after an answer, as /api/reviews reports it. */
type Rescheduled = Pick<QueueCard, "state" | "intervals">;

/**
 * Posts one review, retrying failures with backoff. Every non-2xx is retried:
 * the route reports transient database errors as 400, so status alone can't
 * tell a permanent failure apart. `keepalive` lets it finish if the page is
 * left mid-request. Resolves to the card's new schedule (null if the response
 * lacked one) or "lost" after the last attempt; never rejects.
 */
async function postReview(
  body: string,
  setFailing: (failing: boolean) => void,
): Promise<Rescheduled | null | "lost"> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });
      if (response.ok) {
        setFailing(false);
        // Saved either way; a garbled body must not trigger a duplicate POST.
        const data = await response.json().catch(() => null);
        return (data?.card as Rescheduled | undefined) ?? null;
      }
    } catch {
      // Offline or dropped: retry below.
    }
    setFailing(true);
    if (attempt >= RETRY_DELAYS_MS.length) return "lost";
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

/** Single words read big; whole sentences (40–90 chars) must fit a phone. */
function promptSize(text: string): string {
  const length = text.length;
  if (length <= 14) return "text-4xl";
  if (length <= 28) return "text-3xl";
  if (length <= 48) return "text-2xl";
  return "text-xl";
}

function answerSize(text: string): string {
  const length = text.length;
  if (length <= 24) return "text-2xl";
  if (length <= 48) return "text-xl";
  return "text-lg";
}

export function StudySession({
  cards,
  deckName,
  targetLanguage,
}: {
  cards: QueueCard[];
  deckName: string;
  /** Display name, e.g. "Swedish" — for the "In Swedish?" cue. */
  targetLanguage: string;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [again, setAgain] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  // Stamped in an effect rather than during render — reading the clock while
  // rendering is impure and React lints against it.
  const shownAt = useRef(0);
  // Grading is optimistic: the next card shows at once and reviews post in the
  // background, chained so they reach the server in order, one at a time.
  const outbox = useRef<Promise<void>>(Promise.resolve());
  const [unsent, setUnsent] = useState(0);
  const [failing, setFailing] = useState(false);
  const [lost, setLost] = useState(0);
  // Debounces a double tap: the second would grade the same card again. By
  // object, not id or position: a relearning card returns as a new object.
  const graded = useRef<QueueCard | null>(null);

  // The session's queue: the server's cards plus any answered Again (still
  // learning) appended at the end, Anki-style. Re-seeded when "Study more"
  // brings new props — adjusted during render, which React allows for state
  // derived from props, rather than in an effect.
  const [seed, setSeed] = useState(cards);
  const [queue, setQueue] = useState(cards);
  if (seed !== cards) {
    setSeed(cards);
    setQueue(cards);
    setIndex(0);
    setRevealed(false);
    setAnswered(0);
    setAgain(0);
  }

  const card = queue[index] as QueueCard | undefined;
  // Not done while answers are in flight: one may yet come back as learning.
  const done = !card && unsent === 0;

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  // iOS starts audio suspended until a gesture. Resuming on every tap (a no-op
  // once running) unlocks it on the first one and recovers after a phone call
  // or app switch suspends it again. Capture phase, so AudioButton's
  // stopPropagation can't hide its taps. touchend/click/keydown are what
  // WebKit counts as gestures; pointerdown on touch is not.
  useEffect(() => {
    const events = ["touchend", "click", "keydown"] as const;
    for (const type of events) window.addEventListener(type, unlock, true);
    return () => {
      for (const type of events) window.removeEventListener(type, unlock, true);
    };
  }, []);

  // Warm what's coming: decoded audio for this card and the next few (so
  // autoplay on change or reveal starts instantly), and the next pictures.
  // The current card first — its fetch matters most.
  useEffect(() => {
    for (const upcoming of queue.slice(index, index + 1 + LOOKAHEAD)) {
      prefetch(upcoming.audioUrl);
      prefetch(upcoming.sentenceAudioUrl);
      if (upcoming !== queue[index] && upcoming.imageUrl) {
        preload(upcoming.imageUrl, { as: "image" });
      }
    }
  }, [queue, index]);

  const answer = useCallback(
    (rating: RatingValue) => {
      if (!card || graded.current === card) return;
      graded.current = card;

      const durationMs = shownAt.current ? Date.now() - shownAt.current : undefined;
      const body = JSON.stringify({ cardId: card.id, rating, durationMs });
      setUnsent((n) => n + 1);
      outbox.current = outbox.current.then(async () => {
        const result = await postReview(body, setFailing);
        if (result === "lost") setLost((n) => n + 1);
        // Still on minute-scale steps: it comes back before the session ends.
        else if (result?.state === "LEARNING" || result?.state === "RELEARNING") {
          const relearn = { ...card, state: result.state, intervals: result.intervals };
          setQueue((current) => [...current, relearn]);
        }
        setUnsent((n) => n - 1);
      });

      setAnswered((n) => n + 1);
      if (rating === 1) setAgain((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [card],
  );

  // Desktop keyboard shortcuts: space reveals, 1-4 grades. Suspended while the
  // chat sheet is open, or typing a question would grade the card.
  useEffect(() => {
    if (chatOpen) return;
    function onKey(event: KeyboardEvent) {
      if (!card) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;
      const rating = Number(event.key);
      if (rating >= 1 && rating <= 4) {
        answer(rating as RatingValue);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, revealed, card, chatOpen]);

  // Never lose an answer silently.
  const notice =
    failing && unsent > 0 ? (
      <p role="status" className="text-center text-xs text-hard">
        {unsent} {unsent === 1 ? "answer" : "answers"} not saved yet — retrying
      </p>
    ) : lost > 0 ? (
      <p role="status" className="text-center text-xs text-again">
        {lost} {lost === 1 ? "answer" : "answers"} couldn&apos;t be saved
      </p>
    ) : null;

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
          {notice}
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button
            onClick={async () => {
              // Refreshing before the outbox drains could serve cards that
              // were just answered but not yet saved. The new cards re-seed
              // the queue when they arrive.
              await outbox.current;
              router.refresh();
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

  // Past the last card with answers still in flight: one may come back as
  // learning, so hold the done screen until they've all landed.
  if (!card) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted">Saving answers…</p>
        {notice}
      </div>
    );
  }

  const progress = (index / queue.length) * 100;
  const counts = remainingByKind(queue, index);
  const mode = promptMode(card);
  // Naming the target before reveal would spoil production/picture cards.
  const chatLabel =
    mode === "recognition" || revealed
      ? `Ask about ${card.target}`
      : "Ask about this card";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-safe">
      {/* Progress + exit */}
      <div className="flex items-center gap-3 py-2">
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
          aria-valuemax={queue.length}
          aria-label="Session progress"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="w-12 text-right text-xs tabular-nums text-muted">
          {index + 1}/{queue.length}
        </span>
        {/* Always reachable, never in the way, and it doesn't spoil the answer. */}
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label={chatLabel}
          className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
        >
          <MessageCircleQuestion className="size-5" aria-hidden />
        </button>
      </div>

      <p className="text-center text-[11px] uppercase tracking-wide text-muted">
        {card.deckName || deckName}
      </p>
      {/* Anki's New · Learn · Due, with this card's kind underlined. */}
      <p
        className="flex items-center justify-center gap-2 pb-1 text-xs tabular-nums"
        aria-label={`${KIND_LABELS[cardKind(card)]}. Left: ${counts.new} new, ${counts.learn} learning, ${counts.due} due`}
      >
        {(["new", "learn", "due"] as const).map((kind) => (
          <span
            key={kind}
            className={cn(
              counts[kind] > 0 ? KIND_COLORS[kind] : "text-muted/40",
              cardKind(card) === kind && "font-semibold underline underline-offset-4",
            )}
          >
            {counts[kind]}
          </span>
        ))}
        <span className="text-muted">· {KIND_LABELS[cardKind(card)]}</span>
      </p>
      {notice}

      {/* The card. Tap anywhere to reveal. A div, not a <button>: it contains
          audio buttons, and nested buttons are invalid HTML (the parser splits
          them, which breaks hydration). Keyboard users have space/Enter and the
          Show answer button below. */}
      <div
        // Prefixed: CardChat below is a sibling keyed by the bare card.id.
        key={`card-${card.id}-${index}`}
        onClick={() => setRevealed(true)}
        className={cn(
          "flex flex-1 items-center justify-center py-1",
          !revealed && "cursor-pointer",
        )}
      >
        <div className="w-full">
          <Prompt
            card={card}
            mode={mode}
            revealed={revealed}
            targetLanguage={targetLanguage}
          />

          {/* Answer. Always mounted so the prompt doesn't jump on reveal; inert
              until then so its controls can't be tabbed to or read out early. */}
          <div
            className={cn(
              "mt-4 border-t border-line pt-4 text-center transition-opacity duration-200",
              revealed ? "opacity-100" : "opacity-0",
            )}
            inert={!revealed}
          >
            {mode === "recognition" ? (
              <p className={cn("font-medium leading-snug break-words", answerSize(card.source))}>
                {card.source}
              </p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p
                  className={cn(
                    "font-display font-semibold leading-tight break-words",
                    promptSize(card.target),
                  )}
                >
                  {card.target}
                </p>
                {/* Target audio belongs to the answer here: playing it on the
                    prompt would give the answer away. */}
                <AudioButton
                  src={card.audioUrl}
                  label={`Hear ${card.target}`}
                  autoPlay={revealed}
                  size="sm"
                />
                {mode === "picture" && card.source ? (
                  <p className="text-base leading-snug text-muted break-words">
                    {card.source}
                  </p>
                ) : null}
              </div>
            )}

            {card.targetSentence ? (
              <div className="mt-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left">
                <div className="flex items-start gap-2">
                  <p className="font-display flex-1 text-base leading-snug">
                    {card.targetSentence}
                  </p>
                  <AudioButton
                    src={card.sentenceAudioUrl}
                    label="Hear the example sentence"
                    size="sm"
                  />
                </div>
                {card.sourceSentence ? (
                  <p className="mt-1 text-sm leading-snug text-muted">
                    {card.sourceSentence}
                  </p>
                ) : null}
              </div>
            ) : null}

            {card.notes ? (
              <p className="mt-3 whitespace-pre-line text-left text-sm leading-snug text-muted">
                <Check className="mr-1 inline size-4 text-good" aria-hidden />
                {card.notes}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* The natural moment to ask is right after seeing the answer, so repeat
          the affordance here as a labelled target rather than a bare icon. */}
      {revealed ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="mx-auto mb-1 inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-sm text-muted active:border-accent/60"
        >
          <MessageCircleQuestion className="size-4" aria-hidden />
          Ask about this card
        </button>
      ) : null}

      {/* Controls */}
      <div className="sticky bottom-0 bg-background/95 pb-safe pt-2 backdrop-blur">
        {revealed ? (
          <div className="grid grid-cols-4 gap-2">
            {RATING_ORDER.map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => answer(rating)}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-semibold transition-transform active:scale-95",
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

/** The front of the card: what the learner sees before tapping. */
function Prompt({
  card,
  mode,
  revealed,
  targetLanguage,
}: {
  card: QueueCard;
  mode: PromptMode;
  revealed: boolean;
  targetLanguage: string;
}) {
  if (mode === "picture") {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        {/* Plain <img>: media comes from our own /api/media route with unknown
            intrinsic size, and the optimizer would only add a hop. alt is
            deliberately generic — describing the picture would be the answer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.imageUrl!}
          alt="Picture to name"
          decoding="async"
          className={cn(
            "mx-auto w-auto max-w-full rounded-xl object-contain transition-[max-height] duration-200",
            // Shrink once answered so the answer fits without scrolling.
            revealed ? "max-h-[28dvh]" : "max-h-[40dvh]",
          )}
        />
        <AskCue targetLanguage={targetLanguage} />
      </div>
    );
  }

  if (mode === "production") {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p
          className={cn(
            "font-display font-semibold leading-tight break-words",
            promptSize(card.source),
          )}
        >
          {card.source}
        </p>
        <AskCue targetLanguage={targetLanguage} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p
        className={cn(
          "font-display font-semibold leading-tight break-words",
          promptSize(card.target),
        )}
      >
        {card.target}
      </p>
      {/* Autoplays on the prompt only; flipping autoPlay to false on reveal
          doesn't replay, and the answer side has no target audio here. */}
      <AudioButton
        src={card.audioUrl}
        label={`Hear ${card.target}`}
        autoPlay={!revealed}
        size="md"
      />
    </div>
  );
}

function AskCue({ targetLanguage }: { targetLanguage: string }) {
  return (
    <p className="text-xs uppercase tracking-wide text-muted">
      In {targetLanguage}?
    </p>
  );
}
