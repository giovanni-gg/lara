import { createProfile } from "@/app/actions";
import { CEFR_DESCRIPTIONS, CEFR_LEVELS, LANGUAGES } from "@/lib/languages";
import { Button, Field, Screen, inputStyles } from "@/components/ui";

export default function OnboardingPage() {
  return (
    <Screen>
      <div className="pt-16 pb-8 text-center">
        <p className="font-display text-5xl">🪶</p>
        <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight">
          Lara
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm text-muted">
          Flashcards you create by describing them, and reading pitched just
          above your level.
        </p>
      </div>

      <form action={createProfile} className="space-y-5">
        <Field label="I want to learn">
          <select name="targetLanguage" defaultValue="sv" className={inputStyles}>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.flag} {language.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="I already speak">
          <select name="sourceLanguage" defaultValue="en" className={inputStyles}>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.flag} {language.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Where you are now"
          hint="Stories get written one level above this, so you always meet a little new language."
        >
          <select name="level" defaultValue="A1" className={inputStyles}>
            {CEFR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level} — {CEFR_DESCRIPTIONS[level]}
              </option>
            ))}
          </select>
        </Field>

        <Button type="submit" className="w-full min-h-14 text-base">
          Start learning
        </Button>
      </form>
    </Screen>
  );
}
