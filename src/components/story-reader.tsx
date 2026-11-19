"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  Check,
  Languages,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { deleteArticle, markArticleRead, saveWordFromArticle } from "@/app/actions";
import { AudioButton } from "@/components/audio-button";
import { prefetch, play, playingOwner, stop, subscribe, unlock } from "@/lib/audio-cache";
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

type Story = {
  id: string;
  title: string;
  titleTranslated: string | null;
  level: CefrLevel;
  wordCount: number;
  readAt: Date | null;
  newVocabulary: string[];
  deck: { id: string; name: string } | null;
  segments: Segment[];
};

/**
 * Listen & Read. The story plays sentence by sentence — the current one is
 * highlighted and kept in view — and tapping any sentence plays it and shows
 * its translation. Translations otherwise stay hidden, so it's immersion
 * rather than translation practice, and a new word can become a flashcard
 * without leaving the page.
 */
export function StoryReader({ story }: { story: Story }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [read, setRead] = useState(Boolean(story.readAt));
  const [pending, startTransition] = useTransition();

  const markRead = useCallback(() => {
    startTransition(async () => {
      await markArticleRead(story.id);
      setRead(true);
    });
  }, [story.id]);

  const player = useStoryPlayer(story.segments, read ? undefined : markRead);
  const lines = useRef<Map<string, HTMLElement>>(new Map());

  // Keep the sentence being spoken on screen. Scroll margins on each line keep
  // it clear of the player bar and the tab bar.
  const following = player.mode === "story" && player.status === "playing";
  const currentId = story.segments[player.index]?.id;
  useEffect(() => {
    if (!following || !currentId) return;
    lines.current.get(currentId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [following, currentId]);

  function tapSentence(index: number) {
    const segment = story.segments[index];
    const opening = !(showAll || revealed.has(segment.id));
    if (!showAll) {
      setRevealed((current) => {
        const next = new Set(current);
        if (next.has(segment.id)) next.delete(segment.id);
        else next.add(segment.id);
        return next;
      });
    }
    // Hiding a translation again shouldn't start talking.
    if (opening || showAll) player.playSentence(index);
  }

  return (
    <article className="pb-24">
      <header className="pt-3 pb-5">
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">
          {story.title}
        </h1>
        {story.titleTranslated ? (
          <p className="mt-1.5 text-sm text-muted">{story.titleTranslated}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge className="border-accent/50 text-accent">{story.level}</Badge>
          <Badge>{story.wordCount} words</Badge>
          {story.deck ? <Badge>{story.deck.name}</Badge> : null}
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-pressed={showAll}
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              showAll ? "border-accent/50 text-accent" : "border-line text-muted",
            )}
          >
            <Languages className="size-3.5" aria-hidden />
            {showAll ? "Hide translations" : "Translations"}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Tap a sentence to hear it and see what it means.
        </p>
      </header>

      <div className="space-y-0.5">
        {story.segments.map((segment, index) => {
          const open = showAll || revealed.has(segment.id);
          const current = player.status !== "idle" && player.index === index;
          return (
            <div
              key={segment.id}
              ref={(node) => {
                if (node) lines.current.set(segment.id, node);
                else lines.current.delete(segment.id);
              }}
              className={cn(
                "scroll-mt-4 scroll-mb-48 rounded-lg border-l-2 transition-colors",
                current ? "border-accent bg-accent/10" : "border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => tapSentence(index)}
                className={cn(
                  "w-full rounded-lg px-2 py-1.5 text-left",
                  !current && (open ? "bg-raised" : "active:bg-raised/60"),
                )}
                aria-expanded={open}
                aria-current={current ? "true" : undefined}
              >
                <span className="font-display text-lg leading-relaxed">
                  {segment.target}
                </span>
              </button>
              {open ? (
                <div className="flex items-start gap-2 px-2 pb-2">
                  <p className="flex-1 pt-1 text-sm text-muted">{segment.translation}</p>
                  <AudioButton
                    src={player.urls[segment.id] ?? null}
                    size="sm"
                    label="Replay this sentence"
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* The "+1": the words this story introduced on purpose. */}
      {story.newVocabulary.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display text-base font-semibold">New in this story</h2>
          <p className="mt-1 text-xs text-muted">
            Tap to add to your &ldquo;From reading&rdquo; deck.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {story.newVocabulary.map((word) => (
              <SaveWordChip key={word} word={word} />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8 space-y-2">
        {read ? (
          <p className="flex items-center justify-center gap-2 text-sm text-good">
            <Check className="size-4" aria-hidden />
            Finished
          </p>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            disabled={pending}
            onClick={markRead}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Mark as finished
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this story?")) return;
            startTransition(() => deleteArticle(story.id));
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          Delete story
        </Button>
      </div>

      <PlayerBar player={player} total={story.segments.length} />
    </article>
  );
}

/**
 * Fixed above the tab bar, where a thumb reaches it. The offset matches the
 * bottom nav's height (src/components/bottom-nav.tsx: 64px plus the safe area).
 */
function PlayerBar({ player, total }: { player: StoryPlayer; total: number }) {
  const active = player.mode === "story" && player.status !== "idle";
  const busy = player.status === "loading";
  const playing = active && (player.status === "playing" || busy);
  const position = active ? player.index + 1 : 0;

  return (
    <div
      className="fixed inset-x-0 z-30 border-t border-line bg-surface/95 backdrop-blur-lg"
      style={{ bottom: "calc(4rem + max(env(safe-area-inset-bottom), 0.5rem))" }}
    >
      <div
        className="h-0.5 bg-accent transition-[width]"
        style={{ width: `${total ? (position / total) * 100 : 0}%` }}
        aria-hidden
      />
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={() => player.skip(-1)}
          disabled={!active || player.index <= 0}
          aria-label="Previous sentence"
          className="flex size-10 items-center justify-center rounded-full text-muted disabled:opacity-40"
        >
          <SkipBack className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={playing ? player.pause : player.playStory}
          aria-label={playing ? "Pause" : active ? "Resume" : "Listen to the story"}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink active:brightness-95"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="size-5" aria-hidden />
          ) : (
            <Play className="size-5 translate-x-px" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => player.skip(1)}
          disabled={!active || player.index >= total - 1}
          aria-label="Next sentence"
          className="flex size-10 items-center justify-center rounded-full text-muted disabled:opacity-40"
        >
          <SkipForward className="size-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 text-right" aria-live="polite">
          {player.error ? (
            <p className="truncate text-xs text-again">{player.error}</p>
          ) : active ? (
            <p className="text-xs tabular-nums text-muted">
              Sentence {position} of {total}
            </p>
          ) : (
            <p className="text-sm font-medium">Listen</p>
          )}
        </div>
      </div>
    </div>
  );
}

type PlayerStatus = "idle" | "loading" | "playing" | "paused";

type StoryPlayer = ReturnType<typeof useStoryPlayer>;

/** Clips that "end" this soon after starting were refused (iOS autoplay), not heard. */
const REFUSED_MS = 250;
/** Sentences fetched and decoded ahead of the one playing, for gapless hand-offs. */
const LOOKAHEAD = 3;

/**
 * Plays the story's sentence clips back to back through the app-wide audio
 * cache (one clip at a time app-wide, decoded clips start instantly). A
 * sentence with no clip yet is synthesised on demand. Any other audio button
 * starting a clip pauses the story.
 *
 * All the bookkeeping the audio callbacks need lives in refs; state is only
 * what the UI renders.
 */
function useStoryPlayer(segments: Segment[], onFinished?: () => void) {
  const owner = useId();
  const [state, setState] = useState<{
    status: PlayerStatus;
    index: number;
    mode: "story" | "sentence";
    error: string | null;
  }>({ status: "idle", index: -1, mode: "story", error: null });
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      segments.flatMap((s) => (s.audioUrl ? [[s.id, s.audioUrl]] : [])),
    ),
  );

  const known = useRef<Map<string, string> | null>(null);
  const inflight = useRef(new Map<string, Promise<string | null>>());
  const live = useRef({
    status: "idle" as PlayerStatus,
    mode: "story" as "story" | "sentence",
    index: -1,
    run: 0,
    startedAt: 0,
  });
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);

  const urlMap = useCallback(() => {
    known.current ??= new Map(
      segments.flatMap((s) => (s.audioUrl ? [[s.id, s.audioUrl] as const] : [])),
    );
    return known.current;
  }, [segments]);

  /** The clip for a sentence, asking the server to speak it if needed. */
  const ensureUrl = useCallback(
    (segment: Segment): Promise<string | null> => {
      const cached = urlMap().get(segment.id);
      if (cached) return Promise.resolve(cached);
      const existing = inflight.current.get(segment.id);
      if (existing) return existing;

      const request = fetch(`/api/segments/${segment.id}/audio`, { method: "POST" })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || typeof data.audioUrl !== "string") return null;
          urlMap().set(segment.id, data.audioUrl);
          setUrls((current) => ({ ...current, [segment.id]: data.audioUrl }));
          return data.audioUrl as string;
        })
        .catch(() => null)
        .finally(() => inflight.current.delete(segment.id));
      inflight.current.set(segment.id, request);
      return request;
    },
    [urlMap],
  );

  const settle = useCallback(
    (status: PlayerStatus, patch: { index?: number; error?: string | null } = {}) => {
      live.current.status = status;
      if (patch.index !== undefined) live.current.index = patch.index;
      setState((current) => ({
        ...current,
        status,
        index: live.current.index,
        mode: live.current.mode,
        error: patch.error === undefined ? current.error : patch.error,
      }));
    },
    [],
  );

  const start = useCallback(
    (index: number, mode: "story" | "sentence", gesture: boolean) => {
      const segment = segments[index];
      if (!segment) return;
      const run = ++live.current.run;
      live.current.mode = mode;
      // Resuming iOS audio only works inside the tap itself.
      if (gesture) unlock();

      const go = (url: string) => {
        if (live.current.run !== run) return;
        live.current.startedAt = performance.now();
        live.current.status = "playing";
        play(url, owner);
        settle("playing", { index, error: null });
        if (mode !== "story") return;
        for (const next of segments.slice(index + 1, index + 1 + LOOKAHEAD)) {
          ensureUrl(next).then((u) => u && prefetch(u));
        }
      };

      const cached = urlMap().get(segment.id);
      // Synchronously, when possible, so playback starts within the gesture.
      if (cached) return go(cached);

      settle("loading", { index, error: null });
      // A seek shouldn't keep the old sentence talking while the new one loads.
      stop(owner);
      ensureUrl(segment).then((url) => {
        if (live.current.run !== run) return;
        if (url) go(url);
        else settle("paused", { error: "Audio isn't available right now" });
      });
    },
    [segments, owner, settle, ensureUrl, urlMap],
  );

  // React to the shared audio state: our clip ending moves the story on;
  // someone else's clip starting pauses it.
  useEffect(() => {
    return subscribe(() => {
      const { status, mode, index, startedAt } = live.current;
      const now = playingOwner();
      if (now === owner) return;

      if (status === "loading" && now !== null) {
        live.current.run += 1;
        settle("paused");
        return;
      }
      if (status !== "playing") return;
      if (now !== null) {
        live.current.run += 1;
        settle("paused");
        return;
      }

      // Our clip ended.
      if (performance.now() - startedAt < REFUSED_MS) {
        settle("paused");
      } else if (mode === "sentence") {
        settle("idle");
      } else if (index + 1 < segments.length) {
        start(index + 1, "story", false);
      } else {
        settle("idle", { index: -1 });
        finished.current?.();
      }
    });
  }, [owner, segments.length, settle, start]);

  // Leaving the page silences the story.
  useEffect(
    () => () => {
      live.current.run += 1;
      stop(owner);
    },
    [owner],
  );

  const pause = useCallback(() => {
    live.current.run += 1;
    live.current.status = "paused";
    stop(owner);
    settle("paused");
  }, [owner, settle]);

  const playStory = useCallback(() => {
    const { mode, index, status } = live.current;
    // Resume where the story left off; start over once it has finished.
    const from = mode === "story" && status === "paused" && index >= 0 ? index : 0;
    start(from, "story", true);
  }, [start]);

  const skip = useCallback(
    (delta: number) => {
      const target = Math.min(Math.max(live.current.index + delta, 0), segments.length - 1);
      start(target, "story", true);
    },
    [segments.length, start],
  );

  /** A tapped sentence: jump the story there if it's playing, else play just that one. */
  const playSentence = useCallback(
    (index: number) => {
      const { mode, status } = live.current;
      const storyRunning = mode === "story" && (status === "playing" || status === "loading");
      start(index, storyRunning ? "story" : "sentence", true);
    },
    [start],
  );

  return { ...state, urls, playStory, pause, skip, playSentence };
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
          // the word itself is enough to not lose it mid-story.
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
