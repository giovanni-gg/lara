import { prisma } from "./db";
import { distilAbout } from "./ai/about";
import { hasAiCredentials } from "./ai/model";
import { MAX_ABOUT_CHARS } from "./learner-context";

/** A runaway summary is cut here; the prompt asks for ~120 words (≈800 characters). */
const MAX_SUMMARY_CHARS = 1200;

type Profile = {
  id: string;
  targetLanguage: string;
  sourceLanguage: string;
  about?: string | null;
  aboutSummary?: string | null;
};

/**
 * Saves what the learner wrote in "About you" and distils it into the note
 * the prompts use. Empty text clears both. The raw text is saved even when
 * the model call fails: `learnerContext` then falls back to it, trimmed.
 */
export async function saveAbout(profile: Profile, text: string): Promise<void> {
  const about = text.trim().slice(0, MAX_ABOUT_CHARS);
  if (!about) {
    await clearAbout(profile.id);
    return;
  }
  // Saved again unchanged: keep the summary rather than pay for the same one.
  if (about === profile.about && profile.aboutSummary) return;

  let aboutSummary: string | null = null;
  if (hasAiCredentials()) {
    try {
      const summary = await distilAbout({
        about,
        targetLanguage: profile.targetLanguage,
        sourceLanguage: profile.sourceLanguage,
      });
      aboutSummary = summary.slice(0, MAX_SUMMARY_CHARS).trim() || null;
    } catch (error) {
      console.warn("[about] couldn't distil the note, saving the raw text only:", error);
    }
  }

  await prisma.languageProfile.update({ where: { id: profile.id }, data: { about, aboutSummary } });
}

export async function clearAbout(profileId: string): Promise<void> {
  await prisma.languageProfile.update({ where: { id: profileId }, data: { about: null, aboutSummary: null } });
}
