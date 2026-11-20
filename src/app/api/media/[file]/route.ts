import { NextResponse } from "next/server";
import { MediaTooLargeError, openMedia } from "@/lib/media";
import { mediaResponse } from "@/lib/media-range";

/**
 * Serves card audio and images from whichever backend `MEDIA_STORAGE` selects.
 * With Blob the object is streamed straight through, never buffered.
 *
 * Honours single byte ranges (`206`): iOS Safari won't play <audio> from a
 * server that doesn't. A range of a Blob object is cut from the same stream.
 *
 * Keys are content hashes, so a URL's bytes never change: the phone caches each
 * clip for a year after its first play. `private` rather than `public` keeps
 * shared caches out of it — the media sits behind the same password as the app.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  try {
    const media = await openMedia(file);
    if (!media) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Awaited here: a range of an unsized stream reads it, and may hit the cap.
    return await mediaResponse(
      media,
      request.headers.get("range"),
      "private, max-age=31536000, immutable",
    );
  } catch (error) {
    if (error instanceof MediaTooLargeError) {
      console.error(`[media] ${error.message}`);
      return NextResponse.json({ error: "Media too large" }, { status: 502 });
    }
    throw error;
  }
}
