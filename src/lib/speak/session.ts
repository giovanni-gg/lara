import { prisma } from "../db";
import { deckPath, subtreeIds } from "../deck-tree";
import { sampleDeckVocabulary } from "../story-vocabulary";
import { MAX_DECK_WORDS, type SpeakDeck } from "./prompt";

/**
 * The server half of Speak: the deck's words for the prompt, and the
 * short-lived WebRTC token the browser connects with. The ElevenLabs API key
 * stays here; the browser only ever sees the token.
 */

const TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";

export class SpeakUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeakUnavailableError";
  }
}

/** Bad input the caller should see as a 4xx, e.g. a deck that isn't theirs. */
export class SpeakInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeakInputError";
  }
}

export function speakConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID);
}

/** The key and agent, or which one is missing. */
export function speakCredentials(): { apiKey: string; agentId: string } {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey) throw new SpeakUnavailableError("Speak isn't configured: ELEVENLABS_API_KEY is not set.");
  if (!agentId) {
    throw new SpeakUnavailableError(
      "Speak isn't configured: ELEVENLABS_AGENT_ID is not set. Run `npm run speak:setup` and add the id it prints.",
    );
  }
  return { apiKey, agentId };
}

/**
 * A WebRTC conversation token for the agent. Free to mint and starts nothing:
 * the conversation (and its cost) begins only when the browser connects.
 */
export async function mintConversationToken({
  apiKey,
  agentId,
}: {
  apiKey: string;
  agentId: string;
}): Promise<{ token: string; conversationId: string | null }> {
  const response = await fetch(`${TOKEN_URL}?agent_id=${encodeURIComponent(agentId)}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SpeakUnavailableError(`ElevenLabs refused the session (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { token?: unknown; conversation_id?: unknown };
  if (typeof data.token !== "string" || !data.token) {
    throw new SpeakUnavailableError("ElevenLabs returned no conversation token.");
  }
  return {
    token: data.token,
    conversationId: typeof data.conversation_id === "string" ? data.conversation_id : null,
  };
}

/**
 * A deck (and its subdecks) as words for the tutor to weave in: a random
 * sample of what the learner has studied, or of everything if they haven't
 * studied it yet. Archived decks are refused, archived subdecks left out.
 */
export async function loadSpeakDeck(
  profile: { id: string; userId: string },
  deckId: string,
): Promise<SpeakDeck & { id: string }> {
  const deck = await prisma.deck.findFirst({
    where: { id: deckId, userId: profile.userId, profileId: profile.id, archivedAt: null },
    select: { id: true },
  });
  if (!deck) throw new SpeakInputError("That deck doesn't exist");

  const cards = await prisma.card.findMany({
    where: {
      deckId: { in: await subtreeIds(profile.id, deck.id) },
      suspended: false,
      deck: { archivedAt: null },
    },
    select: { target: true, source: true, reps: true },
  });
  const { studied, unstudied } = sampleDeckVocabulary(cards, {
    studied: MAX_DECK_WORDS,
    unstudied: MAX_DECK_WORDS,
  });
  const label = (await deckPath(deck.id)).map((p) => p.name).join(" · ");
  return { id: deck.id, label, words: studied.length > 0 ? studied : unstudied };
}
