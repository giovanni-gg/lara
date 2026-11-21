"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { Check, CirclePause, Ellipsis, MessageCircleQuestion, X } from "lucide-react";
import { AudioButton } from "@/components/audio-button";
import { CardChat } from "@/components/card-chat";
import { DeckTransition } from "@/components/deck-transition";
import { Button, ButtonLink } from "@/components/ui";
import { UndoButton } from "@/components/undo-button";
import { prefetch, unlock } from "@/lib/audio-cache";
import { RATING_LABELS, type RatingValue } from "@/lib/srs";
import type { QueueCard } from "@/lib/study";
import { cn } from "@/lib/utils";
import { cardKind, KIND_LABELS, remainingByKind, type CardKind } from "@/lib/study-counts";
import { deckBoundary, requeueInBlock } from "@/lib/study-order";
import {
  pushCapped,
  removeCard,
  restoreAnswered,
  restoreRemoved,
  type Removed,
} from "@/lib/study-undo";

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

/** Waits between attempts; after the last, the request counts as lost. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/** A card's schedule after an answer, as /api/reviews reports it. */
type Rescheduled = Pick<QueueCard, "state" | "intervals">;

type Posted = { data: unknown } | { refused: 404 | 409 } | "lost";

/**
 * Posts JSON, retrying failures with backoff. Retried: every non-2xx but 404
 * and 409 — /api/reviews reports transient database errors as 400, so status
 * alone can't tell a permanent failure apart, while 404/409 come only from
 * the undo and pause routes, meaning "nothing there" and "can't". `keepalive`
 * lets it finish if the page is left mid-request. Resolves to the parsed body
 * (null if garbled), the refusal, or "lost" after the last attempt; never
 * rejects.
 */
async function post(
  url: string,
  body: string,
  setFailing: (failing: boolean) => void,
): Promise<Posted> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });
      if (response.ok) {
        setFailing(false);
        // Saved either way; a garbled body must not trigger a duplicate POST.
        return { data: await response.json().catch(() => null) };
      }
      if (response.status === 404 || response.status === 409) {
        setFailing(false);
        return { refused: response.status };
      }
    } catch {
      // Offline or dropped: retry below.
    }
    setFailing(true);
    if (attempt >= RETRY_DELAYS_MS.length) return "lost";
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

/**
 * One step undo can take back: an answer or a pause, with what the screen
 * looked like just before it.
 */
type Step = {
  id: number;
  /** The card object that was on screen (relearn copies are new objects). */
  card: QueueCard;
  index: number;
  revealed: boolean;
  continuedTo: QueueCard | null;
} & (
  | { kind: "answer"; rating: RatingValue }
  | { kind: "pause"; removed: Removed<QueueCard>[] }
);

/** A step's request, as the outbox gets to it. Mutated by the outbox and undo. */
type Sync = {
  /** The request has gone out (or is going): undoing it takes another request. */
  started: boolean;
  /** Undone: skipped if not started yet, and an answer won't re-queue. */
  undone: boolean;
  /** It never reached the server. */
  lost: boolean;
  /** Answers: the saved review, to undo by. */
  reviewId: string | null;
  /** Answers: the copy re-queued for relearning, to take back out. */
  relearn: QueueCard | null;
};

const newSync = (): Sync => ({
  started: false,
  undone: false,
  lost: false,
  reviewId: null,
  relearn: null,
});

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
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [again, setAgain] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Stamped in an effect rather than during render — reading the clock while
  // rendering is impure and React lints against it.
  const shownAt = useRef(0);
  // Grading is optimistic: the next card shows at once and reviews post in the
  // background, chained so they reach the server in order, one at a time.
  // Undos and pauses go through the same chain, so they land in order too.
  const outbox = useRef<Promise<void>>(Promise.resolve());
  const [unsent, setUnsent] = useState(0);
  const [failing, setFailing] = useState(false);
  const [lost, setLost] = useState(0);
  // Undos and pauses that couldn't be saved.
  const [lostChanges, setLostChanges] = useState(0);
  // Debounces a double tap: the second would grade the same card again. By
  // object, not id or position: a relearning card returns as a new object.
  const graded = useRef<QueueCard | null>(null);
  // The card on screen, for answers that land after the learner moved on.
  const position = useRef(0);
  // The first card of a deck the learner chose to carry on into (by object,
  // as above): once it's this card, the between-decks screen is passed.
  const [continuedTo, setContinuedTo] = useState<QueueCard | null>(null);
  // What undo can step back over, newest last; each step's request state is
  // kept beside it, by id, for the outbox to update.
  const [history, setHistory] = useState<Step[]>([]);
  const syncs = useRef(new Map<number, Sync>());
  const nextStepId = useRef(0);

  // The session's queue: the server's cards, deck by deck, plus any answered
  // Again (still learning) at the end of their deck's block, Anki-style.
  // Re-seeded if the page renders with a new queue — adjusted during render,
  // which React allows for state derived from props, rather than in an effect.
  const [seed, setSeed] = useState(cards);
  const [queue, setQueue] = useState(cards);
  if (seed !== cards) {
    setSeed(cards);
    setQueue(cards);
    setIndex(0);
    setRevealed(false);
    setAnswered(0);
    setAgain(0);
    setHistory([]);
  }

  const card = queue[index] as QueueCard | undefined;
  // Not done while answers are in flight: one may yet come back as learning.
  const done = !card && unsent === 0;
  // The first card of the next deck, not yet continued into: show the
  // between-decks screen in its place. Never in a single-deck session.
  const boundary = card && continuedTo !== card ? deckBoundary(queue, index) : null;
  const between = boundary !== null;
  const canUndo = history.length > 0;

  useEffect(() => {
    shownAt.current = Date.now();
    position.current = index;
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

  const enqueue = useCallback((task: () => Promise<void>) => {
    outbox.current = outbox.current.then(task);
  }, []);

  /** Records a step for undo and returns its request state. */
  const remember = useCallback((step: Step): Sync => {
    const sync = newSync();
    syncs.current.set(step.id, sync);
    setHistory((steps) => pushCapped(steps, step));
    return sync;
  }, []);

  const answer = useCallback(
    (rating: RatingValue) => {
      if (!card || graded.current === card) return;
      graded.current = card;

      const durationMs = shownAt.current ? Date.now() - shownAt.current : undefined;
      const body = JSON.stringify({ cardId: card.id, rating, durationMs });
      const sync = remember({
        id: nextStepId.current++,
        kind: "answer",
        card,
        index,
        revealed,
        continuedTo,
        rating,
      });
      setUnsent((n) => n + 1);
      enqueue(async () => {
        // Undone before it went out: nothing to send, nothing to take back.
        if (!sync.undone) {
          sync.started = true;
          const result = await post("/api/reviews", body, setFailing);
          if (result === "lost" || "refused" in result) {
            sync.lost = true;
            setLost((n) => n + 1);
          } else {
            const data = result.data as { reviewId?: string; card?: Rescheduled } | null;
            sync.reviewId = data?.reviewId ?? null;
            const next = data?.card;
            // Still on minute-scale steps: it comes back before the session
            // ends — unless the answer was undone while it was on its way.
            if (!sync.undone && (next?.state === "LEARNING" || next?.state === "RELEARNING")) {
              const relearn = { ...card, state: next.state, intervals: next.intervals };
              sync.relearn = relearn;
              setQueue((current) => requeueInBlock(current, position.current, relearn));
            }
          }
        }
        setUnsent((n) => n - 1);
      });

      setAnswered((n) => n + 1);
      if (rating === 1) setAgain((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [card, index, revealed, continuedTo, enqueue, remember],
  );

  // Pausing (suspending) a card: out of this session at once, relearn copies
  // too, and out of every queue until it's resumed from its deck.
  const pause = useCallback(() => {
    if (!card) return;
    setMenuOpen(false);
    const { queue: rest, removed } = removeCard(queue, index, card.id);
    const sync = remember({
      id: nextStepId.current++,
      kind: "pause",
      card,
      index,
      revealed,
      continuedTo,
      removed,
    });
    const cardId = card.id;
    enqueue(async () => {
      if (sync.undone) return;
      sync.started = true;
      const result = await post(
        `/api/cards/${cardId}/suspend`,
        JSON.stringify({ suspended: true }),
        setFailing,
      );
      if (result === "lost" || ("refused" in result && result.refused === 409)) {
        sync.lost = true;
        setLostChanges((n) => n + 1);
      }
    });

    setQueue((current) => removeCard(current, index, cardId).queue);
    // The next card slides into this position. If this was the first card of
    // a deck already continued into, the next one of that deck is too.
    const next = rest[index];
    if (continuedTo === card && next?.deckId === card.deckId) setContinuedTo(next);
    setRevealed(false);
    // Same index, so the effect won't restart the next card's clock.
    shownAt.current = Date.now();
  }, [card, queue, index, revealed, continuedTo, enqueue, remember]);

  // Steps back over the newest answer or pause: the queue, position, reveal
  // and between-decks state as they were just before it, and the server's
  // side taken back (or never sent, if it hadn't gone out yet).
  const undo = useCallback(() => {
    const step = history.at(-1);
    if (!step) return;
    setMenuOpen(false);
    setHistory((steps) => steps.filter((s) => s !== step));
    const sync = syncs.current.get(step.id) ?? newSync();
    syncs.current.delete(step.id);
    sync.undone = true;

    if (step.kind === "answer") {
      // Read now: once `undone` is set, a landing answer won't re-queue.
      const relearn = sync.relearn;
      setQueue((current) => restoreAnswered(current, step.index, step.card, relearn));
      setAnswered((n) => n - 1);
      if (step.rating === 1) setAgain((n) => n - 1);
      graded.current = null;
      if (sync.started) {
        enqueue(async () => {
          // By now (the outbox runs in order) the answer has landed or failed.
          if (sync.lost) {
            setLost((n) => n - 1);
            return;
          }
          const result = sync.reviewId
            ? await post("/api/reviews/undo", JSON.stringify({ reviewId: sync.reviewId }), setFailing)
            : "lost";
          // 404: already undone (a retry whose first try got through).
          if (result === "lost" || ("refused" in result && result.refused === 409)) {
            setLostChanges((n) => n + 1);
          }
        });
      }
    } else {
      setQueue((current) => restoreRemoved(current, step.removed));
      if (sync.started) {
        const cardId = step.card.id;
        enqueue(async () => {
          if (sync.lost) {
            setLostChanges((n) => n - 1);
            return;
          }
          const result = await post(
            `/api/cards/${cardId}/suspend`,
            JSON.stringify({ suspended: false }),
            setFailing,
          );
          if (result === "lost" || ("refused" in result && result.refused === 409)) {
            setLostChanges((n) => n + 1);
          }
        });
      }
    }

    setIndex(step.index);
    setRevealed(step.revealed);
    setContinuedTo(step.continuedTo);
    shownAt.current = Date.now();
  }, [history, enqueue]);

  // Desktop keyboard shortcuts: space reveals, 1-4 grades, Z undoes.
  // Suspended while the chat sheet is open, or typing a question would grade
  // the card; between decks only Z works, as the card isn't on screen yet.
  useEffect(() => {
    if (chatOpen) return;
    function onKey(event: KeyboardEvent) {
      if (menuOpen) {
        if (event.key === "Escape") setMenuOpen(false);
        return;
      }
      if ((event.key === "z" || event.key === "Z") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (canUndo) {
          event.preventDefault();
          undo();
        }
        return;
      }
      if (!card || between) return;
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
  }, [answer, undo, canUndo, revealed, card, chatOpen, menuOpen, between]);

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
    ) : lostChanges > 0 ? (
      <p role="status" className="text-center text-xs text-again">
        {lostChanges} {lostChanges === 1 ? "undo or suspend" : "undos or suspends"} couldn&apos;t be saved
      </p>
    ) : null;

  // The done and saving screens: undo top-left, as on the card screen.
  const undoBar = (
    <div className="-ml-1 flex py-2">
      {canUndo ? <UndoButton onUndo={undo} /> : <span className="size-9" aria-hidden />}
    </div>
  );

  if (done) {
    const recalled = answered - again;
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-safe pb-safe">
        {undoBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-2 pb-13 text-center">
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
          <ButtonLink href="/decks" className="w-full">
            Back to decks
          </ButtonLink>
        </div>
      </div>
    );
  }

  // Past the last card with answers still in flight: one may come back as
  // learning, so hold the done screen until they've all landed. Likewise
  // between decks: a relearn rejoins the deck just finished.
  if (!card || (between && unsent > 0)) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-safe">
        {undoBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 pb-13 text-center">
          <p className="text-sm text-muted">Saving answers…</p>
          {notice}
        </div>
      </div>
    );
  }

  if (boundary) {
    return (
      <DeckTransition
        finished={boundary.finished.deckTitle}
        finishedCount={boundary.finishedCount}
        next={boundary.next.deckTitle}
        nextCount={boundary.nextCount}
        onContinue={() => {
          // The card's clock starts now, not when this screen appeared.
          shownAt.current = Date.now();
          setContinuedTo(card);
        }}
        onUndo={canUndo ? undo : undefined}
      />
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
      {/* Exit + undo, progress, then ask + more. */}
      <div className="flex items-center gap-2 py-2">
        <div className="-ml-1 flex shrink-0">
          <Link
            href="/decks"
            aria-label="End session"
            className="flex size-9 items-center justify-center rounded-full text-muted active:bg-raised"
          >
            <X className="size-5" aria-hidden />
          </Link>
          <UndoButton onUndo={undo} disabled={!canUndo} />
        </div>
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
        <span className="w-10 text-right text-xs tabular-nums text-muted">
          {index + 1}/{queue.length}
        </span>
        <div className="-mr-1 flex shrink-0">
          {/* Always reachable, never in the way, and it doesn't spoil the answer. */}
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label={chatLabel}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
          >
            <MessageCircleQuestion className="size-5" aria-hidden />
          </button>
          <CardMenu open={menuOpen} onOpenChange={setMenuOpen} onPause={pause} />
        </div>
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

/**
 * The "⋯" menu for the card on screen. Pausing sits behind it, two taps away,
 * so a stray tap on the top bar can't take a card out of rotation.
 */
function CardMenu({
  open,
  onOpenChange,
  onPause,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPause: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="More for this card"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised"
      >
        <Ellipsis className="size-5" aria-hidden />
      </button>
      {open ? (
        <>
          {/* Tapping anywhere else closes it. */}
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => onOpenChange(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={onPause}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm active:bg-raised"
            >
              <CirclePause className="size-4 text-muted" aria-hidden />
              Suspend card
            </button>
            <p className="px-3 pb-2 text-xs leading-snug text-muted">
              Skips it from now on. Unsuspend it from its deck's card list.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
