/**
 * Times and dates as the redesign writes them (spec 9.2): "7:18 a.m. CDT",
 * "Oct 3, 2024", with "Sept" for September. In the listener's zone, with
 * the zone abbreviation `Intl` gives for en-US: letters for US zones,
 * "GMT+2" style elsewhere.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(zone: string, uts: number): Record<string, string> {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
    formatters.set(zone, f);
  }
  return Object.fromEntries(f.formatToParts(new Date(uts * 1000)).map((p) => [p.type, p.value]));
}

/** "7:18 a.m. CDT" */
export function timeIn(zone: string, uts: number): string {
  const p = parts(zone, uts);
  return `${p.hour}:${p.minute} ${p.dayPeriod === "PM" ? "p.m." : "a.m."} ${p.timeZoneName}`;
}

/** "Oct 3, 2024" */
export function dateIn(zone: string, uts: number): string {
  const p = parts(zone, uts);
  return `${MONTHS[Number(p.month) - 1]} ${p.day}, ${p.year}`;
}

/** A night's date ("2024-10-03") as "Oct 3, 2024". */
export function nightDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** One to nine in words, then numerals with separators. */
export const spelled = (n: number) => (n >= 0 && n < 10 ? SMALL[n] : n.toLocaleString("en-US"));

/** "about 140 m": two significant figures in whole meters (7.3). */
export function aboutMeters(m: number): string {
  if (m < 1) return "under 1 m";
  const digits = Math.floor(Math.log10(m)) + 1;
  const rounded = digits <= 2 ? Math.round(m) : Math.round(m / 10 ** (digits - 2)) * 10 ** (digits - 2);
  return `about ${rounded.toLocaleString("en-US")} m`;
}

/** "1.6 lunar distances", one decimal under 10 (7.3). */
export function lunarDistanceWords(ld: number): string {
  const n = ld < 10 ? ld.toFixed(1) : Math.round(ld).toLocaleString("en-US");
  return `${n} lunar distance${n === "1.0" ? "" : "s"}`;
}
