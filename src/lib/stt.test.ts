import { describe, expect, it } from "vitest";
import { isAudioType } from "./stt";

describe("isAudioType", () => {
  it("accepts what browsers record, codecs included", () => {
    for (const type of ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg; codecs=opus", "audio/x-m4a", "audio/mpeg"]) {
      expect(isAudioType(type)).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const type of ["", "video/mp4", "image/png", "text/plain", "application/octet-stream", "audio/"]) {
      expect(isAudioType(type)).toBe(false);
    }
  });
});
