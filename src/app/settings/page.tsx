import { redirect } from "next/navigation";
import { activateProfile, updateProfileSettings } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import { getActiveProfile } from "@/lib/session";
import {
  CEFR_DESCRIPTIONS,
  CEFR_LEVELS,
  getLanguage,
  nextLevelUp,
} from "@/lib/languages";
import { hasAiCredentials } from "@/lib/ai/model";
import { ttsAvailable } from "@/lib/tts";
import { SCHEDULER_SETTINGS } from "@/lib/srs";
import { loadProgress } from "@/lib/progress";
import { ProgressSection } from "@/components/progress-charts";
import {
  Button,
  Field,
  PageHeader,
  Panel,
  Screen,
  inputStyles,
} from "@/components/ui";

export default async function SettingsPage() {
  const { profiles, active } = await getActiveProfile();
  if (!active) redirect("/onboarding");

  const language = getLanguage(active.targetLanguage);
  const source = getLanguage(active.sourceLanguage);
  const progress = await loadProgress(active.id);

  return (
    <Screen>
      <PageHeader
        title="You"
        subtitle={`${language.flag} ${language.name} from ${source.name}`}
      />

      <ProgressSection progress={progress} />

      {profiles.length > 1 ? (
        <section className="mb-5">
          <h2 className="mb-2 font-display text-base font-semibold">Language</h2>
          <ul className="space-y-2">
            {profiles.map((profile) => {
              const info = getLanguage(profile.targetLanguage);
              return (
                <li key={profile.id}>
                  <form
                    action={async () => {
                      "use server";
                      await activateProfile(profile.id);
                    }}
                  >
                    <button
                      type="submit"
                      className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${
                        profile.isActive
                          ? "border-accent/60 bg-accent/10"
                          : "border-line bg-surface"
                      }`}
                    >
                      <span className="text-2xl" aria-hidden>
                        {info.flag}
                      </span>
                      <span className="flex-1 font-medium">{info.name}</span>
                      <span className="text-xs text-muted">{profile.level}</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mb-5">
        <h2 className="mb-2 font-display text-base font-semibold">Study</h2>
        <form action={updateProfileSettings} className="space-y-3">
          <Field
            label="Your level"
            hint={`Stories will be written at ${nextLevelUp(active.level)}.`}
          >
            <select
              name="level"
              defaultValue={active.level}
              className={inputStyles}
            >
              {CEFR_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level} — {CEFR_DESCRIPTIONS[level]}
                </option>
              ))}
            </select>
          </Field>

          <p className="text-xs text-muted">
            New cards per day are set on each deck (default 5). Reviews are
            never capped — everything due is always shown.
          </p>

          <Button type="submit" className="w-full">
            Save
          </Button>
        </form>
      </section>


      <section>
        <h2 className="mb-2 font-display text-base font-semibold">Status</h2>
        <Panel className="space-y-2 text-sm">
          <StatusRow
            label="Card & story generation"
            ok={hasAiCredentials()}
            hint="Set ANTHROPIC_API_KEY in .env"
          />
          <StatusRow
            label="Audio (ElevenLabs)"
            ok={ttsAvailable()}
            hint="Set ELEVENLABS_API_KEY in .env"
          />
          <StatusRow
            label="Scheduler"
            ok
            hint={`FSRS-6 · ${Math.round(SCHEDULER_SETTINGS.desiredRetention * 100)}% retention · ${SCHEDULER_SETTINGS.learningSteps.join(" ")} steps · day starts ${SCHEDULER_SETTINGS.dayStartsAtHour}:00 — same as your Anki`}
          />
        </Panel>
      </section>

      <form action={signOut} className="mt-5">
        <Button type="submit" variant="ghost" className="w-full">
          Sign out
        </Button>
      </form>
    </Screen>
  );
}

function StatusRow({
  label,
  ok,
  hint,
}: {
  label: string;
  ok: boolean;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <span
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          ok ? "bg-good/15 text-good" : "bg-again/15 text-again"
        }`}
      >
        {ok ? "ready" : "off"}
      </span>
    </div>
  );
}
