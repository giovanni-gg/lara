import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, get, head, put } from "@vercel/blob";

/**
 * Generated audio and imported Anki media. Every object is addressed by a
 * bare filename `<key>.<ext>` and always served through /api/media/<filename>
 * — those URLs are stored in the database, so they never change, whichever
 * backend holds the bytes.
 *
 * `MEDIA_STORAGE` picks the backend, read per call:
 * - `local` (default): files in `.media/`. Development only; serverless disks
 *   aren't durable.
 * - `blob`: a **private** Vercel Blob store, pathname `media/<filename>`,
 *   authenticated with `BLOB_READ_WRITE_TOKEN`. Private, because the app sits
 *   behind a password and its media should too — so there are no public Blob
 *   URLs; /api/media streams the object through with the token.
 *
 * Seed the store from `.media/` with `npm run media:upload`.
 */

const MEDIA_DIR = path.join(process.cwd(), ".media");
const BLOB_PREFIX = "media/";

/**
 * Largest object /api/media will serve. Vercel caps function responses at
 * 4.5 MB; the real files average ~200 KB, so this is a guard, not a limit
 * anyone should reach.
 */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

/** Keys are content hashes, so an object never changes once written. */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

type Backend = "local" | "blob";

function backend(): Backend {
  const value = (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
  if (value === "" || value === "local") return "local";
  if (value === "blob") return "blob";
  throw new Error(`MEDIA_STORAGE must be "local" or "blob", got "${value}"`);
}

/**
 * A bare `<name>.<ext>` filename — no separators, no `..`, nothing that could
 * escape `.media/` or the `media/` Blob prefix. Every key `mediaKey` and the
 * Anki importer produce matches.
 */
export function isMediaFilename(filename: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9]+$/.test(filename) &&
    path.basename(filename) === filename
  );
}

/** Where a media file lives inside the Blob store. */
export function blobPathname(filename: string): string {
  return `${BLOB_PREFIX}${filename}`;
}

export function contentTypeFor(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** Stable key for a piece of text, so identical text is only ever synthesised once. */
export function mediaKey(kind: string, language: string, text: string): string {
  const hash = createHash("sha256")
    .update(`${kind}:${language}:${text}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}-${language}-${hash}`;
}

export function publicUrl(key: string, extension = "mp3"): string {
  return `/api/media/${key}.${extension}`;
}

function filenameFor(key: string, extension: string): string {
  const filename = `${key}.${extension}`;
  if (!isMediaFilename(filename)) {
    throw new Error(`Invalid media filename: ${filename}`);
  }
  return filename;
}

export async function exists(key: string, extension = "mp3"): Promise<boolean> {
  const filename = filenameFor(key, extension);

  if (backend() === "blob") {
    try {
      await head(blobPathname(filename));
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  }

  try {
    await access(path.join(MEDIA_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

export async function store(
  key: string,
  data: Uint8Array,
  extension = "mp3",
): Promise<string> {
  const filename = filenameFor(key, extension);

  if (backend() === "blob") {
    // Deterministic pathname, overwrite allowed: the key is a content hash, so
    // two concurrent writers of the same key are writing the same bytes.
    await put(
      blobPathname(filename),
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: contentTypeFor(filename),
        cacheControlMaxAge: ONE_YEAR_SECONDS,
      },
    );
    return publicUrl(key, extension);
  }

  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, filename), data);
  return publicUrl(key, extension);
}

export type MediaObject = {
  /** A stream from Blob, or the bytes themselves when read from disk. */
  body: ReadableStream<Uint8Array> | Buffer;
  /** Byte length, when the backend reports it. */
  size: number | null;
  contentType: string;
};

/** Thrown when an object exceeds MAX_MEDIA_BYTES, rather than loading it. */
export class MediaTooLargeError extends Error {
  constructor(filename: string, size: number) {
    super(`${filename} is ${size} bytes, over the ${MAX_MEDIA_BYTES}-byte limit`);
    this.name = "MediaTooLargeError";
  }
}

/** Passes a stream of unknown length through, erroring once it passes the cap. */
function capped(
  stream: ReadableStream<Uint8Array>,
  filename: string,
): ReadableStream<Uint8Array> {
  let seen = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_MEDIA_BYTES) {
          controller.error(new MediaTooLargeError(filename, seen));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Opens a media file for serving without buffering it (Blob backend) — the
 * route pipes `body` straight into the response. `null` when the filename is
 * invalid or nothing is stored under it.
 */
export async function openMedia(filename: string): Promise<MediaObject | null> {
  if (!isMediaFilename(filename)) return null;
  const contentType = contentTypeFor(filename);

  if (backend() === "blob") {
    const result = await get(blobPathname(filename), { access: "private" });
    // get() resolves null on 404; 304 only happens with ifNoneMatch, which we
    // never send, but a body-less result is "nothing to serve" either way.
    if (!result || result.statusCode !== 200) return null;
    // `result.blob.size` reads 0 when content-length is absent, and a decoded
    // body wouldn't match it anyway — trust only a plain content-length.
    const length = result.headers.get("content-length");
    const parsed = length && !result.headers.get("content-encoding") ? Number(length) : NaN;
    const size = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    if (size !== null && size > MAX_MEDIA_BYTES) {
      await result.stream.cancel();
      throw new MediaTooLargeError(filename, size);
    }
    const body = size === null ? capped(result.stream, filename) : result.stream;
    return { body, size, contentType };
  }

  const file = path.join(MEDIA_DIR, filename);
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    size = info.size;
  } catch {
    return null;
  }
  if (size > MAX_MEDIA_BYTES) throw new MediaTooLargeError(filename, size);
  try {
    const body = await readFile(file);
    return { body, size: body.byteLength, contentType };
  } catch {
    return null;
  }
}

/** The whole file in memory, for callers that need bytes rather than a stream. */
export async function load(filename: string): Promise<Uint8Array | null> {
  const media = await openMedia(filename);
  if (!media) return null;
  if (media.body instanceof Uint8Array) return media.body;
  return new Uint8Array(await new Response(media.body).arrayBuffer());
}

export const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};
