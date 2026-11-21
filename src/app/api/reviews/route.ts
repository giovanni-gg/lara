import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { describeInterval, submitReview } from "@/lib/study";
import { isRatingValue, previewIntervals } from "@/lib/srs";

const body = z.object({
  cardId: z.string().min(1),
  rating: z.number().int().min(1).max(4),
  durationMs: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { cardId, rating: 1-4 }" },
      { status: 400 },
    );
  }

  const { cardId, rating, durationMs } = parsed.data;
  if (!isRatingValue(rating)) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const now = new Date();

  try {
    const { card, reviewId } = await submitReview({ userId: user.id, cardId, rating, durationMs, now });
    // The card's new schedule, labelled like buildQueue's, so a session can
    // show a still-learning card again with fresh answer-button intervals.
    const previews = previewIntervals(card, now);
    return NextResponse.json({
      ok: true,
      // What the session sends to /api/reviews/undo to take this answer back.
      reviewId,
      card: {
        id: card.id,
        state: card.state,
        due: card.due,
        intervals: {
          1: describeInterval(previews[1], now),
          2: describeInterval(previews[2], now),
          3: describeInterval(previews[3], now),
          4: describeInterval(previews[4], now),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
