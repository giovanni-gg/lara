import { NextResponse } from "next/server";
import { MediaTooLargeError, openMedia } from "@/lib/media";

/**
 * Serves card audio and images from whichever backend `MEDIA_STORAGE` selects.
 * With Blob the object is streamed straight through, never buffered.
 *
 * Keys are content hashes, so a URL's bytes never change: the phone caches each
 * clip for a year after its first play. `private` rather than `public` keeps
 * shared caches out of it — the media sits behind the same password as the app.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  let media;
  try {
    media = await openMedia(file);
  } catch (error) {
    if (error instanceof MediaTooLargeError) {
      console.error(`[media] ${error.message}`);
      return NextResponse.json({ error: "Media too large" }, { status: 502 });
    }
    throw error;
  }

  if (!media) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": media.contentType,
    "cache-control": "private, max-age=31536000, immutable",
  };
  if (media.size !== null) headers["content-length"] = String(media.size);

  // Local mode hands back a Buffer, which isn't a BodyInit; the copy is
  // development-only and bounded by MAX_MEDIA_BYTES.
  const body =
    media.body instanceof ReadableStream ? media.body : new Uint8Array(media.body);
  return new Response(body, { headers });
}
