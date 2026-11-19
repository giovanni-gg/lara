import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createDeck } from "@/app/actions";
import { getActiveProfile } from "@/lib/session";
import { getLanguage } from "@/lib/languages";
import { flattenWithPaths, loadDeckTree } from "@/lib/deck-tree";
import { DirectionPicker } from "@/components/direction-picker";
import { Button, Field, Screen, inputStyles } from "@/components/ui";
import { GenerateDeckForm } from "@/components/generate-deck-form";

export default async function NewDeckPage({ searchParams }: PageProps<"/decks/new">) {
  const { parent } = await searchParams;
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const { roots, byId } = await loadDeckTree(active.id);
  const folders = flattenWithPaths(roots);
  const parentId = typeof parent === "string" && byId.has(parent) ? parent : "";
  const parentNode = parentId ? byId.get(parentId) : undefined;

  const target = getLanguage(active.targetLanguage).name;
  const source = getLanguage(active.sourceLanguage).name;

  return (
    <Screen>
      <div className="pt-4">
        <Link
          href={parentId ? `/decks/${parentId}` : "/decks"}
          className="inline-flex items-center gap-1 py-1 text-xs text-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {parentNode?.name ?? "Decks"}
        </Link>
      </div>

      <h1 className="font-display mt-1 mb-4 text-2xl font-semibold tracking-tight">
        {parentNode ? "New subdeck" : "New deck"}
      </h1>

      {parentNode ? null : (
        // The quick path: describe it, get a finished deck with audio.
        <section className="mb-6">
          <h2 className="mb-2 font-display text-base font-semibold">Generate with AI</h2>
          <GenerateDeckForm targetName={target} sourceName={source} />
          <p className="mt-4 text-center text-xs uppercase tracking-wide text-muted">or start empty</p>
        </section>
      )}

      <form action={createDeck} className="space-y-3.5">
        <div className="flex gap-2">
          <div className="w-16 shrink-0">
            <Field label="Emoji">
              <input
                name="emoji"
                defaultValue="🗂️"
                maxLength={4}
                className={`${inputStyles} text-center`}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-1">
            <Field label="Name">
              <input
                name="name"
                required
                autoFocus
                placeholder="Kitchen vocabulary"
                className={inputStyles}
              />
            </Field>
          </div>
        </div>

        <Field label="Inside">
          <select name="parentId" defaultValue={parentId} className={inputStyles}>
            <option value="">Top level</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {/* Non-breaking spaces survive in <option>; regular ones collapse. */}
                {"  ".repeat(f.depth)}
                {f.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description" hint="Optional.">
          <input
            name="description"
            placeholder="Words I keep forgetting while cooking"
            className={inputStyles}
          />
        </Field>

        <div>
          <span className="mb-1 block text-sm font-medium">New cards show</span>
          <DirectionPicker target={target} source={source} />
        </div>

        <Button type="submit" className="w-full">
          Create deck
        </Button>
      </form>
    </Screen>
  );
}
