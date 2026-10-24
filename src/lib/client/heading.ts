import { nightDate } from "@/lib/listener/words";
import { nightName, nightWeekday, zoneClock } from "@/lib/zone";

/* Tonight's heading (spec 8.4). It needs only the zone and the time, no sky,
   so the page draws it at once, before tonight's sky arrives, and the
   heading never moves when it does (one line or two at 375px, by weekday and
   hour). The server writes the same words into `/api/sky/now`. */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * By local time: 0:00 to 3:59, the night before ("Monday night, Sept 28" at
 * 1 a.m. Tuesday); 4:00 to 15:59, "Tuesday, Sept 29"; 16:00 to 23:59,
 * "Tuesday night, Sept 29". A night runs 4 a.m. to 4 a.m. (7.1), so the date
 * is always the night's.
 */
export function tonightHeading(zone: string, now: number): string {
  const clock = zoneClock(zone, now);
  const hour = new Date(clock.localSeconds(now) * 1000).getUTCHours();
  const night = clock.nightOf(now);
  const date = nightDate(nightName(night)).replace(/, \d{4}$/, "");
  const weekday = WEEKDAYS[nightWeekday(night)];
  return hour >= 4 && hour < 16 ? `${weekday}, ${date}` : `${weekday} night, ${date}`;
}
