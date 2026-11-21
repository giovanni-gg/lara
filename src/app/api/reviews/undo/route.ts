import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { UndoError, undoReview } from "@/lib/study";

const body = z.object({ reviewId: z.string().min(1) });

/**
 * Takes back one answer (the study screen's undo): deletes the review and
 * restores the card's schedule. 404 when there's no such review of yours (or
 * it was already undone), 409 when it can't be undone; the session doesn't
 * retry either.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { reviewId }" }, { status: 400 });
  }

  const user = await getCurrentUser();
  try {
    const card = await undoReview({ userId: user.id, reviewId: parsed.data.reviewId });
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    if (error instanceof UndoError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
