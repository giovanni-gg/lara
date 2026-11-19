import { describe, expect, it } from "vitest";
import { CardType } from "../../src/generated/prisma/enums";
import {
  decodeEntities,
  makeDayClock,
  parseNote,
  plain,
  readProtoVarints,
  splitLines,
  splitTrailingNote,
} from "./parse";

/** An Anki note's `flds` column: fields joined by the unit separator. */
const note = (...fields: string[]) => fields.join("\x1f").split("\x1f");

describe("parseNote", () => {
  it("reads a picture card: word, translation, sentence, sentence translation, each with its audio", () => {
    const content = parseNote(
      note(
        '<img src="handled.png">',
        "Handled[sound:handled.mp3]<br>Wrist<br>Min handled är svullen.[sound:min.mp3]<br>My wrist is swollen.",
      ),
    );

    expect(content).toEqual({
      shape: "picture",
      cardType: CardType.PICTURE,
      target: "Handled",
      source: "Wrist",
      targetSentence: "Min handled är svullen.",
      sourceSentence: "My wrist is swollen.",
      notes: null,
      image: "handled.png",
      audio: "handled.mp3",
      sentenceAudio: "min.mp3",
    });
  });

  describe("flag cards (labelled EN:/PT:/SV: lines)", () => {
    const flag = note(
      '<img src="bouvet.png">',
      "EN: Bouvet Island<br>PT: Ilha Bouvet<br>SV: Bouvetön<br><br><i>fun fact</i>",
    );

    it("takes the SV line as the target by default, keeping the other languages and the fun fact as notes", () => {
      expect(parseNote(flag)).toMatchObject({
        shape: "picture-labelled",
        cardType: CardType.PICTURE,
        target: "Bouvetön",
        source: "Bouvet Island",
        notes: "PT: Ilha Bouvet\nfun fact",
        image: "bouvet.png",
        audio: null,
      });
    });

    it("takes the line matching the target language when one is given", () => {
      expect(parseNote(flag, { targetCode: "pt" })).toMatchObject({
        target: "Ilha Bouvet",
        source: "Bouvet Island",
        notes: "SV: Bouvetön\nfun fact",
      });
    });
  });

  it("reads a Swedish-front card and moves a trailing grammar note out of the translation", () => {
    expect(
      parseNote(note("Jag vill vara här[sound:a.mp3]", "I want to be here. (Verb: att vara — to be; used for states.)")),
    ).toEqual({
      shape: "target-front",
      cardType: CardType.RECOGNITION,
      target: "Jag vill vara här",
      source: "I want to be here.",
      targetSentence: null,
      sourceSentence: null,
      notes: "Verb: att vara — to be; used for states.",
      image: null,
      audio: "a.mp3",
      sentenceAudio: null,
    });
  });

  it("reads an English-front card with Swedish and its sound on the back as PRODUCTION", () => {
    expect(parseNote(note("to consider", "att anse[sound:anse.mp3]"))).toMatchObject({
      shape: "target-back",
      cardType: CardType.PRODUCTION,
      target: "att anse",
      source: "to consider",
      notes: null,
      audio: "anse.mp3",
    });
  });

  it("reads a card without audio, decoding entities and dropping markup", () => {
    expect(parseNote(note("it&#x27;s <b>fine</b>&nbsp;&amp; good", "det &#228;r bra"))).toMatchObject({
      shape: "no-audio",
      cardType: CardType.RECOGNITION,
      target: "it's fine & good",
      source: "det är bra",
      notes: null,
      audio: null,
      image: null,
    });
  });
});

describe("field helpers", () => {
  it("decodeEntities handles hex, decimal and named entities and leaves unknown ones alone", () => {
    expect(decodeEntities("&#x27;&#228;&lt;&QUOT;&bogus;")).toBe("'ä<\"&bogus;");
  });

  it("splitLines breaks on <br>, </div>, </p> and newlines, and pulls out sounds", () => {
    expect(splitLines("a[sound:x.mp3]<br/>b</div>c</p>d\n <i> e </i>")).toEqual([
      { text: "a", sounds: ["x.mp3"] },
      { text: "b", sounds: [] },
      { text: "c", sounds: [] },
      { text: "d", sounds: [] },
      { text: "e", sounds: [] },
    ]);
  });

  it("plain joins the non-empty lines with spaces", () => {
    expect(plain("<div>x</div><div></div><div>&lt;y&gt;</div>")).toBe("x <y>");
  });

  it("splitTrailingNote only splits recognised labels, and never leaves the text empty", () => {
    expect(splitTrailingNote("to be (Note: irregular)")).toEqual({ text: "to be", note: "Note: irregular" });
    expect(splitTrailingNote("the house (formal)")).toEqual({ text: "the house (formal)", note: null });
    expect(splitTrailingNote("(Verb: att vara)")).toEqual({ text: "(Verb: att vara)", note: null });
  });
});

describe("makeDayClock", () => {
  it("converts a real collection's review day: crt 1763953200, rollover 4", () => {
    const clock = makeDayClock(1763953200, 4);
    const answeredAt = new Date(1785055912 * 1000);

    expect(clock.dayOf(answeredAt) + 995).toBe(1239);
    // startOf and dayOf are inverses on day boundaries.
    expect(clock.dayOf(clock.startOf(1239))).toBe(1239);
    expect(clock.startOf(1).getTime() - clock.startOf(0).getTime()).toBe(86_400_000);
  });
});

describe("readProtoVarints", () => {
  // A real Anki deck preset (deck_config.config): 5 new/day, 9999 reviews/day.
  const PRESET =
    "0A0400002041120400002041221C0000803F0000803F0000803F0000803F0000803F0000803F0000803F4805508F4E5D00002040656666A63F6D9A99993F7D0000803F8001949D02880101900101980104A80101B00108C0013C";
  const bytes = Uint8Array.from(PRESET.match(/../g)!.map((h) => parseInt(h, 16)));

  it("reads the daily limits past length-delimited and fixed-width fields", () => {
    const fields = readProtoVarints(bytes);
    expect(fields.get(9)).toBe(5);
    expect(fields.get(10)).toBe(9999);
  });
});
