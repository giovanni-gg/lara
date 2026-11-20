import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOCK_CHECK_MS,
  FETCH_TIMEOUT_MS,
  START_TIMEOUT_MS,
  createAudioCache,
  type AudioEnvironment,
} from "./audio-cache";

// The browser pieces, faked just far enough for the cache's state machine.

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  async decodeAudioData(data: ArrayBuffer) {
    return { decoded: data.byteLength };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

class FakeAudio {
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  settle!: { resolve: () => void; reject: (error: Error) => void };
  constructor(readonly url: string) {}
  play() {
    return new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
  }
  pause() {
    this.paused = true;
    // As browsers do: pausing before playback starts rejects play().
    this.settle.reject(new Error("AbortError"));
  }
  /** Playback actually starts. */
  begin() {
    this.paused = false;
    this.settle.resolve();
    this.onplaying?.();
  }
}

type PendingFetch = {
  url: string;
  signal: AbortSignal;
  respond: (status: number) => void;
};

let contexts: FakeContext[];
let elements: FakeAudio[];
let fetches: PendingFetch[];
let preparePlayback: ReturnType<typeof vi.fn<() => void>>;
let cache: ReturnType<typeof createAudioCache>;

const ctx = () => contexts.at(-1)!;
const element = () => elements.at(-1)!;
/** Lets promise callbacks run. Real setImmediate: only the timeouts are faked. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  contexts = [];
  elements = [];
  fetches = [];
  preparePlayback = vi.fn<() => void>();
  const env: AudioEnvironment = {
    createContext: () => {
      const context = new FakeContext();
      contexts.push(context);
      return context as unknown as AudioContext;
    },
    createElement: (url) => {
      const audio = new FakeAudio(url);
      elements.push(audio);
      return audio as unknown as HTMLAudioElement;
    },
    fetch: (url, init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal!;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        fetches.push({
          url,
          signal,
          respond: (status) => resolve(new Response(new Uint8Array(8), { status })),
        });
      }),
    preparePlayback,
  };
  cache = createAudioCache(env);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Prefetch `url` and let it download and decode. */
async function decoded(url: string) {
  cache.prefetch(url);
  fetches.find((f) => f.url === url)!.respond(200);
  await flush();
}

async function running() {
  cache.unlock();
  await flush();
  expect(ctx().state).toBe("running");
}

describe("decoded clips", () => {
  it("play through Web Audio once the context runs, and reset when they end", async () => {
    await decoded("/a.mp3");
    await running();

    cache.play("/a.mp3", "btn");
    expect(elements).toHaveLength(0);
    expect(ctx().sources[0].started).toBe(true);
    expect(cache.currentClip()).toEqual({ owner: "btn", phase: "playing" });

    ctx().sources[0].onended!();
    expect(cache.currentClip()).toBeNull();
  });

  it("stream instead while the context is still suspended, as on the first tap", async () => {
    await decoded("/a.mp3");
    cache.play("/a.mp3", "btn");
    expect(ctx().sources).toHaveLength(0);
    expect(element().url).toBe("/a.mp3");
  });
});

describe("streamed clips", () => {
  it("show as loading until the element really plays", async () => {
    cache.play("/a.mp3", "btn");
    expect(cache.currentClip()).toEqual({ owner: "btn", phase: "loading" });

    element().begin();
    await flush();
    expect(cache.currentClip()).toEqual({ owner: "btn", phase: "playing" });

    element().onended!();
    expect(cache.currentClip()).toBeNull();
  });

  it("reset when play() is refused, and the next tap tries a fresh element", async () => {
    cache.play("/a.mp3", "btn");
    element().settle.reject(new Error("NotAllowedError"));
    await flush();
    expect(cache.currentClip()).toBeNull();

    cache.play("/a.mp3", "btn");
    expect(elements).toHaveLength(2);
    element().begin();
    await flush();
    expect(cache.currentClip()?.phase).toBe("playing");
  });

  it("reset on a load error", () => {
    cache.play("/a.mp3", "btn");
    element().onerror!();
    expect(cache.currentClip()).toBeNull();
  });

  it("give the button back if they never start", async () => {
    cache.play("/a.mp3", "btn");
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(cache.currentClip()).toBeNull();
    expect(element().paused).toBe(true);
  });

  it("can be restarted while still loading", () => {
    cache.play("/a.mp3", "btn");
    const first = element();
    cache.play("/a.mp3", "btn");
    expect(elements).toHaveLength(2);
    // The abandoned element's late events change nothing.
    first.onended?.();
    expect(first.onended).toBeNull();
    expect(cache.currentClip()).toEqual({ owner: "btn", phase: "loading" });
  });
});

describe("the cache heals", () => {
  it("a failed prefetch drops out, and playing the clip fetches it again", async () => {
    cache.prefetch("/a.mp3");
    fetches[0].respond(404);
    await flush();

    cache.play("/a.mp3", "btn"); // streams this time...
    expect(fetches).toHaveLength(2); // ...and fetches it again
    fetches[1].respond(200);
    await flush();
    element().onended!();

    await running();
    cache.play("/a.mp3", "btn");
    expect(ctx().sources).toHaveLength(1); // decoded now: Web Audio
  });

  it("a prefetch that hangs is abandoned and retried", async () => {
    cache.prefetch("/a.mp3");
    cache.prefetch("/a.mp3");
    expect(fetches).toHaveLength(1); // in flight: not fetched twice

    vi.advanceTimersByTime(FETCH_TIMEOUT_MS);
    expect(fetches[0].signal.aborted).toBe(true);
    await flush();

    cache.prefetch("/a.mp3");
    expect(fetches).toHaveLength(2);
  });

  it("a context that says running but whose clock is stuck is replaced", async () => {
    await decoded("/a.mp3");
    await running();
    const dead = ctx();

    cache.play("/a.mp3", "btn");
    vi.advanceTimersByTime(CLOCK_CHECK_MS);
    expect(cache.currentClip()).toBeNull(); // the button is tappable again
    expect(dead.close).toHaveBeenCalled();

    // The next tap streams (and refetches for a fresh context)...
    cache.unlock();
    cache.play("/a.mp3", "btn");
    expect(contexts).toHaveLength(2);
    expect(element().url).toBe("/a.mp3");
  });

  it("a context whose clock moves is left alone", async () => {
    await decoded("/a.mp3");
    await running();
    cache.play("/a.mp3", "btn");
    ctx().currentTime = 0.5;
    vi.advanceTimersByTime(CLOCK_CHECK_MS);
    expect(cache.currentClip()).toEqual({ owner: "btn", phase: "playing" });
    expect(ctx().close).not.toHaveBeenCalled();
  });
});

describe("one clip at a time", () => {
  it("starting another clip stops the first, whose late events are ignored", async () => {
    await decoded("/a.mp3");
    await running();
    cache.play("/a.mp3", "one");
    const first = ctx().sources[0];

    cache.play("/b.mp3", "two");
    expect(first.stopped).toBe(true);
    expect(first.onended).toBeNull();
    expect(cache.playingOwner()).toBe("two");
  });

  it("stop() only stops the caller's own clip", () => {
    cache.play("/a.mp3", "one");
    cache.stop("two");
    expect(cache.playingOwner()).toBe("one");
    cache.stop("one");
    expect(cache.playingOwner()).toBeNull();
  });

  it("notifies subscribers, and the snapshot only changes when the clip does", async () => {
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    cache.play("/a.mp3", "btn");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.currentClip()).toBe(cache.currentClip());

    element().begin();
    await flush();
    expect(listener).toHaveBeenCalledTimes(2); // loading -> playing, once
    unsubscribe();
    cache.stop("btn");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("unlock", () => {
  it("resumes a suspended context in the session <audio> uses, once", async () => {
    cache.unlock();
    expect(ctx().resume).toHaveBeenCalledTimes(1);
    expect(preparePlayback).toHaveBeenCalledTimes(1);
    await flush();
    cache.unlock();
    expect(ctx().resume).toHaveBeenCalledTimes(1);
  });
});
