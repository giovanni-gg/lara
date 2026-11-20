import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getActiveProfile } from "@/lib/session";
import { nextLevelUp } from "@/lib/languages";
import { storiesLeftToday } from "@/lib/allowance";
import { flattenWithPaths, loadDeckTree } from "@/lib/deck-tree";
import { GenerateStoryForm, type StoryDeckOption } from "@/components/generate-story-form";
import { PageHeader, Screen } from "@/components/ui";

export default async function NewStoryPage({ searchParams }: PageProps<"/articles/new">) {
  const { deck } = await searchParams;
  const { user, active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  // Sequential: the tree runs an aggregate query (see AGENTS.md).
  const { roots, byId } = await loadDeckTree(active.id);
  const archived = await prisma.deck.findMany({
    where: { profileId: active.id, archivedAt: { not: null } },
    select: { id: true },
  });
  // Archiving covers a whole subtree, so each deck's own column is enough.
  const skip = new Set(archived.map((d) => d.id));
  const storiesLeft = await storiesLeftToday(user);

  const decks: StoryDeckOption[] = flattenWithPaths(roots)
    .filter((d) => !skip.has(d.id))
    .map((d) => ({ ...d, cards: byId.get(d.id)?.total.total ?? 0 }))
    .filter((d) => d.cards > 0);

  const requested = typeof deck === "string" ? deck : undefined;
  const defaultDeckId = decks.some((d) => d.id === requested) ? requested : undefined;

  return (
    <Screen>
      <div className="pt-4">
        <Link href="/articles" className="inline-flex items-center gap-1 py-1 text-sm text-muted">
          <ChevronLeft className="size-4" aria-hidden />
          Listen &amp; Read
        </Link>
      </div>
      <PageHeader
        title="New story"
        subtitle={`Written at ${nextLevelUp(active.level)} with audio, mostly from words you know`}
      />
      <GenerateStoryForm decks={decks} defaultDeckId={defaultDeckId} storiesLeft={storiesLeft} />
    </Screen>
  );
}
