// "About you": what the learner told LaraMig about their life, turned into a
// short note every content prompt can lean on (cards, deck chips, stories,
// Speak). Pure and client-safe: no database, no model.

/** The most the learner can save, typed or dictated. */
export const MAX_ABOUT_CHARS = 4000;

/** Without a summary (the distil call failed), how much raw text a prompt gets. */
export const RAW_CONTEXT_CHARS = 600;

/** Anything holding the two "About you" columns, e.g. a LanguageProfile row. */
export type AboutFields = {
  about?: string | null;
  aboutSummary?: string | null;
};

/** Collapses whitespace runs and trims; keeps paragraph breaks out of prompts. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts at a word boundary and marks the cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The note about the learner that prompts get, or null when there is none:
 * the distilled summary, else (the model was down when they saved) their own
 * words, trimmed.
 */
export function learnerContext(profile: AboutFields | null | undefined): string | null {
  const summary = squash(profile?.aboutSummary ?? "");
  if (summary) return summary;
  const raw = squash(profile?.about ?? "");
  return raw ? clip(raw, RAW_CONTEXT_CHARS) : null;
}

/**
 * The shared rules for using the note, so every generator says the same thing.
 * `subject` is what the note may shape ("example sentences", "the story").
 */
export function learnerContextRules(subject: string): string {
  return [
    `You also get a short note about the learner's life. Where it fits, let it shape ${subject}, so the material is about their world rather than a textbook's.`,
    "Use it naturally and lightly: not in every item, and never the same personal fact over and over.",
    "Never invent facts about the learner beyond what the note says, and never mention that you were given a note.",
  ].join(" ");
}

/** The note as a prompt block. */
export function learnerNoteBlock(note: string): string {
  return `About the learner (from their profile):\n${note}`;
}
