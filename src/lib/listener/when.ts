/**
 * Day words: "today", "tomorrow", "Saturday", "Oct 24". The one copy that
 * Tonight's chips, its "none overhead" line and the answers' heads-ups all
 * use (8.4, 9.2), so they can't disagree.
 *
 * Counted from the night Tonight's heading names (architect, 2 Oct 2026):
 * between midnight and 4 a.m. it's still the night before (7.1), so at 1 a.m.
 * Tuesday, under "Monday night", Monday afternoon is "today", not
 * "yesterday", the rest of that night is "today" too, and Tuesday evening is
 * "tomorrow". Otherwise the moment keeps its calendar day, as the spec's own
 * chip has it: Venus stations at 2:09 a.m. on Saturday, Oct 3, 2026, and on
 * the Wednesday before, "Venus turns retrograde Saturday".
 */

import { nightName, zoneClock } from "@/lib/zone";
import { nightDate } from "./words";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY = 86_400;

/** Today, as the heading counts it, and the moment's day, both as days
    since 1970. A night is named by the date it starts on, so the two count
    alike. In the small hours, a moment in the same night is today. */
function days(zone: string, now: number, t: number): { today: number; day: number } {
  const clock = zoneClock(zone, Math.min(now, t), Math.max(now, t));
  const today = clock.nightOf(now);
  const smallHours = Math.floor(clock.localSeconds(now) / DAY) > today;
  return { today, day: smallHours && clock.nightOf(t) === today ? today : Math.floor(clock.localSeconds(t) / DAY) };
}

const weekday = (day: number) => WEEKDAYS[new Date(day * DAY * 1000).getUTCDay()];

/** "Oct 24", with the year when it isn't today's. */
function shortDay(day: number, today: number): string {
  const full = nightDate(nightName(day));
  return nightName(day).slice(0, 4) === nightName(today).slice(0, 4) ? full.replace(/, \d{4}$/, "") : full;
}

/** When something starts, from now: "today", "tomorrow", a weekday within a
    week, "Oct 24" within a year, else null (the caller says "around"). */
export function startsWhen(zone: string, now: number, t: number): string | null {
  const { today, day } = days(zone, now, t);
  const ahead = day - today;
  if (ahead <= 0) return "today";
  if (ahead === 1) return "tomorrow";
  if (ahead < 7) return weekday(day);
  if (t - now <= 365 * DAY) return shortDay(day, today);
  return null;
}

/** The same rules looking back: "today", "yesterday", a weekday within a
    week, then "Oct 24". */
export function happenedWhen(zone: string, now: number, t: number): string {
  const { today, day } = days(zone, now, t);
  const ago = today - day;
  if (ago <= 0) return "today";
  if (ago === 1) return "yesterday";
  if (ago < 7) return weekday(day);
  return shortDay(day, today);
}
