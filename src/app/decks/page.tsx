import { redirect } from "next/navigation";
import { Layers, Plus } from "lucide-react";
import { getActiveProfile } from "@/lib/session";
import { loadDeckTree } from "@/lib/deck-tree";
import { DeckTree } from "@/components/deck-tree";
import { ButtonLink, EmptyState, PageHeader, Screen } from "@/components/ui";

export default async function DecksPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const { roots, byId } = await loadDeckTree(active.id);
  const due = roots.reduce((n, r) => n + r.total.due, 0);
  const fresh = roots.reduce((n, r) => n + r.total.fresh, 0);

  return (
    <Screen>
      <PageHeader
        title="Decks"
        subtitle={`${byId.size} ${byId.size === 1 ? "deck" : "decks"} · ${due} due · ${fresh} new`}
        action={
          <ButtonLink href="/decks/new" variant="secondary" size="sm" className="shrink-0">
            <Plus className="size-4" aria-hidden />
            New
          </ButtonLink>
        }
      />

      {roots.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-8" aria-hidden />}
          title="No decks yet"
          body="Generate one from a prompt on the Today screen, or create an empty deck and add cards yourself."
          action={<ButtonLink href="/">Go to Today</ButtonLink>}
        />
      ) : (
        <DeckTree roots={roots} newLimit={active.dailyNewLimit} />
      )}
    </Screen>
  );
}
