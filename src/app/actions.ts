"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, requireActiveProfile } from "@/lib/session";
import { getLanguage } from "@/lib/languages";
import { newCardState } from "@/lib/srs";
import { trySynthesize, ttsAvailable } from "@/lib/tts";
import { CardType, CefrLevel } from "@/generated/prisma/enums";
import { cardTypesFor, isCardDirection } from "@/lib/card-direction";
import { subtreeIds } from "@/lib/deck-tree";
import { generateCardImage, imagesAvailable } from "@/lib/images";

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

  // Daily limits live on each deck now (Deck.newCardsPerDay); reviews are
  // never capped. The level is the only study setting left on the profile.
  await prisma.languageProfile.update({
    where: { id: profile.id },
    data: { level },
  });

  revalidatePath("/", "layout");
}

export async function createDeck(formData: FormData) {
  const { user, profile } = await requireActiveProfile();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Give the deck a name");

  const direction = formData.get("direction");
  const parentId = String(formData.get("parentId") ?? "") || null;
  // A deck created inside an archived one is archived with it.
  let archivedAt: Date | null = null;
  if (parentId) {
    const parent = await prisma.deck.findFirst({
      where: { id: parentId, profileId: profile.id },
      select: { id: true, archivedAt: true },
    });
    if (!parent) throw new Error("Folder not found");
    archivedAt = parent.archivedAt;
  }

  const deck = await prisma.deck.create({
    data: {
      userId: user.id,
      profileId: profile.id,
      parentId,
      archivedAt,
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
      select: { id: true, archivedAt: true },
    });
    if (!parent) throw new Error("Folder not found");
    // Moving into an archived deck archives the moved subtree too, keeping
    // the invariant that a subtree is archived as a whole.
    if (parent.archivedAt) {
      await setArchived(profile.id, deck.id, parent.archivedAt);
    }
  }

  await prisma.deck.update({ where: { id: deck.id }, data: { parentId } });
  revalidatePath("/decks");
  revalidatePath(`/decks/${deck.id}`);
}

/** Anki's "New cards/day", per deck. */
export async function updateDeckNewCardsPerDay(formData: FormData) {
  const { profile } = await requireActiveProfile();
  const deckId = String(formData.get("deckId") ?? "");
  const value = Number(formData.get("newCardsPerDay"));
  if (!Number.isFinite(value)) throw new Error("Enter a number of new cards per day");

  const { count } = await prisma.deck.updateMany({
    where: { id: deckId, profileId: profile.id },
    data: { newCardsPerDay: clamp(value, 0, 999) },
  });
  if (count === 0) throw new Error("Deck not found");

  revalidatePath("/", "layout");
}

/** Archive a deck and everything beneath it: out of study, counts and lists. */
export async function archiveDeck(formData: FormData) {
  const { profile } = await requireActiveProfile();
  const deckId = String(formData.get("deckId") ?? "");
  await setArchived(profile.id, deckId, new Date());
  revalidatePath("/", "layout");
}

/** Bring an archived deck (and its subdecks) back into study. */
export async function unarchiveDeck(formData: FormData) {
  const { profile } = await requireActiveProfile();
  const deckId = String(formData.get("deckId") ?? "");

  // Unarchiving a deck whose parent is still archived would orphan it in a
  // hidden tree, so it moves to the top level.
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, profileId: profile.id },
    select: { parent: { select: { archivedAt: true } } },
  });
  if (!deck) throw new Error("Deck not found");
  if (deck.parent?.archivedAt) {
    await prisma.deck.update({ where: { id: deckId }, data: { parentId: null } });
  }
  await setArchived(profile.id, deckId, null);
  revalidatePath("/", "layout");
}

async function setArchived(profileId: string, deckId: string, archivedAt: Date | null) {
  const ids = await subtreeIds(profileId, deckId);
  if (ids.length === 0) throw new Error("Deck not found");
  await prisma.deck.updateMany({
    where: { id: { in: ids }, profileId },
    data: { archivedAt },
  });
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

  const created = await prisma.card.createManyAndReturn({
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
    select: { id: true, cardType: true },
  });

  // The picture is drawn after the response; until it lands the card is
  // studied from its translation.
  const picture = created.find((card) => card.cardType === CardType.PICTURE);
  if (picture && !imagesAvailable()) {
    console.warn("[createCard] GEMINI_API_KEY is not set: picture card created without a picture");
  } else if (picture) {
    const languages = { targetLanguage: profile.targetLanguage, sourceLanguage: profile.sourceLanguage };
    after(async () => {
      const imageUrl = await generateCardImage({ ...languages, target, source });
      // updateMany: the card may have been deleted while its picture was drawn.
      if (imageUrl) await prisma.card.updateMany({ where: { id: picture.id }, data: { imageUrl } });
    });
  }

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
