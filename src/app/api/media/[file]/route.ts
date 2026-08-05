import { NextResponse } from "next/server";
import { CONTENT_TYPES, load } from "@/lib/media";

/** Serves locally generated audio. In production this becomes a Blob URL. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const data = await load(file);

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(Buffer.from(data), {
    headers: {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
