import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

/**
 * Generated audio lives on disk in development and is served back through
 * /api/media/[key]. Swapping to Vercel Blob later means replacing `store` and
 * `publicUrl` — nothing that calls them has to change.
 */

const MEDIA_DIR = path.join(process.cwd(), ".media");

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

export async function exists(key: string, extension = "mp3"): Promise<boolean> {
  try {
    await access(path.join(MEDIA_DIR, `${key}.${extension}`));
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
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, `${key}.${extension}`), data);
  return publicUrl(key, extension);
}

export async function load(filename: string): Promise<Uint8Array | null> {
  // Guard against traversal: only a bare filename is ever valid here.
  const safe = path.basename(filename);
  if (safe !== filename) return null;
  try {
    return await readFile(path.join(MEDIA_DIR, safe));
  } catch {
    return null;
  }
}

export const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};
