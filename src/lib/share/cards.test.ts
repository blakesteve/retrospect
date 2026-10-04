import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Card } from "@/app/api/og/cards";
import type { CardData } from "./cardData";
import type { CardSize } from "./card";

/* What each share card draws, in words (spec 8.7.5): the drawing's own text,
   read off the element tree the renderer gets. A question card never shows a
   word without its question, and every card says what it is in plain words. */

/** Every string a card draws, in order, with its components expanded. */
function words(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(words);
  if (!isValidElement(node)) return [];
  const { type, props } = node as { type: unknown; props: { children?: ReactNode } };
  if (typeof type === "function") return words((type as (p: unknown) => ReactNode)(props));
  return words(props.children);
}
const text = (data: CardData, size: CardSize) => words(Card({ data, size })).join(" ");

const Q: CardData = {
  kind: "q",
  username: "sample",
  says: "Does a full moon change how late I listen? No.",
  question: "Does a full moon change how late I listen?",
  word: "No",
  line: "About a 41% chance.",
};
const SONG: CardData = {
  kind: "song",
  username: "sample",
  says: "The sky the minute I first played Good Luck, Babe! by Chappell Roan · 10:22 p.m. CDT, May 10, 2024",
  planets: [
    { body: "Sun", sign: "Taurus", retrograde: false },
    { body: "Saturn", sign: "Pisces", retrograde: false },
  ],
  moonPhase: 30,
};
const NIGHT: CardData = {
  kind: "night",
  username: "sample",
  says: "My night of May 10, 2024: the strongest geomagnetic storm in about 20 years",
  plays: 41,
  usual: 18,
  weekday: "Friday",
  moonPhase: 30,
  moonName: "Waxing crescent",
};

describe("a share card's words", () => {
  for (const size of ["wide", "tall"] as const) {
    it(`asks the question before its word, at ${size}`, () => {
      const t = text(Q, size);
      expect(t).toContain("Does a full moon change how late I listen?");
      expect(t.indexOf("Does a full moon")).toBeLessThan(t.indexOf(" No "));
      expect(t).toContain("About a 41% chance.");
    });
    it(`says what a song's and a night's card are, at ${size}`, () => {
      expect(text(SONG, size)).toContain("The sky the minute I first played Good Luck, Babe! by Chappell Roan · 10:22 p.m. CDT, May 10, 2024");
      expect(text(NIGHT, size)).toContain("My night of May 10, 2024: the strongest geomagnetic storm in about 20 years");
      expect(text(NIGHT, size)).toContain("41 plays · a usual Friday is 18");
      // The night's Moon at 9 p.m., named (8.7.5).
      expect(text(NIGHT, size)).toContain("Waxing crescent at 9 p.m.");
    });
    it(`names the listener and tonight's Moon on the generic card, or says what Retrospect is, at ${size}`, () => {
      const named = words(Card({ data: { kind: "generic", username: "sample", moonPhase: 30, moonName: "Waxing crescent" }, size }));
      expect(named).toContain("sample");
      expect(named).toContain("Their Last.fm history under the real sky, and an honest answer to whether any of it moved them.");
      expect(named).toContain("Tonight: waxing crescent");
      const nameless = words(Card({ data: { kind: "generic", username: null, moonPhase: 30, moonName: "Waxing crescent" }, size }));
      expect(nameless).toContain("Retrospect");
      expect(nameless).toContain("Your Last.fm history under the real sky.");
      expect(nameless).not.toContain("sample");
    });
  }
  it("names each planet and sign in words on the tall card, beside the glyphs", () => {
    const t = text(SONG, "tall");
    expect(t).toContain("The Sun in Taurus");
    expect(t).toContain("Saturn in Pisces");
  });
  it("draws no glyph as an emoji: no sign or planet at its own code point, no U+FE0E", () => {
    for (const data of [Q, SONG, NIGHT]) {
      for (const size of ["wide", "tall"] as const) expect(text(data, size)).not.toMatch(/[\u2600-\u27bf\ufe0e]/u);
    }
    // The song card's glyphs, at the cards' Private Use code points, each in its place: the Sun, Taurus, Saturn, Pisces.
    expect(text(SONG, "wide").match(/[\ue000-\ue012]/gu)).toEqual(["\ue000", "\ue008", "\ue006", "\ue012"]);
  });
});
