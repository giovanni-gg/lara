import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getLanguage } from "@/lib/languages";
import { createCard } from "@/app/actions";
import { DirectionPicker } from "@/components/direction-picker";
import { Button, Field, Screen, inputStyles } from "@/components/ui";

export default async function NewCardPage({
  params,
}: PageProps<"/decks/[deckId]/cards/new">) {
  const { deckId } = await params;
  const user = await getCurrentUser();

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: {
      id: true,
      name: true,
      direction: true,
      profile: { select: { targetLanguage: true, sourceLanguage: true } },
    },
  });
  if (!deck) notFound();

  const target = getLanguage(deck.profile.targetLanguage).name;
  const source = getLanguage(deck.profile.sourceLanguage).name;

  async function submit(formData: FormData) {
    "use server";
    await createCard(formData);
    redirect(`/decks/${deckId}`);
  }

  return (
    <Screen>
      <div className="pt-4">
        <Link
          href={`/decks/${deck.id}`}
          className="inline-flex max-w-full items-center gap-1 py-1 text-xs text-muted"
        >
          <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{deck.name}</span>
        </Link>
      </div>

      <h1 className="font-display mt-1 mb-4 text-2xl font-semibold tracking-tight">
        New card
      </h1>

      <form action={submit} className="space-y-3.5">
        <input type="hidden" name="deckId" value={deck.id} />

        <Field label={target}>
          <input name="target" required autoFocus className={inputStyles} />
        </Field>

        <Field label={source}>
          <input name="source" required className={inputStyles} />
        </Field>

        <Field label="Example sentence" hint={`Optional, in ${target}.`}>
          <input name="targetSentence" className={inputStyles} />
        </Field>

        <Field label="Sentence translation">
          <input name="sourceSentence" placeholder="Optional" className={inputStyles} />
        </Field>

        <Field label="Note">
          <textarea
            name="notes"
            rows={2}
            placeholder="Gender, irregular form, anything easy to forget"
            className={`${inputStyles} resize-y`}
          />
        </Field>

        <div>
          <span className="mb-1 block text-sm font-medium">Show first</span>
          <DirectionPicker target={target} source={source} defaultValue={deck.direction} />
        </div>

        <Button type="submit" className="w-full">
          Add card
        </Button>
        <p className="text-center text-xs text-muted">
          Audio is generated automatically when ELEVENLABS_API_KEY is set.
        </p>
      </form>
    </Screen>
  );
}
