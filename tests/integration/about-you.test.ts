// "About you": the learner's own words about their life, distilled into a
// note that card, story and Speak prompts use. The save actions, the
// dictation route and the job runners are real; the distil call, card and
// story models are mocked and ElevenLabs is a stubbed `fetch`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { clearAboutYou, saveAboutYou } from "@/app/actions";
import { POST as transcribeRoute } from "@/app/api/transcribe/route";
import { POST as generateCardsRoute } from "@/app/api/decks/generate/route";
import { POST as generateStoryRoute } from "@/app/api/stories/generate/route";
import { distilAbout } from "@/lib/ai/about";
import { generateCards } from "@/lib/ai/cards";
import { generateStory } from "@/lib/ai/stories";
import { learnerContext, MAX_ABOUT_CHARS } from "@/lib/learner-context";
import { DAILY_TRANSCRIPTION_LIMIT } from "@/lib/limits";
import { MAX_AUDIO_BYTES } from "@/lib/stt";
import type { LanguageProfile, User } from "@/generated/prisma/client";
import { createDeck, createProfile, createUser } from "../factories";
import { revalidated } from "./stubs/next-cache";
import { settleAfter } from "./stubs/next-server";

vi.mock("@/lib/ai/about", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/about")>()),
  distilAbout: vi.fn(),
}));
vi.mock("@/lib/ai/cards", () => ({ generateCards: vi.fn() }));
vi.mock("@/lib/ai/stories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/stories")>()),
  generateStory: vi.fn(),
}));
vi.mock("@/lib/ai/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/model")>()),
  hasAiCredentials: () => true,
}));
vi.mock("@/lib/tts", () => ({ ttsAvailable: () => false, trySynthesize: vi.fn(async () => null) }));
vi.mock("@/lib/images", () => ({ generateCardImage: vi.fn(async () => null), imagesAvailable: () => false }));

const RAW = "Jag flyttar till Stockholm med min flickvän i maj. I work in data engineering and run marathons.";
const SUMMARY = "They are moving to Stockholm with their girlfriend in May, work in data engineering and run marathons.";

const aboutForm = (about: string) => {
  const data = new FormData();
  data.set("about", about);
  return data;
};
const reload = (profile: LanguageProfile) => prisma.languageProfile.findUniqueOrThrow({ where: { id: profile.id } });

let user: User;
let profile: LanguageProfile;
let savedOwner: string | undefined;

beforeEach(async () => {
  savedOwner = process.env.LARA_OWNER_EMAIL;
  delete process.env.LARA_OWNER_EMAIL;
  user = await createUser();
  profile = await createProfile(user, { targetLanguage: "sv", sourceLanguage: "en" });
  vi.mocked(distilAbout).mockResolvedValue(SUMMARY);
});

afterEach(() => {
  if (savedOwner === undefined) delete process.env.LARA_OWNER_EMAIL;
  else process.env.LARA_OWNER_EMAIL = savedOwner;
  vi.clearAllMocks();
});

describe("saving About you", () => {
  it("stores the raw text and the distilled summary", async () => {
    await saveAboutYou(aboutForm(`  ${RAW}  `));

    expect(distilAbout).toHaveBeenCalledWith({ about: RAW, targetLanguage: "sv", sourceLanguage: "en" });
    const row = await reload(profile);
    expect(row).toMatchObject({ about: RAW, aboutSummary: SUMMARY });
    expect(learnerContext(row)).toBe(SUMMARY);
    expect(revalidated).toContain("/settings");
  });

  it("still saves the raw text when the model fails, and falls back to it", async () => {
    vi.mocked(distilAbout).mockRejectedValue(new Error("overloaded"));
    await saveAboutYou(aboutForm(RAW));

    const row = await reload(profile);
    expect(row).toMatchObject({ about: RAW, aboutSummary: null });
    expect(learnerContext(row)).toBe(RAW);
  });

  it("caps the text and doesn't pay twice for an unchanged save", async () => {
    await saveAboutYou(aboutForm("x".repeat(MAX_ABOUT_CHARS + 100)));
    expect((await reload(profile)).about).toHaveLength(MAX_ABOUT_CHARS);

    await saveAboutYou(aboutForm(RAW));
    await saveAboutYou(aboutForm(RAW));
    expect(distilAbout).toHaveBeenCalledTimes(2);
  });

  it("clears with the Clear button or an empty save", async () => {
    await saveAboutYou(aboutForm(RAW));
    await clearAboutYou();
    expect(await reload(profile)).toMatchObject({ about: null, aboutSummary: null });

    await saveAboutYou(aboutForm(RAW));
    await saveAboutYou(aboutForm("   "));
    expect(await reload(profile)).toMatchObject({ about: null, aboutSummary: null });
    expect(distilAbout).toHaveBeenCalledTimes(2);
  });

  it("is per language", async () => {
    const portuguese = await createProfile(user, { targetLanguage: "pt", isActive: false });
    await saveAboutYou(aboutForm(RAW));
    expect((await reload(portuguese)).about).toBeNull();
  });
});

describe("POST /api/transcribe", () => {
  const fetchMock = vi.fn<typeof fetch>();

  const upload = (audio?: Blob, name = "about.m4a") => {
    const body = new FormData();
    if (audio) body.set("audio", audio, name);
    return transcribeRoute(new Request("http://t/api/transcribe", { method: "POST", body }));
  };
  const clip = (bytes = 2048, type = "audio/mp4") => new Blob([new Uint8Array(bytes)], { type });

  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(Response.json({ text: "  Jag springer maraton.  ", language_code: "swe" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.ELEVENLABS_API_KEY = "";
  });

  it("returns the transcript, letting Scribe detect the language", async () => {
    const res = await upload(clip(2048, "audio/mp4;codecs=mp4a.40.2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Jag springer maraton." });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init?.headers).toEqual({ "xi-api-key": "test-eleven-key" });
    const sent = init?.body as FormData;
    expect(sent.get("model_id")).toBe("scribe_v3");
    expect(sent.get("language_code")).toBeNull();
    expect((sent.get("file") as Blob).size).toBe(2048);
    expect(await prisma.transcription.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rejects a missing, non-audio or oversized upload without calling ElevenLabs", async () => {
    expect((await upload()).status).toBe(400);
    expect((await upload(clip(0))).status).toBe(400);
    expect((await upload(clip(2048, "image/png"), "x.png")).status).toBe(415);
    expect((await upload(clip(2048, "video/mp4"), "x.mp4")).status).toBe(415);
    const big = await upload(clip(MAX_AUDIO_BYTES + 1));
    expect(big.status).toBe(413);
    expect((await big.json()).error).toContain("three minutes");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.transcription.count()).toBe(0);
  });

  it("says when voice input isn't configured", async () => {
    process.env.ELEVENLABS_API_KEY = "";
    expect((await upload(clip())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when ElevenLabs fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const res = await upload(clip());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("type instead");
  });

  it("caps a limited account at the daily limit; the owner has none", async () => {
    await prisma.transcription.createMany({
      data: Array.from({ length: DAILY_TRANSCRIPTION_LIMIT }, () => ({ userId: user.id })),
    });
    expect((await upload(clip())).status).toBe(200);

    process.env.LARA_OWNER_EMAIL = "owner@lara.local";
    const res = await upload(clip());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain(`${DAILY_TRANSCRIPTION_LIMIT} recordings a day`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the note reaches the generators", () => {
  const post = (route: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
    route(new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }));

  it("card jobs pass it to generateCards", async () => {
    await prisma.languageProfile.update({ where: { id: profile.id }, data: { about: RAW, aboutSummary: SUMMARY } });
    vi.mocked(generateCards).mockResolvedValue({
      deckName: "Sport",
      emoji: "🏃",
      cards: [{ target: "springa", source: "run", targetSentence: "", sourceSentence: "", notes: "", tags: [] }],
    });

    expect((await post(generateCardsRoute, { prompt: "sport", count: 1, withAudio: false })).status).toBe(202);
    await settleAfter();
    expect(vi.mocked(generateCards).mock.calls[0][0]).toMatchObject({ prompt: "sport", learner: SUMMARY });

    // And into an existing deck, with the raw-text fallback when there's no summary.
    await prisma.languageProfile.update({ where: { id: profile.id }, data: { aboutSummary: null } });
    const deck = await createDeck(profile, { name: "Verbs" });
    await post(generateCardsRoute, { count: 1, deckId: deck.id, withAudio: false });
    await settleAfter();
    expect(vi.mocked(generateCards).mock.calls[1][0]).toMatchObject({ learner: RAW, deck: { path: ["Verbs"] } });
  });

  it("card jobs pass null when there is no note", async () => {
    vi.mocked(generateCards).mockResolvedValue({
      deckName: "Sport",
      emoji: "🏃",
      cards: [{ target: "springa", source: "run", targetSentence: "", sourceSentence: "", notes: "", tags: [] }],
    });
    await post(generateCardsRoute, { prompt: "sport", count: 1, withAudio: false });
    await settleAfter();
    expect(vi.mocked(generateCards).mock.calls[0][0].learner).toBeNull();
  });

  it("stories pass it to generateStory", async () => {
    await prisma.languageProfile.update({ where: { id: profile.id }, data: { about: RAW, aboutSummary: SUMMARY } });
    vi.mocked(generateStory).mockResolvedValue({
      story: {
        title: "Loppet",
        titleTranslated: "The race",
        segments: [{ target: "Hon springer.", translation: "She runs." }],
        reusedVocabulary: [],
        newVocabulary: [],
      },
      level: "A2",
      targetWords: 250,
    });

    expect((await post(generateStoryRoute, { length: "short", withAudio: false })).status).toBe(202);
    await settleAfter();
    expect(vi.mocked(generateStory).mock.calls[0][0]).toMatchObject({ learner: SUMMARY });
  });
});
