import type { Scrobble } from "@/lib/analysis/nostalgia";
import { NIGHT_START_HOUR, nightWeekday, type ZoneClock } from "@/lib/zone";

/**
 * A history counted night by night (spec 7.1): a night runs 4 a.m. to 4 a.m.
 * local and is named by the date it starts on, so a 1 a.m. play belongs to
 * the night before. After-midnight plays are 0:00 to 3:59 local. SERVER ONLY.
 */

export interface NightTally {
  night: number;
  plays: number;
  afterMidnight: number;
  /** Plays per genre that night, for the night's mix (7.6). */
  genres: Map<string, number>;
}

/** Plays per night, in the listener's zone. `genreOf` takes a lowercased artist. */
export function tallyNights(
  plays: Scrobble[],
  clock: ZoneClock,
  genreOf: (artistLower: string) => string | null = () => null,
): Map<number, NightTally> {
  const nights = new Map<number, NightTally>();
  for (const p of plays) {
    const night = clock.nightOf(p.uts);
    let t = nights.get(night);
    if (!t) {
      t = { night, plays: 0, afterMidnight: 0, genres: new Map() };
      nights.set(night, t);
    }
    t.plays++;
    const hour = Math.floor((((clock.localSeconds(p.uts) % 86_400) + 86_400) % 86_400) / 3600);
    if (hour < NIGHT_START_HOUR) t.afterMidnight++;
    const genre = genreOf(p.artist.toLowerCase());
    if (genre) t.genres.set(genre, (t.genres.get(genre) ?? 0) + 1);
  }
  return nights;
}

/**
 * "A usual Friday" (7.1): for each weekday, Sunday first, the median plays of
 * the history's nights on that weekday with at least one play, rounded, or
 * null for a weekday with none yet.
 */
export function usualByWeekday(nights: Iterable<NightTally>): (number | null)[] {
  const byDay: number[][] = Array.from({ length: 7 }, () => []);
  for (const t of nights) if (t.plays > 0) byDay[nightWeekday(t.night)].push(t.plays);
  return byDay.map((counts) => {
    if (counts.length === 0) return null;
    counts.sort((a, b) => a - b);
    const mid = counts.length >> 1;
    return Math.round(counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2);
  });
}
