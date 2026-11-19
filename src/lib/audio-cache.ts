/**
 * Client-only card audio: clips prefetched and decoded ahead of time play
 * instantly through Web Audio; anything else falls back to a plain <audio>
 * element, exactly as before. One clip plays at a time.
 *
 * iOS starts every AudioContext suspended. `unlock()` must run inside a user
 * gesture; once resumed, `play()` from an effect works without one, which is
 * what lets audio autoplay on card change and on reveal.
 */

const MAX_CLIPS = 40;

/** Decoded clips by URL; `null` while the fetch/decode is in flight. */
const clips = new Map<string, AudioBuffer | null>();
const listeners = new Set<() => void>();

let context: AudioContext | null = null;
let current: { token: number; owner: string; stop: () => void } | null = null;
let seq = 0;

function getContext(): AudioContext | null {
  if (!context && typeof AudioContext === "function") {
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
  }
  return context;
}

function emit() {
  for (const listener of listeners) listener();
}

function end(token: number) {
  if (current?.token !== token) return;
  current = null;
  emit();
}

/** Fetch and decode a clip ahead of time. Failures drop out so a later call retries. */
export function prefetch(url: string | null | undefined): void {
  if (!url || clips.has(url)) return;
  const ctx = getContext();
  if (!ctx) return;

  clips.set(url, null);
  if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!);

  // Same-origin, so the auth cookie goes along by default.
  fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .then(
      (buffer) => {
        if (clips.has(url)) clips.set(url, buffer);
      },
      () => clips.delete(url),
    );
}

/** Resume audio. Call from a gesture handler; a no-op once running. */
export function unlock(): void {
  const ctx = getContext();
  if (!ctx || ctx.state === "running") return;
  // iOS puts Web Audio in the "ambient" session, which the silent switch
  // mutes while <audio> keeps playing. "playback" makes them match (Safari 17+).
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session) session.type = "playback";
  ctx.resume().catch(() => {});
}

/** Play `url`, stopping any other clip. `owner` identifies the button, for UI state. */
export function play(url: string, owner: string): void {
  current?.stop();
  const token = ++seq;
  const buffer = clips.get(url);

  if (buffer && context?.state === "running") {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => end(token);
    source.start();
    current = {
      token,
      owner,
      stop: () => {
        source.onended = null;
        source.stop();
      },
    };
  } else {
    const audio = new Audio(url);
    audio.onended = audio.onerror = () => end(token);
    // Rejects when autoplay is blocked (no gesture yet); the button just resets.
    audio.play().catch(() => end(token));
    current = {
      token,
      owner,
      stop: () => {
        audio.onended = audio.onerror = null;
        audio.pause();
      },
    };
  }
  emit();
}

/** Stop playback, but only if `owner` started it. */
export function stop(owner: string): void {
  if (current?.owner !== owner) return;
  current.stop();
  current = null;
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Owner of the clip playing, or null. */
export function playingOwner(): string | null {
  return current?.owner ?? null;
}

/** Server snapshot: nothing plays during SSR. */
export function noOwner(): null {
  return null;
}
