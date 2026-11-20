/**
 * Client-only card audio: clips prefetched and decoded ahead of time play
 * instantly through Web Audio; anything else streams through a plain <audio>
 * element. One clip plays at a time.
 *
 * iOS starts every AudioContext suspended. `unlock()` must run inside a user
 * gesture; once resumed, `play()` from an effect works without one, which is
 * what lets audio autoplay on card change and on reveal. Until then (the first
 * tap of a session, the first after the phone was locked) a tap streams.
 *
 * Nothing that fails stays failed: a fetch that errors or hangs drops out of
 * the cache, playing a clip that isn't decoded starts fetching it again, and a
 * stream that never starts gives the button back. Tapping a clip that is still
 * loading starts it over rather than stopping it.
 */

const MAX_CLIPS = 40;
/** A prefetch still unfinished by then is abandoned, so the next play retries it. */
export const FETCH_TIMEOUT_MS = 15_000;
/** A streamed clip that hasn't started by then is given up on and the button reset. */
export const START_TIMEOUT_MS = 10_000;
/** How long a "running" context gets to prove its clock moves. */
export const CLOCK_CHECK_MS = 1_000;

/** Who the current clip belongs to, and whether it is audible yet. */
export type Clip = { owner: string; phase: "loading" | "playing" };

/** What the cache needs from the browser; tests pass fakes. */
export type AudioEnvironment = {
  createContext(): AudioContext | null;
  createElement(url: string): HTMLAudioElement;
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** Put Web Audio in the session <audio> uses (iOS: so the silent switch treats them alike). */
  preparePlayback(): void;
};

type Entry = { buffer: AudioBuffer | null };
type Current = { token: number; clip: Clip; release: () => void };

export function createAudioCache(env: AudioEnvironment) {
  /** Clips by URL, oldest first; `buffer` is null while the fetch/decode is in flight. */
  const clips = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let context: AudioContext | null = null;
  let current: Current | null = null;
  let seq = 0;

  function getContext(): AudioContext | null {
    if (context?.state === "closed") context = null;
    if (!context) {
      try {
        context = env.createContext();
      } catch {
        context = null;
      }
    }
    return context;
  }

  /** Forget a context that has stopped working, and every clip decoded for it. */
  function dropContext(ctx: AudioContext) {
    if (context !== ctx) return;
    context = null;
    clips.clear();
    ctx.close().catch(() => {});
  }

  function emit() {
    for (const listener of listeners) listener();
  }

  function halt() {
    const was = current;
    current = null;
    was?.release();
  }

  function end(token: number) {
    if (current?.token !== token) return;
    halt();
    emit();
  }

  function started(token: number) {
    if (current?.token !== token || current.clip.phase === "playing") return;
    current.clip = { ...current.clip, phase: "playing" };
    emit();
  }

  /** Fetch and decode a clip ahead of time. Failures drop out so a later call retries. */
  function prefetch(url: string | null | undefined): void {
    if (!url || clips.has(url)) return;
    const ctx = getContext();
    if (!ctx) return;

    const entry: Entry = { buffer: null };
    clips.set(url, entry);
    if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // Same-origin, so the auth cookie goes along by default.
    env
      .fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then(
        (buffer) => {
          entry.buffer = buffer;
        },
        () => {
          if (clips.get(url) === entry) clips.delete(url);
        },
      )
      .finally(() => clearTimeout(timer));
  }

  /** Resume audio. Call from a gesture handler; a no-op once running. */
  function unlock(): void {
    const ctx = getContext();
    if (!ctx || ctx.state === "running") return;
    env.preparePlayback();
    ctx.resume().catch(() => {});
  }

  function playBuffer(ctx: AudioContext, buffer: AudioBuffer, token: number, owner: string): Current {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => end(token);
    const startedAt = ctx.currentTime;
    source.start();

    // A context can report "running" while its clock stands still (iOS, after
    // an interruption): silence, and no `ended` to reset the button. Drop it;
    // the next tap streams, and unlock() builds a fresh one.
    const check = setTimeout(() => {
      if (current?.token !== token || ctx.currentTime > startedAt) return;
      dropContext(ctx);
      end(token);
    }, CLOCK_CHECK_MS);

    return {
      token,
      clip: { owner, phase: "playing" },
      release: () => {
        clearTimeout(check);
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      },
    };
  }

  function playElement(url: string, token: number, owner: string): Current {
    const audio = env.createElement(url);
    const fail = () => end(token);
    const timer = setTimeout(fail, START_TIMEOUT_MS);
    const begin = () => {
      clearTimeout(timer);
      started(token);
    };
    audio.onplaying = begin;
    audio.onended = fail;
    audio.onerror = fail;
    // Rejects without a gesture (iOS autoplay) or once released; either way
    // the button resets and the next tap tries again.
    audio.play().then(begin, fail);

    return {
      token,
      clip: { owner, phase: "loading" },
      release: () => {
        clearTimeout(timer);
        audio.onplaying = audio.onended = audio.onerror = null;
        audio.pause();
      },
    };
  }

  /**
   * Play `url`, stopping any other clip. `owner` identifies the button, for UI
   * state. Call it synchronously from the tap handler: iOS only lets <audio>
   * start inside the gesture.
   */
  function play(url: string, owner: string): void {
    halt();
    const token = ++seq;
    const entry = clips.get(url);
    if (entry) {
      // Most recently used goes last, so eviction takes the stalest clip.
      clips.delete(url);
      clips.set(url, entry);
    }

    const ctx = context;
    if (entry?.buffer && ctx?.state === "running") {
      current = playBuffer(ctx, entry.buffer, token, owner);
    } else {
      // Fetch it again if it failed or was evicted, so the next play is instant.
      prefetch(url);
      current = playElement(url, token, owner);
    }
    emit();
  }

  /** Stop playback, but only if `owner` started it. */
  function stop(owner: string): void {
    if (current?.clip.owner !== owner) return;
    halt();
    emit();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** The current clip; a new object whenever it changes, for useSyncExternalStore. */
  function currentClip(): Clip | null {
    return current?.clip ?? null;
  }

  /** Owner of the clip playing (or loading), or null. */
  function playingOwner(): string | null {
    return current?.clip.owner ?? null;
  }

  return { prefetch, unlock, play, stop, subscribe, currentClip, playingOwner };
}

const browser: AudioEnvironment = {
  createContext: () => (typeof AudioContext === "function" ? new AudioContext() : null),
  createElement: (url) => new Audio(url),
  fetch: (url, init) => fetch(url, init),
  preparePlayback() {
    // iOS puts Web Audio in the "ambient" session, which the silent switch
    // mutes while <audio> keeps playing. "playback" makes them match (Safari 17+).
    const session = (navigator as Navigator & { audioSession?: { type: string } })
      .audioSession;
    if (session) session.type = "playback";
  },
};

export const { prefetch, unlock, play, stop, subscribe, currentClip, playingOwner } =
  createAudioCache(browser);

/** Server snapshot: nothing plays during SSR. */
export function noOwner(): null {
  return null;
}

/** Server snapshot: nothing plays during SSR. */
export function noClip(): null {
  return null;
}
