import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createDeck } from "@/app/actions";
import { Button, Field, Screen, inputStyles } from "@/components/ui";

export default function NewDeckPage() {
  return (
    <Screen>
      <div className="pt-5">
        <Link
          href="/decks"
          className="inline-flex items-center gap-1 text-sm text-muted"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Decks
        </Link>
      </div>

      <h1 className="font-display mt-4 mb-6 text-3xl font-semibold tracking-tight">
        New deck
      </h1>

      <form action={createDeck} className="space-y-5">
        <Field label="Name">
          <input
            name="name"
            required
            placeholder="Kitchen vocabulary"
            className={inputStyles}
          />
        </Field>

        <Field label="Emoji" hint="Shows next to the deck name.">
          <input
            name="emoji"
            defaultValue="🗂️"
            maxLength={4}
            className={inputStyles}
          />
        </Field>

        <Field label="Description" hint="Optional.">
          <input
            name="description"
            placeholder="Words I keep forgetting while cooking"
            className={inputStyles}
          />
        </Field>

        <Button type="submit" className="w-full min-h-13">
          Create deck
        </Button>
      </form>
    </Screen>
  );
}
