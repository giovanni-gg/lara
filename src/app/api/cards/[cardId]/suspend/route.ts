import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { setCardSuspended } from "@/lib/study";

// An explicit value rather than a toggle, so a retried request is harmless.
const body = z.object({ suspended: z.boolean() });

/** Pauses (suspends) or resumes a card from the study screen. */
export async function POST(request: Request, { params }: RouteContext<"/api/cards/[cardId]/suspend">) {
  const { cardId } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { suspended: boolean }" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const found = await setCardSuspended({ userId: user.id, cardId, suspended: parsed.data.suspended });
  if (!found) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
