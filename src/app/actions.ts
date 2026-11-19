"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, requireActiveProfile } from "@/lib/session";
import { getLanguage } from "@/lib/languages";
import { newCardState } from "@/lib/srs";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { CefrLevel } from "@/generated/prisma/enums";
import { cardTypesFor, isCardDirection } from "@/lib/card-direction";
import { subtreeIds } from "@/lib/deck-tree";

export async function createProfile(formData: FormData) {
  const user = await getCurrentUser();
  const targetLanguage = String(formData.get("targetLanguage") ?? "").trim();
  const sourceLanguage = String(formData.get("sourceLanguage") ?? "en").trim();
  const level = String(formData.get("level") ?? "A1") as CefrLevel;

  if (!targetLanguage) throw new Error("Pick a language to learn");

  const existing = await prisma.languageProfile.findUnique({
    where: { userId_targetLanguage: { userId: user.id, targetLanguage } },
  });

  // Already studying this language — just switch to it.
  if (existing) {
    await activateProfile(existing.id);
    redirect("/");
  }

  // Only one profile is active at a time — the app studies one language at once.
  await prisma.$transaction([
    prisma.languageProfile.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    }),
    prisma.languageProfile.create({
      data: {
        userId: user.id,
        targetLanguage,
        sourceLanguage,
        level,
        voiceId: getLanguage(targetLanguage).voiceId ?? null,
        isActive: true,
      },
    }),
  ]);

  revalidatePath("/", "layout");
  redirect("/");
}

export async function activateProfile(profileId: string) {
  const user = await getCurrentUser();
  await prisma.$transaction([
    prisma.languageProfile.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    }),
    prisma.languageProfile.update({
      where: { id: profileId },
      data: { isActive: true },
    }),
  ]);
  revalidatePath("/", "layout");
}

export async function updateProfileSettings(formData: FormData) {
  const { profile } = await requireActiveProfile();
  const level = String(formData.get("level") ?? profile.level) as CefrLevel;
  const dailyNewLimit = Number(formData.get("dailyNewLimit") ?? profile.dailyNewLimit);
  const dailyReviewLimit = Number(
    formData.get("dailyReviewLimit") ?? profile.dailyReviewLimit,
  );

  await prisma.languageProfile.update({
    where: { id: profile.id },
    data: {
      level,
      dailyNewLimit: clamp(dailyNewLimit, 0, 500),
      // Anki's "9999 reviews/day" means "no cap"; allow it.
      dailyReviewLimit: clamp(dailyReviewLimit, 0, 9999),
    },
  });

  revalidatePath("/", "layout");
}

export async function createDeck(formData: FormData) {
  const { user, profile } = await requireActiveProfile();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Give the deck a name");

  const direction = formData.get("direction");
  const parentId = String(formData.get("parentId") ?? "") || null;
  if (parentId) {
    const parent = await prisma.deck.findFirst({
      where: { id: parentId, profileId: profile.id },
      select: { id: true },
    });
    if (!parent) throw new Error("Folder not found");
  }

  const deck = await prisma.deck.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      parentId,
      name,
      emoji: String(formData.get("emoji") ?? "").trim() || "🗂️",
      description: String(formData.get("description") ?? "").trim() || null,
      direction: isCardDirection(direction) ? direction : "RECOGNITION",
    },
  });

  revalidatePath("/decks");
  redirect(`/decks/${deck.id}`);
}

/** Put a deck inside another (or back at the top level with an empty parent). */
export async function moveDeck(formData: FormData) {
  const { profile } = await requireActiveProfile();
  const deckId = String(formData.get("deckId") ?? "");
  const parentId = String(formData.get("parentId") ?? "") || null;

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, profileId: profile.id },
    select: { id: true },
  });
  if (!deck) throw new Error("Deck not found");

  if (parentId) {
    // A deck can't go inside itself or anything beneath it.
    if ((await subtreeIds(profile.id, deck.id)).includes(parentId)) {
      throw new Error("A deck can't be moved into one of its own subdecks");
    }
    const parent = await prisma.deck.findFirst({
      where: { id: parentId, profileId: profile.id },
      select: { id: true },
    });
    if (!parent) throw new Error("Folder not found");
  }

  await prisma.deck.update({ where: { id: deck.id }, data: { parentId } });
  revalidatePath("/decks");
  revalidatePath(`/decks/${deck.id}`);
}

export async function createCard(formData: FormData) {
  const { user, profile } = await requireActiveProfile();
  const deckId = String(formData.get("deckId") ?? "");
  const target = String(formData.get("target") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();

  if (!deckId || !target || !source) {
    throw new Error("A card needs a deck, a word, and a translation");
  }

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
  });
  if (!deck) throw new Error("Deck not found");

  const requested = formData.get("direction");
  const cardTypes = cardTypesFor(isCardDirection(requested) ? requested : deck.direction);

  const targetSentence =
    String(formData.get("targetSentence") ?? "").trim() || null;

  const audioUrl = ttsAvailable()
    ? await trySynthesize({
        text: target,
        language: profile.targetLanguage,
        voiceId: profile.voiceId,
      })
    : null;

  const sourceSentence = String(formData.get("sourceSentence") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await prisma.card.createMany({
    data: cardTypes.map((cardType) => ({
      userId: user.id,
      deckId,
      target,
      source,
      targetSentence,
      sourceSentence,
      notes,
      cardType,
      audioUrl,
      ...newCardState(),
    })),
  });

  revalidatePath(`/decks/${deckId}`);
}

export async function deleteDeck(deckId: string) {
  const user = await getCurrentUser();
  await prisma.deck.deleteMany({ where: { id: deckId, userId: user.id } });
  revalidatePath("/decks");
  redirect("/decks");
}

export async function deleteCard(cardId: string) {
  const user = await getCurrentUser();
  const card = await prisma.card.findFirst({
    where: { id: cardId, userId: user.id },
    select: { deckId: true },
  });
  if (!card) return;
  await prisma.card.delete({ where: { id: cardId } });
  revalidatePath(`/decks/${card.deckId}`);
}

export async function toggleCardSuspended(cardId: string) {
  const user = await getCurrentUser();
  const card = await prisma.card.findFirst({
    where: { id: cardId, userId: user.id },
    select: { id: true, deckId: true, suspended: true },
  });
  if (!card) return;
  await prisma.card.update({
    where: { id: card.id },
    data: { suspended: !card.suspended },
  });
  revalidatePath(`/decks/${card.deckId}`);
}

export async function markArticleRead(articleId: string) {
  const user = await getCurrentUser();
  await prisma.article.updateMany({
    where: { id: articleId, userId: user.id },
    data: { readAt: new Date() },
  });
  revalidatePath("/articles");
}

export async function deleteArticle(articleId: string) {
  const user = await getCurrentUser();
  await prisma.article.deleteMany({ where: { id: articleId, userId: user.id } });
  revalidatePath("/articles");
  redirect("/articles");
}

/** Turn a word encountered while reading into a card in a "From reading" deck. */
export async function saveWordFromArticle(target: string, source: string) {
  const { user, profile } = await requireActiveProfile();
  const name = "From reading";

  const deck =
    (await prisma.deck.findFirst({
      where: { userId: user.id, profileId: profile.id, name },
    })) ??
    (await prisma.deck.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        name,
        emoji: "📖",
        description: "Words saved while reading immersion articles",
      },
    }));

  const existing = await prisma.card.findFirst({
    where: { userId: user.id, deckId: deck.id, target },
  });
  if (existing) return { ok: true, duplicate: true };

  const audioUrl = ttsAvailable()
    ? await trySynthesize({
        text: target,
        language: profile.targetLanguage,
        voiceId: profile.voiceId,
      })
    : null;

  await prisma.card.create({
    data: {
      userId: user.id,
      deckId: deck.id,
      target,
      source,
      tags: ["reading"],
      audioUrl,
      ...newCardState(),
    },
  });

  revalidatePath("/decks");
  return { ok: true, duplicate: false };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
