import type { MediaObject } from "@/lib/media";

/**
 * HTTP Range support for /api/media.
 *
 * iOS Safari won't play an <audio> source from a server that ignores Range: it
 * opens every clip with `Range: bytes=0-1` and expects `206 Partial Content`.
 * Card audio only reaches <audio> when its prefetched copy isn't decoded or Web
 * Audio isn't running yet, which is why clips failed "sometimes" rather than
 * always. Only a single range is supported; anything else gets the whole file,
 * which RFC 9110 allows.
 */

/** Inclusive byte offsets, as in `Content-Range`. */
export type ByteRange = { start: number; end: number };

/**
 * The range `header` asks for in a file of `size` bytes: `null` to serve the
 * whole file (no header, or one we ignore), `"unsatisfiable"` for a 416.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  // Multiple ranges, other units, garbage: ignored, the whole file is served.
  if (!match) return null;
  const [, first, last] = match;
  if (first === "" && last === "") return null;

  if (first === "") {
    // Suffix: the last N bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(first);
  const end = last === "" ? Infinity : Number(last);
  if (end < start) return null; // Invalid, so ignored rather than refused.
  if (start >= size) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

/** Bytes `start..end` (inclusive) of a stream, cancelling it once they've passed. */
export function sliceStream(
  stream: ReadableStream<Uint8Array>,
  { start, end }: ByteRange,
): ReadableStream<Uint8Array> {
  let offset = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const from = Math.max(start - offset, 0);
        const to = Math.min(end + 1 - offset, chunk.byteLength);
        offset += chunk.byteLength;
        if (to > from) controller.enqueue(chunk.subarray(from, to));
        if (offset > end) controller.terminate();
      },
    }),
  );
}

/**
 * The response for `media`, honouring `rangeHeader`. A full file streams as
 * before; a range of a stream whose length the backend didn't report reads it
 * first (capped at MAX_MEDIA_BYTES by `openMedia`) to learn the size.
 */
export async function mediaResponse(
  media: MediaObject,
  rangeHeader: string | null,
  cacheControl: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": media.contentType,
    "cache-control": cacheControl,
    "accept-ranges": "bytes",
  };

  let { body, size } = media;
  if (!rangeHeader) {
    if (size !== null) headers["content-length"] = String(size);
    return new Response(toBody(body), { headers });
  }

  if (size === null) {
    body = Buffer.from(await new Response(toBody(body)).arrayBuffer());
    size = body.byteLength;
  }

  const range = parseRange(rangeHeader, size);
  if (range === null) {
    headers["content-length"] = String(size);
    return new Response(toBody(body), { headers });
  }
  if (range === "unsatisfiable") {
    if (body instanceof ReadableStream) await body.cancel();
    headers["content-range"] = `bytes */${size}`;
    return new Response(null, { status: 416, headers });
  }

  headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
  headers["content-length"] = String(range.end - range.start + 1);
  const part =
    body instanceof ReadableStream
      ? sliceStream(body, range)
      : body.subarray(range.start, range.end + 1);
  return new Response(toBody(part), { status: 206, headers });
}

// A Buffer isn't a BodyInit; the copy only happens for local (development) files.
function toBody(body: ReadableStream<Uint8Array> | Buffer): BodyInit {
  return body instanceof ReadableStream ? body : new Uint8Array(body);
}
