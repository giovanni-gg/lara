import sharp from "sharp";
import { getLanguage } from "./languages";
import { exists, mediaKey, publicUrl, store } from "./media";

/**
 * Card pictures for "Picture first", drawn by Gemini. Ported from anki_creator's
 * image_generator_gemini.py: the same split literal/creative prompt, the same
 * six art styles picked at random, the same retry-with-backoff. Called over
 * plain fetch, like tts.ts: one endpoint doesn't need an SDK.
 */

/**
 * The cheapest, fastest image model ("Nano Banana 2 Lite"): $0.0336 per 1K
 * image at standard rates (Nov 2026). Never a Pro tier; these are flashcards.
 */
export const IMAGE_MODEL = "gemini-3.1-flash-lite-image";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;

/** Retries as in the Python: 3 attempts, waiting 2 s then 4 s between them. */
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2000;
/** Per attempt. Three attempts plus backoff stay under ~100 s. */
const ATTEMPT_TIMEOUT_MS = 30_000;

/** The size the prompt asks for, as in the Python (the model returns ~1K regardless). */
const PROMPT_SIZE = 512;
/** Stored size and quality: what scripts/optimize-images.ts uses for Anki pictures. */
const MAX_SIDE = 640;
const WEBP_QUALITY = 76;

/** Each style is designed to be fun yet clear for vocabulary learning. */
export const ART_STYLES = [
  {
    name: "Pixar/Disney 3D",
    description:
      "Pixar/Disney 3D animation style with friendly, colorful, highly polished rendering. " +
      "Warm lighting, expressive features, soft shadows, appealing character design.",
  },
  {
    name: "Retro 1950s Advertising",
    description:
      "Retro 1950s American advertising illustration style. Bold saturated colors, " +
      "optimistic and cheerful mood, clean confident lines, vintage charm like classic diner posters.",
  },
  {
    name: "Children's Storybook",
    description:
      "Warm children's storybook illustration style. Hand-drawn feel with soft edges, " +
      "cozy and inviting colors, friendly and approachable like classic picture books.",
  },
  {
    name: "Ligne Claire (Tintin)",
    description:
      "Ligne Claire comic style inspired by Hergé's Tintin. Clean uniform line weights, " +
      "flat colors with no gradients, no hatching or shading, elegant simplicity and clarity.",
  },
  {
    name: "Scandinavian Design",
    description:
      "Scandinavian design illustration style. Clean minimalist shapes, muted earthy color palette " +
      "with warm accents, cozy hygge feeling, modern yet timeless, inspired by Nordic design aesthetics.",
  },
  {
    name: "Mid-Century Modern",
    description:
      "Mid-century modern illustration style from the 1950s-60s. Bold geometric shapes, " +
      "limited color palette, atomic age optimism, stylized forms, inspired by Charley Harper and Eames era graphics.",
  },
] as const;

export type CardImageInput = {
  /** The word being learned, e.g. "äpple". */
  target: string;
  /** Its translation, e.g. "apple". */
  source: string;
  /** Language codes, e.g. "sv" / "en". */
  targetLanguage: string;
  sourceLanguage: string;
};

export function imagesAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function randomStyleIndex(): number {
  return Math.floor(Math.random() * ART_STYLES.length);
}

/**
 * The anki_creator prompt (split literal/creative picture, six art styles),
 * reworked so no text ever ends up in the picture: a picture card is answered
 * from the picture alone, so a drawn word gives the answer away. Image models
 * copy quoted words into the image, so the word appears exactly once, in a
 * line marked as context, and every other line says "the concept".
 */
/** Bumped when the prompt changes enough that old pictures shouldn't be reused (v2: no text at all). */
export const PROMPT_VERSION = "v2";

export function buildImagePrompt(input: CardImageInput, styleIndex: number): string {
  const style = ART_STYLES[((styleIndex % ART_STYLES.length) + ART_STYLES.length) % ART_STYLES.length];
  const target = input.target.trim();
  const source = input.source.trim();
  const targetName = getLanguage(input.targetLanguage).name;
  const sourceName = getLanguage(input.sourceLanguage).name;
  const size = PROMPT_SIZE;

  return `Generate a ${size}x${size} educational picture-flashcard image for adults learning a new language.

How it is used: the learner sees ONLY this picture and must work out the word from it. Any text in the picture gives the answer away and makes the card useless, so the image must contain no writing of any kind.

The concept (context for you only, NEVER draw or write it): the ${targetName} word "${target}", meaning "${source}" in ${sourceName}.

Art Style: ${style.description}

Layout: SPLIT IMAGE with a subtle vertical divider line in the middle
- LEFT HALF: LITERAL representation - show exactly what the concept means in its most common, direct usage, isolated and centered
- RIGHT HALF: CREATIVE/FUN representation - a wild, humorous, unexpected, or surreal interpretation of the same concept (metaphor, exaggeration, funny scenario, or artistic twist)

Rules:
- ABSOLUTELY NO TEXT: no letters, words, names, labels, captions, titles, signs, numbers, speech bubbles or writing on objects, in any language
- Communicate the concept through objects, actions, people and expressions only
- Clean illustration, white or simple background, high contrast
- Both halves should clearly represent the concept, in different ways
- Square format (${size}x${size} pixels)

Now draw the concept in the specified art style, as easy as possible to recognise from the picture alone, with no text anywhere in the image.
`;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
};

/** One request; the image's bytes, or null when the model answered with text only. */
async function requestImage(prompt: string, apiKey: string): Promise<Buffer | null> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: { aspectRatio: "1:1" },
      },
    }),
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const json = (await response.json()) as GeminiResponse;
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Draws a picture for a card and returns its `/api/media/…` URL, or null when
 * pictures aren't configured or every attempt failed. Never throws. Cached by
 * content hash, so the same word and translation is only ever drawn once.
 */
export async function generateCardImage(input: CardImageInput): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const key = mediaKey(
      "img",
      input.targetLanguage,
      // PROMPT_VERSION: pictures drawn by an older prompt aren't reused.
      `${PROMPT_VERSION}:${input.sourceLanguage}:${input.target.trim()}:${input.source.trim()}`,
    );
    if (await exists(key, "webp")) return publicUrl(key, "webp");

    const prompt = buildImagePrompt(input, randomStyleIndex());
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
      try {
        const image = await requestImage(prompt, apiKey);
        if (!image) continue;
        const webp = await sharp(image)
          .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer();
        return await store(key, webp, "webp");
      } catch (error) {
        if (attempt === MAX_ATTEMPTS - 1) throw error;
      }
    }
    console.warn(`[images] no image for "${input.target}" after ${MAX_ATTEMPTS} attempts`);
    return null;
  } catch (error) {
    console.warn(`[images] failed for "${input.target}":`, error instanceof Error ? error.message : error);
    return null;
  }
}
