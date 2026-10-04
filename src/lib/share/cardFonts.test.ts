import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cardFontBytes } from "@/app/api/og/cardFonts";
import { ALL_GLYPHS, cardGlyph, SIGNS } from "@/lib/sky/glyphs";

/* The share cards' fonts (spec 8.7.5), read the way a renderer reads them:
   by their character maps. The glyph font must hold every planet and sign a
   card draws, at the Private Use code points `cardGlyph` writes, and nothing
   at the code points Satori would send to its emoji loader; the text font
   must hold the copy's own characters. */

/** A TrueType table's offset, by its tag. */
function table(font: Buffer, tag: string): number {
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const rec = 12 + i * 16;
    if (font.toString("ascii", rec, rec + 4) === tag) return font.readUInt32BE(rec + 8);
  }
  throw new Error(`no ${tag} table`);
}

/** The glyph a TrueType font's Unicode character map (format 4) gives each code point. */
function glyphIds(font: Buffer): Map<number, number> {
  const cmap = table(font, "cmap");
  const out = new Map<number, number>();
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const at = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (font.readUInt16BE(at) !== 4) continue;
    const segs = font.readUInt16BE(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const offsets = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = font.readUInt16BE(ends + s * 2);
      const start = font.readUInt16BE(starts + s * 2);
      const delta = font.readInt16BE(deltas + s * 2);
      const offset = font.readUInt16BE(offsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const glyph = offset === 0 ? (c + delta) & 0xffff : font.readUInt16BE(offsets + s * 2 + offset + (c - start) * 2);
        if (glyph !== 0) out.set(c, glyph);
      }
    }
  }
  return out;
}
const codePoints = (font: Buffer) => new Set(glyphIds(font).keys());

/** A short hash of a glyph's outline: its bytes in the glyf table, found by way of loca. */
function outline(font: Buffer, glyph: number): string {
  const long = font.readInt16BE(table(font, "head") + 50) === 1;
  const loca = table(font, "loca");
  const at = (g: number) => (long ? font.readUInt32BE(loca + g * 4) : font.readUInt16BE(loca + g * 2) * 2);
  const glyf = table(font, "glyf");
  return createHash("sha256")
    .update(font.subarray(glyf + at(glyph), glyf + at(glyph + 1)))
    .digest("hex")
    .slice(0, 12);
}

/** Each body and sign, its code point and its outline, as drawn and checked by eye
    against its name on 4 Oct 2026 (all 19, rendered through the cards' renderer). */
const DRAWN: [string, number, string][] = [
  ["Sun", 0xe000, "a07020a1c1bf"],
  ["Moon", 0xe001, "075b6e4e4118"],
  ["Mercury", 0xe002, "dd1753ae4c95"],
  ["Venus", 0xe003, "afb3f06dfc4c"],
  ["Mars", 0xe004, "0f95cc76b0c3"],
  ["Jupiter", 0xe005, "782d2e70be86"],
  ["Saturn", 0xe006, "191ccccf0816"],
  ["Aries", 0xe007, "cae1e0f002fb"],
  ["Taurus", 0xe008, "941c57ab7692"],
  ["Gemini", 0xe009, "63ec3164b745"],
  ["Cancer", 0xe00a, "5cf41529b2ac"],
  ["Leo", 0xe00b, "5d30faba9b3d"],
  ["Virgo", 0xe00c, "effc181c8884"],
  ["Libra", 0xe00d, "0ac5e9cca20e"],
  ["Scorpio", 0xe00e, "5e69eda8aa26"],
  ["Sagittarius", 0xe00f, "5574384606d6"],
  ["Capricorn", 0xe010, "87fc7baa53de"],
  ["Aquarius", 0xe011, "c461632748eb"],
  ["Pisces", 0xe012, "e612c53f0701"],
];

describe("the glyph font", () => {
  const held = codePoints(cardFontBytes().glyphs);

  it("holds the 7 planets and 12 signs at U+E000 to U+E012, and nothing else", () => {
    expect([...held].sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, i) => 0xe000 + i));
  });

  it("is where cardGlyph points for every body and sign", () => {
    for (const name of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", ...SIGNS]) {
      const g = cardGlyph(name);
      expect(g, name).toHaveLength(1);
      expect(held.has(g.codePointAt(0)!), name).toBe(true);
    }
    expect(new Set(["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", ...SIGNS].map(cardGlyph)).size).toBe(19);
    expect(cardGlyph("Pluto")).toBe("");
  });

  it("draws each body and sign with its own outline, at its own code point", () => {
    const font = cardFontBytes().glyphs;
    const ids = glyphIds(font);
    for (const [name, cp, drawn] of DRAWN) {
      expect(cardGlyph(name), name).toBe(String.fromCodePoint(cp));
      expect(outline(font, ids.get(cp)!), name).toBe(drawn);
    }
  });

  it("holds none of the glyphs at their own code points, which a renderer could treat as emoji", () => {
    for (const g of ALL_GLYPHS) expect(held.has(g.codePointAt(0)!), g).toBe(false);
    expect(ALL_GLYPHS).toHaveLength(19);
  });
});

describe("the text font", () => {
  const held = codePoints(cardFontBytes().text);
  it("holds every character the cards' own copy uses", () => {
    const copy =
      "RETROSPECT The sky the minute I first played · 10:22 p.m. CDT, May 10, 2024 My night of: Does a full moon change how late I listen? Maybe. Could be chance. Tonight: waning crescent";
    for (const ch of new Set(copy)) expect(held.has(ch.codePointAt(0)!), JSON.stringify(ch)).toBe(true);
  });
  it("holds Latin, its accents and the quotes and dashes a song title can carry", () => {
    for (const ch of "AZaz09éñøÅçßœŁ’‘“”–—…·×") expect(held.has(ch.codePointAt(0)!), ch).toBe(true);
  });
});
