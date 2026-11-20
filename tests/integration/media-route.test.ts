// /api/media with local storage (MEDIA_STORAGE=local, from setup.ts): the real
// route reading a real file from `.media/`. iOS Safari plays <audio> only from
// a server that answers byte ranges, which is what this pins down. The Blob
// path cuts ranges with the same code (src/lib/media-range.test.ts).

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/media/[file]/route";
import { store } from "@/lib/media";

const key = `test-range-${randomUUID()}`;
const filename = `${key}.mp3`;
const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);

function get(file: string, range?: string) {
  return GET(
    new Request(`http://t/api/media/${file}`, { headers: range ? { range } : {} }),
    { params: Promise.resolve({ file }) },
  );
}

async function body(response: Response): Promise<number[]> {
  return [...new Uint8Array(await response.arrayBuffer())];
}

beforeAll(async () => {
  await store(key, bytes);
});

afterAll(async () => {
  await rm(path.join(process.cwd(), ".media", filename), { force: true });
});

describe("GET /api/media/[file]", () => {
  it("serves the whole clip with 200, its length, type, and an offer of ranges", async () => {
    const response = await get(filename);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await body(response)).toEqual([...bytes]);
  });

  it("answers Safari's bytes=0-1 probe with 206 and a Content-Range", async () => {
    const response = await get(filename, "bytes=0-1");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/1000");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(await body(response)).toEqual([0, 1]);
  });

  it("serves the rest of the clip from an offset", async () => {
    const response = await get(filename, "bytes=600-");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 600-999/1000");
    expect(await body(response)).toEqual([...bytes.slice(600)]);
  });

  it("refuses a range past the end with 416", async () => {
    const response = await get(filename, "bytes=1000-");
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */1000");
  });

  it("still 404s a missing clip, range or not", async () => {
    expect((await get("missing-clip.mp3")).status).toBe(404);
    expect((await get("missing-clip.mp3", "bytes=0-1")).status).toBe(404);
  });
});
