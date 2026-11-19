/**
 * Picking which of the learner's words a story gets built from. Pure — no
 * database — so the sampling can be tested and the prompt stays small: a deck
 * can hold 800 cards, and a 250-word story can't use more than a couple dozen.
 */

export type VocabularyCard = {
  target: string;
  source: string;
  /** Times reviewed; 0 means the learner has never seen this card. */
  reps: number;
};

export type VocabularyWord = { target: string; source: string };

export type DeckVocabulary = {
  /** Deck words the learner has studied: the story's backbone. */
  studied: VocabularyWord[];
  /** Deck words not studied yet: where the story's few new words come from. */
  unstudied: VocabularyWord[];
};

/** Longer than this and it's a paragraph, not a word or phrase worth listing. */
const MAX_TEXT_LENGTH = 80;

/** Anki leftovers that aren't vocabulary. */
const PLACEHOLDERS = new Set(["(blank)", "front", "back", "text"]);

/**
 * A card field as plain text: no HTML, no `[sound:]` tags, no trailing usage
 * note ("vou comprar — 'ska + infinitiv' = futuro"). Null when nothing usable
 * is left.
 */
export function cleanCardText(text: string): string | null {
  const cleaned = text
    .replace(/\[sound:[^\]]*\]/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s[—–]\s.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > MAX_TEXT_LENGTH) return null;
  if (PLACEHOLDERS.has(cleaned.toLowerCase())) return null;
  return cleaned;
}

/** Cleaned, with duplicates (both directions of one word) collapsed. */
function distinct<T extends { target: string }>(
  items: T[],
  clean: (item: T) => (T & VocabularyWord) | null,
): (T & VocabularyWord)[] {
  const seen = new Set<string>();
  const out: (T & VocabularyWord)[] = [];
  for (const item of items) {
    const word = clean(item);
    if (!word) continue;
    const key = word.target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A random sample of a deck's words, split by whether the learner has studied
 * them. Random so that a second story from the same deck uses different
 * words; `random` is injectable for tests.
 */
export function sampleDeckVocabulary(
  cards: VocabularyCard[],
  { studied, unstudied }: { studied: number; unstudied: number },
  random: () => number = Math.random,
): DeckVocabulary {
  const words = distinct(cards, (card) => {
    const target = cleanCardText(card.target);
    if (!target) return null;
    return { ...card, target, source: cleanCardText(card.source) ?? "" };
  });

  const pick = (list: typeof words, count: number) =>
    shuffled(list, random)
      .slice(0, count)
      .map(({ target, source }) => ({ target, source }));

  return {
    studied: pick(words.filter((w) => w.reps > 0), studied),
    unstudied: pick(words.filter((w) => w.reps === 0), unstudied),
  };
}

/** The learner's general known words, cleaned and minus any already listed. */
export function backgroundVocabulary(
  targets: string[],
  exclude: VocabularyWord[],
  limit: number,
): string[] {
  const skip = new Set(exclude.map((w) => w.target.toLowerCase()));
  return distinct(
    targets.map((target) => ({ target })),
    ({ target }) => {
      const cleaned = cleanCardText(target);
      return cleaned ? { target: cleaned, source: "" } : null;
    },
  )
    .map((w) => w.target)
    .filter((target) => !skip.has(target.toLowerCase()))
    .slice(0, limit);
}
