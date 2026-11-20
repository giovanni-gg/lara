import type { CardDirection } from "@/generated/prisma/enums";
import { getLanguage } from "./languages";

/**
 * Copy for the "How Lara works" page, built from the learner's own languages
 * so the card types read the way the direction picker names them
 * ("Swedish first", "English first", "Picture first").
 */

/** "apple" in each language, for the little card faces. The picture side is 🍎. */
const APPLE: Record<string, string> = {
  sv: "äpple",
  pt: "maçã",
  en: "apple",
  es: "manzana",
  de: "Apfel",
  fr: "pomme",
  it: "mela",
  nl: "appel",
  da: "æble",
  no: "eple",
  pl: "jabłko",
};

export const PICTURE_FRONT = "🍎";

export type CardTypeGuide = {
  kind: Exclude<CardDirection, "BOTH">;
  /** Matches the direction picker's label. */
  title: string;
  /** What the front of the sample card shows, and what you answer with. */
  front: string;
  answer: string;
  skill: string;
  /** 1 = easiest of the three, 3 = hardest. */
  effort: 1 | 2 | 3;
  effortLabel: string;
  body: string;
  howMany: string;
};

type Languages = { targetLanguage: string; sourceLanguage: string };

/** Language names for the copy, with a readable fallback before onboarding. */
export function guideLanguages(profile: Languages | null) {
  if (!profile) {
    return { target: "your new language", source: "English", targetCode: null, sourceCode: "en" };
  }
  return {
    target: getLanguage(profile.targetLanguage).name,
    source: getLanguage(profile.sourceLanguage).name,
    targetCode: profile.targetLanguage,
    sourceCode: profile.sourceLanguage,
  };
}

function sampleWord(code: string | null, fallback: string): string {
  return (code && APPLE[code]) || fallback;
}

/** Capitalise the first letter only ("your new language first" → "Your new …"). */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function cardTypeGuide(profile: Languages | null): CardTypeGuide[] {
  const { target, source, targetCode, sourceCode } = guideLanguages(profile);
  const targetWord = sampleWord(targetCode, "…");
  const sourceWord = sampleWord(sourceCode, "apple");

  return [
    {
      kind: "RECOGNITION",
      title: sentence(`${target} first`),
      front: targetWord,
      answer: sourceWord,
      skill: "Recognition",
      effort: 1,
      effortLabel: "Easiest",
      body: `You see the ${target} word and recall what it means. The quickest way to a broad vocabulary for reading and listening.`,
      howMany: "Most of your cards",
    },
    {
      kind: "PRODUCTION",
      title: sentence(`${source} first`),
      front: sourceWord,
      answer: targetWord,
      skill: "Production",
      effort: 3,
      effortLabel: "Hardest",
      body: `You see the ${source} word and have to come up with the ${target} one. It's what speaking asks of you, so it's slower going.`,
      howMany: "Fewer, for words you already recognise",
    },
    {
      kind: "PICTURE",
      title: "Picture first",
      front: PICTURE_FRONT,
      answer: targetWord,
      skill: "Meaning",
      effort: 2,
      effortLabel: "A little harder",
      body: `You see a picture and name it in ${target}, tying the word to the thing itself rather than to a translation. Pictures are remembered better than words (the picture superiority effect), so these stick.`,
      howMany: "Some, for things you can picture",
    },
  ];
}

/** The one-line advice on mixing the three. */
export function mixingTip(profile: Languages | null): string {
  const { target, source } = guideLanguages(profile);
  return `Make most decks ${target} first. Once words feel familiar, add the ones you want to say as ${source} first, and use pictures for things you can point at.`;
}
