import { describe, expect, it } from "vitest";
import { mediaResponse, parseRange, sliceStream } from "./media-range";
import type { MediaObject } from "./media";

const CACHE = "private, max-age=31536000, immutable";
const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);

/** A stream of `data` in chunks of `size`, recording whether it was cancelled. */
function chunked(data: Uint8Array, size: number) {
  const state = { cancelled: false, pulled: 0 };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.byteLength) return controller.close();
      controller.enqueue(data.slice(offset, offset + size));
      offset += size;
      state.pulled += 1;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

async function read(stream: ReadableStream<Uint8Array> | null): Promise<number[]> {
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("parseRange", () => {
  it("reads first-last, open-ended and suffix ranges, clamped to the file", () => {
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("BYTES = 5 - 6", 100)).toEqual({ start: 5, end: 6 });
  });

  it("refuses ranges that start past the end", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=100-200", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1", 0)).toBe("unsatisfiable");
  });

  it("ignores what it doesn't support, so the whole file is served", () => {
    for (const header of [null, "", "bytes=0-1,5-6", "items=0-1", "bytes=-", "bytes=5-2", "nonsense"]) {
      expect(parseRange(header, 100), String(header)).toBeNull();
    }
  });
});

describe("sliceStream", () => {
  it("cuts a range across chunk boundaries", async () => {
    const { stream } = chunked(bytes, 7);
    expect(await read(sliceStream(stream, { start: 5, end: 30 }))).toEqual(range(5, 30));
  });

  it("stops reading the source once the range is out", async () => {
    const { stream, state } = chunked(bytes, 10);
    expect(await read(sliceStream(stream, { start: 0, end: 1 }))).toEqual([0, 1]);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(10);
  });

  it("serves the last byte", async () => {
    const { stream } = chunked(bytes, 33);
    expect(await read(sliceStream(stream, { start: 99, end: 99 }))).toEqual([99]);
  });
});

describe("mediaResponse", () => {
  const local = (): MediaObject => ({
    body: Buffer.from(bytes),
    size: 100,
    contentType: "audio/mpeg",
  });
  const blob = (sized: boolean) => {
    const { stream, state } = chunked(bytes, 16);
    const media: MediaObject = { body: stream, size: sized ? 100 : null, contentType: "audio/mpeg" };
    return { media, state };
  };

  it("serves the whole file with 200, its length, and an offer of ranges", async () => {
    const response = await mediaResponse(local(), null, CACHE);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("100");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe(CACHE);
    expect(await read(response.body)).toEqual(range(0, 99));
  });

  it("answers Safari's opening bytes=0-1 probe with 206", async () => {
    const response = await mediaResponse(local(), "bytes=0-1", CACHE);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/100");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await read(response.body)).toEqual([0, 1]);
  });

  it("cuts a range out of a Blob stream without reading the rest", async () => {
    const { media, state } = blob(true);
    const response = await mediaResponse(media, "bytes=20-39", CACHE);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 20-39/100");
    expect(response.headers.get("content-length")).toBe("20");
    expect(await read(response.body)).toEqual(range(20, 39));
    expect(state.cancelled).toBe(true);
  });

  it("learns the size of an unsized stream before cutting a range from it", async () => {
    const { media } = blob(false);
    const response = await mediaResponse(media, "bytes=-5", CACHE);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 95-99/100");
    expect(await read(response.body)).toEqual(range(95, 99));
  });

  it("still streams an unsized file whole, without a length, when no range is asked", async () => {
    const { media } = blob(false);
    const response = await mediaResponse(media, null, CACHE);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    expect(await read(response.body)).toEqual(range(0, 99));
  });

  it("refuses an unsatisfiable range with 416 and the real size", async () => {
    const { media, state } = blob(true);
    const response = await mediaResponse(media, "bytes=100-", CACHE);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */100");
    expect(await read(response.body)).toEqual([]);
    expect(state.cancelled).toBe(true);
  });

  it("serves the whole file for a range it ignores", async () => {
    const response = await mediaResponse(local(), "bytes=0-1,5-6", CACHE);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("100");
    expect(await read(response.body)).toEqual(range(0, 99));
  });
});
