/**
 * The share cards (spec 8.7.5): which card a sheet or link names, what it
 * says in plain words, and the links to it and to its image. Pure, so the
 * share sheet and `/api/og` say the same thing, word for word.
 */

export type CardRef = { kind: "song"; id: string } | { kind: "night"; date: string } | { kind: "q"; id: string };

/** The two images: 1200 by 630 for unfurls, 1080 by 1920 (9:16) for "Save image". */
export const CARD_SIZES = { wide: { width: 1200, height: 630 }, tall: { width: 1080, height: 1920 } } as const;
export type CardSize = keyof typeof CARD_SIZES;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** "song:{songId}", "night:{YYYY-MM-DD}" or "q:{questionId}", as the share sheet's parameter and the image's `card` carry it. */
export function cardRef(value: string | null | undefined): CardRef | null {
  if (!value) return null;
  const i = value.indexOf(":");
  const kind = value.slice(0, i);
  const rest = value.slice(i + 1);
  if (i < 0 || !rest) return null;
  if (kind === "song" && ID.test(rest)) return { kind, id: rest };
  if (kind === "q" && ID.test(rest)) return { kind, id: rest };
  if (kind === "night" && DATE.test(rest)) return { kind, date: rest };
  return null;
}

export const cardValue = (ref: CardRef): string => `${ref.kind}:${ref.kind === "night" ? ref.date : ref.id}`;

/** A question as the listener would ask it of themselves: "Does a full moon change how late I listen?" */
export const firstPerson = (question: string): string => question.replace(/\byou\b/g, "I").replace(/\byour\b/g, "my");

/** "The sky the minute I first played Aquarius by Boards of Canada · 1:38 p.m. CDT, Apr 8, 2024" */
export const songSays = (song: { track: string; artist: string; firstPlayTime: string; firstPlayDate: string }): string =>
  `The sky the minute I first played ${song.track} by ${song.artist} · ${song.firstPlayTime}, ${song.firstPlayDate}`;

/** "My night of May 10, 2024: the strongest geomagnetic storm in about 20 years", or the night alone. */
export const nightSays = (dateText: string, wildTitle: string | null): string =>
  `My night of ${dateText}${wildTitle ? `: ${wildTitle.charAt(0).toLowerCase()}${wildTitle.slice(1)}` : ""}`;

/** "Does a full moon change how late I listen? No." A word never goes without its question. */
export const questionSays = (question: string, word: string): string => `${firstPerson(question)} ${word}.`;

/** The link a card shares: the listener's page with the card's sheet, in the sharer's zone (7.1). */
export function shareLink(origin: string, username: string, ref: CardRef, zone: string): string {
  const param = ref.kind === "night" ? `night=${ref.date}` : `${ref.kind}=${encodeURIComponent(ref.id)}`;
  return `${origin}/u/${encodeURIComponent(username)}?${param}&tz=${encodeURIComponent(zone)}`;
}

/** The card's image, at either size. With no card, the listener's generic card. */
export function cardImage(username: string, ref: CardRef | null, zone: string, size: CardSize = "wide"): string {
  const parts = [`u=${encodeURIComponent(username)}`];
  if (ref) parts.push(`card=${encodeURIComponent(cardValue(ref))}`);
  parts.push(`tz=${encodeURIComponent(zone)}`);
  if (size === "tall") parts.push("size=tall");
  return `/api/og?${parts.join("&")}`;
}

/** The card a listener page's own sheet parameter names, for its unfurl: `?song=`, `?night=` or `?q=`. */
export function cardFromPage(params: Record<string, string | string[] | undefined>): CardRef | null {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : null;
  };
  const song = one("song");
  if (song) return cardRef(`song:${song}`);
  const night = one("night");
  if (night) return cardRef(`night:${night}`);
  const q = one("q");
  if (q) return cardRef(`q:${q}`);
  return null;
}
