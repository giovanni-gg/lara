import { describe, expect, it } from "vitest";
import { blobPathname, contentTypeFor, isMediaFilename, mediaKey, publicUrl } from "./media";

describe("isMediaFilename", () => {
  it("accepts bare <name>.<ext> filenames", () => {
    for (const name of ["a.mp3", "tts-sv-0123abcd.mp3", "anki-ff00_x.webp", "Test-Banana.PNG"]) {
      expect(isMediaFilename(name)).toBe(true);
    }
  });

  it("rejects anything that could leave the media folder or isn't a plain name", () => {
    for (const name of [
      "../secret.mp3",
      "a/b.mp3",
      "a\\b.mp3",
      ".hidden",
      "noextension",
      "two..dots",
      "-leading.mp3",
      "space name.mp3",
      "a.mp3/",
      "",
    ]) {
      expect(isMediaFilename(name), name).toBe(false);
    }
  });
});

describe("media paths", () => {
  it("puts Blob objects under media/ and serves everything from /api/media", () => {
    expect(blobPathname("x.mp3")).toBe("media/x.mp3");
    expect(publicUrl("tts-sv-abc")).toBe("/api/media/tts-sv-abc.mp3");
    expect(publicUrl("anki-abc", "webp")).toBe("/api/media/anki-abc.webp");
  });

  it("maps extensions to content types, case-insensitively, with a safe fallback", () => {
    expect(contentTypeFor("a.mp3")).toBe("audio/mpeg");
    expect(contentTypeFor("a.PNG")).toBe("image/png");
    expect(contentTypeFor("a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("a.webp")).toBe("image/webp");
    expect(contentTypeFor("a.exe")).toBe("application/octet-stream");
  });
});

describe("mediaKey", () => {
  it("is stable for the same text and differs by kind, language and text", () => {
    const key = mediaKey("tts", "sv", "hej");
    expect(key).toMatch(/^tts-sv-[0-9a-f]{24}$/);
    expect(mediaKey("tts", "sv", "hej")).toBe(key);
    expect(new Set([key, mediaKey("tts", "pt", "hej"), mediaKey("tts", "sv", "hej då"), mediaKey("seg", "sv", "hej")]).size).toBe(4);
  });

  it("always yields a servable filename", () => {
    expect(isMediaFilename(`${mediaKey("tts", "sv", "Jag är här / ../")}.mp3`)).toBe(true);
  });
});
