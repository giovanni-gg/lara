import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { createCard } from "@/app/actions";
import { Button, Field, Screen, inputStyles } from "@/components/ui";

export default async function NewCardPage({
  params,
}: PageProps<"/decks/[deckId]/cards/new">) {
  const { deckId } = await params;
  const user = await getCurrentUser();

  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!deck) notFound();

  async function submit(formData: FormData) {
    "use server";
    await createCard(formData);
    redirect(`/decks/${deckId}`);
  }

  return (
    <Screen>
      <div className="pt-5">
        <Link
          href={`/decks/${deck.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {deck.name}
        </Link>
      </div>

      <h1 className="font-display mt-4 mb-6 text-3xl font-semibold tracking-tight">
        New card
      </h1>

      <form action={submit} className="space-y-5">
        <input type="hidden" name="deckId" value={deck.id} />

        <Field label="Target language" hint="The word or phrase you're learning.">
          <input name="target" required autoFocus className={inputStyles} />
        </Field>

        <Field label="Translation">
          <input name="source" required className={inputStyles} />
        </Field>

        <Field label="Example sentence" hint="Optional, in the target language.">
          <input name="targetSentence" className={inputStyles} />
        </Field>

        <Field label="Sentence translation" hint="Optional.">
          <input name="sourceSentence" className={inputStyles} />
        </Field>

        <Field label="Note" hint="Gender, irregular form, anything easy to forget.">
          <input name="notes" className={inputStyles} />
        </Field>

        <Button type="submit" className="w-full min-h-13">
          Add card
        </Button>
        <p className="text-center text-xs text-muted">
          Audio is generated automatically when ELEVENLABS_API_KEY is set.
        </p>
      </form>
    </Screen>
  );
}
