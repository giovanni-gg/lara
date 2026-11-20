// POST /api/speak/session for each of Lara's two learners, signed in through
// the real session cookie. ElevenLabs is a stubbed `fetch`: the test checks
// what the token request carries and what overrides come back, and nothing
// leaves the machine. Plus POST /api/speak/conversations, which saves one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startSession } from "@/app/api/speak/session/route";
import { POST as saveConversation } from "@/app/api/speak/conversations/route";
import { prisma } from "@/lib/db";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";
import { greeting } from "@/lib/speak/prompt";
import { createCard, createDeck, createProfile, createUser } from "../factories";
import { setCookie } from "./stubs/next-headers";

const ACCOUNTS = {
  "you@lara.local": "giovanni-password",
  "ebba@lara.local": "ebba-password",
};

const fetchMock = vi.fn<typeof fetch>();

async function signIn(email: keyof typeof ACCOUNTS) {
  setCookie(AUTH_COOKIE, await sessionToken({ email, password: ACCOUNTS[email] }));
}

/** Giovanni learns Swedish from English, with his own voice; Ebba learns Portuguese from Swedish. */
async function learners() {
  const giovanni = await createUser({ email: "you@lara.local", name: "You" });
  const ebba = await createUser({ email: "ebba@lara.local", name: "Ebba" });
  return {
    giovanni: await createProfile(giovanni, {
      targetLanguage: "sv",
      sourceLanguage: "en",
      level: "A2",
      voiceId: "giovanni-voice",
    }),
    ebba: await createProfile(ebba, { targetLanguage: "pt", sourceLanguage: "sv", level: "B1" }),
  };
}

function post(handler: (request: Request) => Promise<Response>, path: string, body: unknown) {
  return handler(
    new Request(`http://t/api/speak/${path}`, { method: "POST", body: JSON.stringify(body) }),
  );
}

type SessionBody = {
  conversationToken: string;
  conversationId: string | null;
  topic: string;
  deckId: string | null;
  overrides: {
    agent: { prompt: { prompt: string }; firstMessage: string; language: string };
    tts: { voiceId?: string; speed: number };
  };
};

beforeEach(() => {
  process.env.LARA_ACCOUNTS = JSON.stringify(ACCOUNTS);
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  process.env.ELEVENLABS_AGENT_ID = "agent_test123";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json({ token: "webrtc-token", conversation_id: "conv_abc" }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LARA_ACCOUNTS;
  delete process.env.ELEVENLABS_AGENT_ID;
  process.env.ELEVENLABS_API_KEY = "";
});

describe("POST /api/speak/session", () => {
  it("mints a token for the agent with the server's key", async () => {
    await learners();
    await signIn("you@lara.local");

    const res = await post(startSession, "session", { topic: "Travel" });
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe(
      "https://api.elevenlabs.io/v1/convai/conversation/token",
    );
    expect(requested.searchParams.get("agent_id")).toBe("agent_test123");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-eleven-key");

    const body = (await res.json()) as SessionBody;
    expect(body.conversationToken).toBe("webrtc-token");
    expect(body.conversationId).toBe("conv_abc");
    // The key itself never goes to the browser.
    expect(JSON.stringify(body)).not.toContain("test-eleven-key");
  });

  it("makes Giovanni's tutor speak Swedish, explain in English, in his own voice", async () => {
    await learners();
    await signIn("you@lara.local");

    const body = (await (await post(startSession, "session", { topic: "Travel" })).json()) as SessionBody;
    const { agent, tts } = body.overrides;
    expect(agent.language).toBe("sv");
    expect(agent.firstMessage).toBe(greeting("sv"));
    expect(tts.voiceId).toBe("giovanni-voice");
    expect(agent.prompt.prompt).toContain("someone learning Swedish. Their native language is English.");
    expect(agent.prompt.prompt).toContain("Speak Swedish at CEFR A2");
    expect(agent.prompt.prompt).toContain("Topic: Travel.");
    expect(body.topic).toBe("Travel");
  });

  it("makes Ebba's tutor speak Portuguese, explain in Swedish, in the Portuguese voice, never English", async () => {
    await learners();
    await signIn("ebba@lara.local");

    const body = (await (await post(startSession, "session", { topic: "Food & cooking" })).json()) as SessionBody;
    const { agent, tts } = body.overrides;
    expect(agent.language).toBe("pt");
    expect(agent.firstMessage).toBe(greeting("pt"));
    expect(tts.voiceId).toBe(getLanguage("pt").voiceId);
    expect(agent.prompt.prompt).toContain("someone learning Portuguese. Their native language is Swedish.");
    expect(agent.prompt.prompt).toContain("Speak Portuguese at CEFR B1");
    expect(agent.prompt.prompt).toContain("Explanations are always in Swedish.");
    expect(agent.prompt.prompt).toContain("Never use English");
    expect(agent.prompt.prompt).not.toContain("# About the learner");
  });

  it("tells the tutor what the learner shared in About you", async () => {
    const { ebba } = await learners();
    const note = "Hon ska flytta till Lissabon i maj och jobbar som sjuksköterska.";
    await prisma.languageProfile.update({ where: { id: ebba.id }, data: { about: "raw", aboutSummary: note } });
    await signIn("ebba@lara.local");

    const body = (await (await post(startSession, "session", { topic: "Travel" })).json()) as SessionBody;
    expect(body.overrides.agent.prompt.prompt).toContain(`# About the learner\n${note}`);
    expect(body.overrides.agent.prompt.prompt).toContain("ask about their life and plans in Portuguese");
  });

  it("weaves in the deck's studied words, subdecks included, archived and suspended left out", async () => {
    const { ebba } = await learners();
    const deck = await createDeck(ebba, { name: "Comida" });
    const sub = await createDeck(ebba, { name: "Frutas", parent: deck });
    const archived = await createDeck(ebba, { name: "Velho", parent: deck, archivedAt: new Date() });
    await createCard(deck, { target: "pão", source: "bröd", reps: 3 });
    await createCard(sub, { target: "maçã", source: "äpple", reps: 1 });
    await createCard(sub, { target: "uva", source: "druva", reps: 0 }); // not studied yet
    await createCard(deck, { target: "queijo", source: "ost", reps: 2, suspended: true });
    await createCard(archived, { target: "antigo", source: "gammal", reps: 5 });
    await signIn("ebba@lara.local");

    const res = await post(startSession, "session", { deckId: deck.id });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionBody;
    const prompt = body.overrides.agent.prompt.prompt;
    expect(body.topic).toBe("Comida");
    expect(body.deckId).toBe(deck.id);
    expect(prompt).toContain('They are studying a deck called "Comida"');
    expect(prompt).toContain("- pão (bröd)");
    expect(prompt).toContain("- maçã (äpple)");
    expect(prompt).not.toContain("uva");
    expect(prompt).not.toContain("queijo");
    expect(prompt).not.toContain("antigo");
  });

  it("refuses an archived deck or someone else's", async () => {
    const { giovanni, ebba } = await learners();
    const archived = await createDeck(ebba, { archivedAt: new Date() });
    const giovannis = await createDeck(giovanni);
    await signIn("ebba@lara.local");

    for (const deckId of [archived.id, giovannis.id]) {
      const res = await post(startSession, "session", { deckId });
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 with a clear message when the agent or key isn't configured", async () => {
    await learners();
    await signIn("you@lara.local");

    delete process.env.ELEVENLABS_AGENT_ID;
    let res = await post(startSession, "session", { topic: "Travel" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("ELEVENLABS_AGENT_ID");

    process.env.ELEVENLABS_AGENT_ID = "agent_test123";
    process.env.ELEVENLABS_API_KEY = "";
    res = await post(startSession, "session", { topic: "Travel" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("ELEVENLABS_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when ElevenLabs refuses the token", async () => {
    await learners();
    await signIn("you@lara.local");
    fetchMock.mockResolvedValue(new Response("invalid api key", { status: 401 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(startSession, "session", { topic: "Travel" });
    expect(res.status).toBe(502);
  });

  it("needs a topic or a deck", async () => {
    await learners();
    await signIn("you@lara.local");
    expect((await post(startSession, "session", {})).status).toBe(400);
    expect((await post(startSession, "session", { topic: "   " })).status).toBe(400);
  });
});

describe("POST /api/speak/conversations", () => {
  it("saves the transcript and corrections to the signed-in learner's profile", async () => {
    const { giovanni, ebba } = await learners();
    const deck = await createDeck(ebba, { name: "Comida" });
    const foreign = await createDeck(giovanni);
    await signIn("ebba@lara.local");

    const res = await post(saveConversation, "conversations", {
      externalId: "conv_abc",
      topic: "Comida",
      deckId: deck.id,
      transcript: [
        { role: "agent", text: "Oi! Vamos conversar um pouquinho?" },
        { role: "user", text: "Sim, eu gosto de comida." },
      ],
      corrections: [{ said: "eu é", better: "eu sou", explanation: "Med 'eu' blir 'ser' 'sou'." }],
    });
    expect(res.status).toBe(201);
    const saved = await prisma.speakConversation.findUniqueOrThrow({ where: { id: (await res.json()).id } });
    expect(saved).toMatchObject({ profileId: ebba.id, userId: ebba.userId, deckId: deck.id, externalId: "conv_abc" });
    expect(saved.transcript).toHaveLength(2);
    expect(saved.corrections).toEqual([{ said: "eu é", better: "eu sou", explanation: "Med 'eu' blir 'ser' 'sou'." }]);

    // Another profile's deck isn't linked.
    const other = await post(saveConversation, "conversations", {
      topic: "x",
      deckId: foreign.id,
      transcript: [{ role: "user", text: "Olá" }],
      corrections: [],
    });
    const row = await prisma.speakConversation.findUniqueOrThrow({ where: { id: (await other.json()).id } });
    expect(row.deckId).toBeNull();
  });

  it("skips a conversation the learner never spoke in", async () => {
    await learners();
    await signIn("you@lara.local");
    const res = await post(saveConversation, "conversations", {
      topic: "Travel",
      transcript: [{ role: "agent", text: "Hej! Ska vi prata en stund?" }],
      corrections: [],
    });
    expect(res.status).toBe(204);
    expect(await prisma.speakConversation.count()).toBe(0);
  });
});
