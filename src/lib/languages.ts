import type { CefrLevel } from "@/generated/prisma/enums";

export type LanguageInfo = {
  code: string;
  name: string;
  flag: string;
  /** ElevenLabs voice — carried over from the anki_creator config. */
  voiceId?: string;
};

export const LANGUAGES: LanguageInfo[] = [
  { code: "sv", name: "Swedish", flag: "🇸🇪", voiceId: "aSLKtNoVBZlxQEMsnGL2" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷", voiceId: "QJd9SLe6MVCdF6DR0EAu" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "da", name: "Danish", flag: "🇩🇰" },
  { code: "no", name: "Norwegian", flag: "🇳🇴" },
  { code: "pl", name: "Polish", flag: "🇵🇱" },
  { code: "en", name: "English", flag: "🇬🇧" },
];

export function getLanguage(code: string): LanguageInfo {
  return (
    LANGUAGES.find((l) => l.code === code) ?? {
      code,
      name: code.toUpperCase(),
      flag: "🌍",
    }
  );
}

export const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const CEFR_DESCRIPTIONS: Record<CefrLevel, string> = {
  A1: "Beginner — single words and set phrases",
  A2: "Elementary — simple everyday exchanges",
  B1: "Intermediate — familiar topics, connected text",
  B2: "Upper intermediate — abstract topics, clear detail",
  C1: "Advanced — fluent, implicit meaning",
  C2: "Mastery — effortless, nuanced",
};

/**
 * The immersion rule: content is written one level above where the learner is,
 * so it stays comprehensible while still stretching them. C2 has no next step.
 */
export function nextLevelUp(level: CefrLevel): CefrLevel {
  const index = CEFR_LEVELS.indexOf(level);
  return CEFR_LEVELS[Math.min(index + 1, CEFR_LEVELS.length - 1)];
}
