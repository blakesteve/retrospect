/* Small client helpers for laying out what the routes send: dates the client
   has to name (a night's weekday) and times it has to ask for (9 p.m. on a
   night). Sentences about the sky and the answers come from the server. */

import type { Night, SongEntry, Songs } from "./api";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** A real calendar date, "YYYY-MM-DD": Feb 30 isn't one, though `Date.parse` rolls it on. */
export const isNightDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

/** "Friday", for a night named by the date it starts on. */
export const nightWeekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** "May 10, 2024". */
export function nightDateText(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "May 10". */
export function nightShort(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Friday, May 10, 2024". */
export const nightTitle = (date: string) => `${nightWeekday(date)}, ${nightDateText(date)}`;

export const monthOf = (date: string) => date.slice(0, 7);

function offsetSeconds(zone: string, uts: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(uts * 1000))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) / 1000;
  return asUtc - uts;
}

/** Unix seconds of a local wall time in a zone: "9 p.m. on the night" (8.7.2). */
export function utsAtLocal(date: string, hour: number, zone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour) / 1000;
  let uts = wall - offsetSeconds(zone, wall);
  uts = wall - offsetSeconds(zone, uts);
  return uts;
}

/** The night "now" belongs to: nights run 4 a.m. to 4 a.m. (7.1). */
export function tonightDate(zone: string, nowMs = Date.now()): string {
  const uts = Math.floor(nowMs / 1000) - 4 * 3600;
  const local = new Date((uts + offsetSeconds(zone, uts)) * 1000);
  return local.toISOString().slice(0, 10);
}

/** "Mostly pop, then indie pop and bedroom pop." (7.6) */
export function genreMix(genres: Night["genres"]): string | null {
  const g = genres.map((x) => x.genre);
  if (g.length === 0) return null;
  if (g.length === 1) return `Mostly ${g[0]}.`;
  return `Mostly ${g[0]}, then ${g.slice(1).join(" and ")}.`;
}

/** Every selected song, the row's and "See all"'s, by id. */
export function songIndex(songs: Songs | undefined): Map<string, SongEntry> {
  const m = new Map<string, SongEntry>();
  for (const s of [...(songs?.row ?? []), ...(songs?.listed ?? [])]) m.set(s.songId, s);
  return m;
}

/** "Fri", the weekday of a moment in a zone. */
export const weekdayShortAt = (zone: string, uts: number) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: zone }).format(new Date(uts * 1000));

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export const spelled = (n: number) => (n >= 0 && n < 10 ? SMALL[n] : n.toLocaleString("en-US"));
export const count = (n: number) => n.toLocaleString("en-US");
