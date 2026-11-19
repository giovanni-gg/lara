import { redirect } from "next/navigation";
import { Mic } from "lucide-react";
import { getActiveProfile } from "@/lib/session";
import { getLanguage } from "@/lib/languages";
import { flattenWithPaths, loadDeckTree } from "@/lib/deck-tree";
import { speakSupports } from "@/lib/speak/prompt";
import { speakConfigured } from "@/lib/speak/session";
import { Speak, type SpeakDeckOption } from "@/components/speak";
import { EmptyState, PageHeader, Screen } from "@/components/ui";

/** Speak: a voice conversation with the tutor, in the language being learned. */
export default async function SpeakPage() {
  const { active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const target = getLanguage(active.targetLanguage).name;
  const source = getLanguage(active.sourceLanguage).name;
  const header = (
    <PageHeader title="Speak" subtitle={`Talk in ${target} at ${active.level}, with ${source} when you're stuck`} />
  );

  if (!speakSupports(active) || !speakConfigured()) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon={<Mic className="size-8" aria-hidden />}
          title="Speak isn't available"
          body={
            speakSupports(active)
              ? "The voice tutor isn't set up yet: it needs ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID (npm run speak:setup)."
              : "Speak works in English, Swedish and Portuguese for now."
          }
        />
      </Screen>
    );
  }

  // The study tree already leaves archived decks (and their subtrees) out.
  const { roots, byId } = await loadDeckTree(active.id);
  const decks: SpeakDeckOption[] = flattenWithPaths(roots)
    .filter((d) => {
      const node = byId.get(d.id);
      return node && !node.archivedAt && node.total.total > 0;
    })
    .map(({ id, label, depth }) => ({ id, label, depth }));

  return (
    <Screen>
      {header}
      <Speak decks={decks} learner={{ target, source, level: active.level }} />
    </Screen>
  );
}
