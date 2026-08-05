import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { submitReview } from "@/lib/study";
import { isRatingValue } from "@/lib/srs";

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

  try {
    const card = await submitReview({ userId: user.id, cardId, rating, durationMs });
    return NextResponse.json({
      ok: true,
      due: card.due,
      state: card.state,
      scheduledDays: card.scheduledDays,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
