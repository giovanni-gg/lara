import { redirect } from "next/navigation";
import { ButtonLink, Screen } from "@/components/ui";
import { StudySession } from "@/components/study-session";
import { getActiveProfile } from "@/lib/session";
import { buildQueue } from "@/lib/study";
import { deckPath, subtreeIds } from "@/lib/deck-tree";
import { getLanguage } from "@/lib/languages";

export default async function StudyPage({
  searchParams,
}: PageProps<"/study">) {
  const { deck } = await searchParams;
  const deckId = typeof deck === "string" ? deck : undefined;

  const { user, active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const cards = await buildQueue({
    userId: user.id,
    profileId: active.id,
    // Studying a folder studies everything beneath it, as in Anki.
    deckIds: deckId ? await subtreeIds(active.id, deckId) : undefined,
  });

  if (cards.length === 0) {
    return (
      <Screen>
        <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-5 text-center">
          <p className="font-display text-5xl">☕</p>
          <div>
            <h1 className="font-display text-2xl font-semibold">
              Nothing due right now
            </h1>
            <p className="mt-2 text-sm text-muted">
              Reviews come back on their own schedule. Add cards or read
              something in the meantime.
            </p>
          </div>
          <ButtonLink href="/decks" variant="secondary">
            Back to decks
          </ButtonLink>
        </div>
      </Screen>
    );
  }

  const deckName = deckId
    ? (await deckPath(deckId)).map((d) => d.name).join(" · ") || "Study"
    : "All decks";

  return (
    <StudySession
      cards={cards}
      deckName={deckName}
      targetLanguage={getLanguage(active.targetLanguage).name}
    />
  );
}
