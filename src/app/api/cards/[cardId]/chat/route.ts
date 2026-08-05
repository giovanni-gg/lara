import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { MissingAiCredentialsError } from "@/lib/ai/model";
import { streamTutorReply, type CardContext } from "@/lib/ai/tutor";
import { ChatRole } from "@/generated/prisma/enums";

export const maxDuration = 120;

const body = z.object({ question: z.string().min(1).max(1000) });

/** Load a card the current user owns, plus the language context the tutor needs. */
async function loadCard(cardId: string, userId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, userId },
    select: {
      id: true,
      target: true,
      source: true,
      targetSentence: true,
      sourceSentence: true,
      notes: true,
      deck: {
        select: {
          profile: {
            select: {
              targetLanguage: true,
              sourceLanguage: true,
              level: true,
            },
          },
        },
      },
    },
  });
  if (!card) return null;

  const context: CardContext = {
    target: card.target,
    source: card.source,
    targetSentence: card.targetSentence,
    sourceSentence: card.sourceSentence,
    notes: card.notes,
    ...card.deck.profile,
  };
  return { id: card.id, context };
}

/** Prior conversation for this card, so the thread survives across sessions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params;
  const user = await getCurrentUser();

  const card = await loadCard(cardId, user.id);
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const messages = await prisma.cardChatMessage.findMany({
    where: { cardId, userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return NextResponse.json({
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role === ChatRole.USER ? "user" : "assistant",
      content: message.content,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const { cardId } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { question }" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const card = await loadCard(cardId, user.id);
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const history = await prisma.cardChatMessage.findMany({
    where: { cardId, userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  let result;
  try {
    result = streamTutorReply({
      card: card.context,
      history: history.map((message) => ({
        role: message.role === ChatRole.USER ? ("user" as const) : ("assistant" as const),
        content: message.content,
      })),
      question: parsed.data.question,
    });
  } catch (error) {
    if (error instanceof MissingAiCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  // Persist the question immediately, and the answer once the stream finishes,
  // so a thread survives the learner backgrounding the app mid-answer.
  await prisma.cardChatMessage.create({
    data: { cardId, userId: user.id, role: ChatRole.USER, content: parsed.data.question },
  });

  void (async () => {
    try {
      const text = await result.text;
      await prisma.cardChatMessage.create({
        data: { cardId, userId: user.id, role: ChatRole.ASSISTANT, content: text },
      });
    } catch {
      // A failed generation just leaves the question in the thread; the learner
      // can ask again. Nothing to recover here.
    }
  })();

  return result.toTextStreamResponse();
}
