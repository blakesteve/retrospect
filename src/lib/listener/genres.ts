import type { Scrobble } from "@/lib/analysis/nostalgia";
import { genreOfTags, type TagStore } from "@/lib/genres";
import { nightName } from "@/lib/zone";
import type { NightTally } from "./nights";

/**
 * Genres as facts about your listening, never as claims about the sky (spec
 * 7.6). Last.fm's community tags, written as Last.fm writes them. Nothing
 * here is tested against anything. SERVER ONLY.
 */

/** A genre is listed once it has this many plays. */
export const MIN_GENRE_PLAYS = 50;
/** At most this many genres are listed. */
export const MAX_GENRES = 12;
/** A night's mix names genres with at least this many plays that night. */
export const NIGHT_GENRE_PLAYS = 3;
/** "Rising" compares the last 90 days before the last play with the whole
    history, and needs this many plays in those 90 days, as today. */
export const RISING_DAYS = 90;
export const RISING_MIN_PLAYS = 20;

/** Each tagged artist's genre, by lowercased name: the first tag that isn't
    junk, a number or the artist's own name (unchanged from today). */
export function genreMap(tags: TagStore): Map<string, string> {
  const out = new Map<string, string>();
  for (const [artist, list] of Object.entries(tags.artists)) {
    const g = genreOfTags(list, artist);
    if (g) out.set(artist, g);
  }
  return out;
}

export interface GenreFact {
  genre: string;
  plays: number;
  /** Of all your plays (noise excluded); plays by untagged artists count as "other". */
  share: number;
  /** Up to 3, most played first, as the first play spelled them. */
  topArtists: string[];
  /** When its share of the last 90 days is above its share of the whole history. */
  rising: { ratio: number; recentPlays: number } | null;
  /** Its biggest night, the most recent on a tie. */
  peakNight: { date: string; plays: number };
}

/** The listed genres (7.6). `plays` sorted by time, noise excluded. */
export function genreFacts(plays: Scrobble[], genres: Map<string, string>, nights: Map<number, NightTally>): GenreFact[] {
  if (plays.length === 0) return [];
  const totals = new Map<string, { plays: number; recent: number; artists: Map<string, { name: string; plays: number }> }>();
  const recentFrom = plays[plays.length - 1].uts - RISING_DAYS * 86_400;
  let recentAll = 0;
  for (const p of plays) {
    const recent = p.uts >= recentFrom;
    if (recent) recentAll++;
    const lower = p.artist.toLowerCase();
    const g = genres.get(lower);
    if (!g) continue;
    let t = totals.get(g);
    if (!t) totals.set(g, (t = { plays: 0, recent: 0, artists: new Map() }));
    t.plays++;
    if (recent) t.recent++;
    const a = t.artists.get(lower);
    if (a) a.plays++;
    else t.artists.set(lower, { name: p.artist, plays: 1 });
  }

  return [...totals]
    .filter(([, t]) => t.plays >= MIN_GENRE_PLAYS)
    .sort((a, b) => b[1].plays - a[1].plays || a[0].localeCompare(b[0]))
    .slice(0, MAX_GENRES)
    .map(([genre, t]) => {
      const share = t.plays / plays.length;
      const ratio = recentAll > 0 ? t.recent / recentAll / share : 0;
      let peak = { night: 0, plays: 0 };
      for (const n of nights.values()) {
        const count = n.genres.get(genre) ?? 0;
        if (count > peak.plays || (count === peak.plays && count > 0 && n.night > peak.night)) peak = { night: n.night, plays: count };
      }
      return {
        genre,
        plays: t.plays,
        share,
        topArtists: [...t.artists.values()]
          .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name))
          .slice(0, 3)
          .map((a) => a.name),
        rising: t.recent >= RISING_MIN_PLAYS && ratio > 1 ? { ratio, recentPlays: t.recent } : null,
        peakNight: { date: nightName(peak.night), plays: peak.plays },
      };
    });
}

/** A night's mix: its top 3 genres with at least 3 plays (7.6). */
export function nightMix(tally: NightTally): { genre: string; plays: number }[] {
  return [...tally.genres]
    .filter(([, n]) => n >= NIGHT_GENRE_PLAYS)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([genre, plays]) => ({ genre, plays }));
}
