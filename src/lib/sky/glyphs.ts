/* The planets' and signs' glyphs (spec 8.9, 8.7.5), for the wheels and the
   share cards alike. Each carries U+FE0E, so it's drawn as text and never as
   an emoji: the signs are emoji by default. No React and no sky data, so a
   server route can read it too. */

export const VS15 = "\uFE0E";
export const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const PLANET_GLYPHS: Record<string, string> = {
  Sun: "☉",
  Moon: "☽",
  Mercury: "☿",
  Venus: "♀",
  Mars: "♂",
  Jupiter: "♃",
  Saturn: "♄",
};

export const signGlyph = (sign: string) => `${SIGN_GLYPHS[SIGNS.indexOf(sign)] ?? ""}${VS15}`;
export const planetGlyph = (body: string) => `${PLANET_GLYPHS[body] ?? ""}${VS15}`;
/** The planets in the cards' order, then the signs: U+E000 onward in the share cards' font. */
const CARD_ORDER = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
/** Every glyph, as the app draws it (with U+FE0E), in the cards' order. */
export const ALL_GLYPHS = [...CARD_ORDER.map(planetGlyph), ...SIGNS.map(signGlyph)];

/**
 * A planet's or sign's glyph for the share cards: a Private Use code point
 * the cards' own font draws (`cardFonts.ts`), since the renderer behind
 * them ignores U+FE0E and would send a sign to its emoji loader.
 */
export function cardGlyph(name: string): string {
  const planet = CARD_ORDER.indexOf(name);
  const sign = SIGNS.indexOf(name);
  const i = planet >= 0 ? planet : sign >= 0 ? CARD_ORDER.length + sign : -1;
  return i < 0 ? "" : String.fromCharCode(0xe000 + i);
}
