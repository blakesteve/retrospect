import { dateIn, timeIn } from "@/lib/listener/words";
import { nightName, zoneClock } from "@/lib/zone";
import {
  SIGNS,
  degreeInSign,
  dignitiesOf,
  dignityPhrase,
  haloDignity,
  isRetrograde,
  longitude,
  signOf,
  type Dignity,
  type Sign,
  type SkyBody,
} from "./sky";
import { SKY_RANGE, retrogradeWindows, signWindows } from "./windows";

/**
 * The planet sheet's data (spec 8.7.4): one body tonight, its dignity in each
 * sign, its path through a listener's history, its next station and sign
 * change, and the questions about it. SERVER ONLY: it reads the generated sky
 * windows.
 *
 * Stateless: the history's span comes in as two instants, so nothing here
 * reads a listener's record.
 */

export type BodyId = "sun" | "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn";

export const BODY_IDS: Record<BodyId, SkyBody> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
};

export type DignityWord = Dignity | "neutral";

/**
 * How precisely the sky data places this body's events. The files store every
 * instant to the second, but they're only as good as astronomy-engine's
 * positions (`data.test.ts` checks them against USNO and JPL Horizons): the
 * Sun and the Moon within 90 seconds, Mercury, Venus and Mars within 3
 * minutes, Jupiter and Saturn within 30 minutes (Saturn's 2028 Taurus
 * ingress is 25 minutes late). So the slow two read to the day, with the
 * half-hour window as a detail line.
 */
export type TimePrecision = "minute" | "day";
export const PRECISION: Record<SkyBody, TimePrecision> = {
  Sun: "minute",
  Moon: "minute",
  Mercury: "minute",
  Venus: "minute",
  Mars: "minute",
  Jupiter: "day",
  Saturn: "day",
};
/** Half the detail line's window for a "day" event, in seconds. */
export const DAY_PRECISION_HALF_WINDOW = 30 * 60;

/** The questions about each body, fixed by spec 8.7.4. */
export const PLANET_QUESTIONS: Record<SkyBody, readonly number[]> = {
  Sun: [],
  Moon: [2, 3, 5],
  Mercury: [1],
  Venus: [4, 6, 10, 11],
  Mars: [6, 9, 12],
  Jupiter: [],
  Saturn: [],
};

export interface PlanetTonight {
  sign: Sign;
  /** "8°06′" into the sign. */
  degreeText: string;
  /** The one the halo shows: home over exalted, fall over detriment. */
  dignity: DignityWord;
  retrograde: boolean;
  /** "Venus tonight", "The Moon tonight". */
  title: string;
  /** Plain English first: "In Scorpio, in her detriment", "Retrograde in
      Aries, in his fall", "In Leo, a neutral sign". */
  plain: string;
  /** The practitioner's term, second: "detriment in Scorpio", "domicile and
      exaltation in Virgo". Retrograde is in `plain` and the flag, not here. */
  term: string;
}

export interface DignityMapEntry {
  sign: Sign;
  dignity: DignityWord;
}

/** A run of the path in one dignity. Consecutive sign windows in the same
    dignity are merged, so a run can cross several signs: `signs` lists them
    in the order the body entered them ("Gemini", "Cancer", "Leo"). */
export interface PathSegment {
  /** Unix seconds, clipped to the span. */
  start: number;
  end: number;
  signs: Sign[];
  dignity: DignityWord;
}

interface PathBase {
  /** The span, clamped to the sky data (2002 through 2035), unix seconds. */
  start: number;
  end: number;
  /** "Mar 1, 2006": the strip's left end, in the listener's zone. */
  startLabel: string;
  /** The strip's right end, the same way. */
  endLabel: string;
}

/**
 * The body's path through the span, colored by dignity.
 *
 * - `segments`, for every body but the Moon: exact runs from the sign
 *   windows, clipped to the span, same-dignity neighbors merged.
 * - `nights`, for the Moon: she changes sign about 160 times a year, and even
 *   merged that's about 2,100 runs (150 KB) for 20 years. So she comes one
 *   letter per night instead, her dignity at 9 p.m. local (the instant the
 *   Sky wheel draws a night at): `h` home, `x` exalted, `d` detriment, `f`
 *   fall, `n` neutral. `nights[i]` is the night `firstNight` plus i days,
 *   and the first and last are the nights `start` and `end` fall in.
 */
export type PlanetPath =
  | (PathBase & { kind: "segments"; segments: PathSegment[] })
  | (PathBase & { kind: "nights"; firstNight: string; nights: string });

export const NIGHT_CODES: Record<DignityWord, string> = { home: "h", exalted: "x", detriment: "d", fall: "f", neutral: "n" };

interface NextEventBase {
  /** Unix seconds: the data's instant. For a "day" event, print the date
      only; the minutes aren't known. */
  time: number;
  precision: TimePrecision;
  /** "Venus turns direct Nov 13, 6:20 p.m. CST"; "Saturn enters Taurus Apr
      12, 2028". The year shows when it isn't this year. */
  text: string;
  /** For a "day" event, the window the instant is good to: "Between 10:35
      and 11:35 p.m. CDT". Null for a "minute" event. */
  detail: string | null;
}

export interface NextStation extends NextEventBase {
  direction: "retrograde" | "direct";
  /** The sign it stations in. */
  sign: Sign;
}

export interface NextSignChange extends NextEventBase {
  /** The sign it enters, and its dignity there. */
  sign: Sign;
  dignity: DignityWord;
  /** True when it backs into the sign while retrograde. */
  retrograde: boolean;
}

export interface PlanetSheet {
  body: SkyBody;
  /** The instant "tonight" and "next" were read at, unix seconds. */
  now: number;
  tonight: PlanetTonight;
  dignityMap: DignityMapEntry[];
  /** Null when the span lies wholly outside the sky data. */
  path: PlanetPath | null;
  next: { station: NextStation | null; signChange: NextSignChange | null };
  questions: number[];
}

/* ---------------------------------------------------------------------- */
/* Validation                                                             */
/* ---------------------------------------------------------------------- */

/** The instants a zone clock reads (`src/lib/zone.ts`): 1970 up to 2100.
    Copied, because zone.ts doesn't export it. */
const LATEST = Date.UTC(2100, 0, 1) / 1000;

export type PlanetQuery = { body: SkyBody; from: number; to: number } | { error: string };

/** `body`, `from` and `to` from a request, or why they're refused. */
export function parsePlanetQuery(params: URLSearchParams): PlanetQuery {
  const rawBody = params.get("body") ?? "";
  if (!Object.hasOwn(BODY_IDS, rawBody)) {
    return { error: `body must be one of ${Object.keys(BODY_IDS).join(", ")}` };
  }
  const times: number[] = [];
  for (const key of ["from", "to"]) {
    const raw = params.get(key) ?? "";
    const t = Number(raw);
    if (!/^\d{1,10}$/.test(raw) || t >= LATEST) {
      return { error: `${key} must be Unix seconds from 1970 up to 2100` };
    }
    times.push(t);
  }
  const [from, to] = times;
  if (from > to) return { error: "from must not be after to" };
  return { body: BODY_IDS[rawBody as BodyId], from, to };
}

/* ---------------------------------------------------------------------- */
/* The sheet                                                              */
/* ---------------------------------------------------------------------- */

const SKY_FROM = SKY_RANGE.from / 1000;
const SKY_LAST = SKY_RANGE.to / 1000 - 1; // the range's end is exclusive

const uts = (iso: string) => Date.parse(iso) / 1000;
const DISPLAY: Record<SkyBody, string> = {
  Sun: "The Sun",
  Moon: "The Moon",
  Mercury: "Mercury",
  Venus: "Venus",
  Mars: "Mars",
  Jupiter: "Jupiter",
  Saturn: "Saturn",
};

interface Window {
  start: number;
  end: number;
  sign: Sign;
  retrogradeAtStart: boolean;
}
interface Station {
  time: number;
  direction: "retrograde" | "direct";
  sign: Sign;
}

const windowsCache = new Map<SkyBody, Window[]>();
/** The body's sign windows as unix seconds, in time order. */
function windowsOf(body: SkyBody): Window[] {
  let list = windowsCache.get(body);
  if (!list) {
    list = signWindows
      .filter((w) => w.body === body)
      .map((w) => ({ start: uts(w.start), end: uts(w.end), sign: w.sign, retrogradeAtStart: w.retrogradeAtStart }))
      .sort((a, b) => a.start - b.start);
    windowsCache.set(body, list);
  }
  return list;
}

const stationsCache = new Map<SkyBody, Station[]>();
function stationsOf(body: SkyBody): Station[] {
  let list = stationsCache.get(body);
  if (!list) {
    list = retrogradeWindows
      .filter((w) => w.body === body)
      .flatMap((w): Station[] => [
        { time: uts(w.start), direction: "retrograde", sign: w.sign },
        { time: uts(w.end), direction: "direct", sign: w.signAtDirect },
      ])
      .sort((a, b) => a.time - b.time);
    stationsCache.set(body, list);
  }
  return list;
}

/** The index of the first window that ends after `t`. */
function firstEndingAfter(list: Window[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].end > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const TERM: Record<Dignity, string> = { home: "domicile", exalted: "exaltation", detriment: "detriment", fall: "fall" };

export function tonightOf(body: SkyBody, now: number): PlanetTonight {
  const date = new Date(now * 1000);
  const lon = longitude(body, date);
  const sign = signOf(lon);
  const { degree, minute } = degreeInSign(lon);
  const retrograde = isRetrograde(body, date);
  const all = dignitiesOf(body, sign);
  const standing = all.length === 0 ? "no major dignity or debility" : all.map((d) => TERM[d]).join(" and ");
  return {
    sign,
    degreeText: `${degree}°${String(minute).padStart(2, "0")}′`,
    dignity: haloDignity(body, sign),
    retrograde,
    title: `${DISPLAY[body]} tonight`,
    plain: `${retrograde ? "Retrograde in" : "In"} ${sign}, ${dignityPhrase(body, sign)}`,
    term: `${standing} in ${sign}`,
  };
}

export const dignityMapOf = (body: SkyBody): DignityMapEntry[] =>
  SIGNS.map((sign) => ({ sign, dignity: haloDignity(body, sign) }));

/** Exact runs over [start, end], same-dignity neighbors merged. */
export function pathSegments(body: SkyBody, start: number, end: number): PathSegment[] {
  const list = windowsOf(body);
  const out: PathSegment[] = [];
  for (let i = firstEndingAfter(list, start); i < list.length && list[i].start <= end; i++) {
    const w = list[i];
    const from = Math.max(w.start, start);
    const to = Math.min(w.end, end);
    // A window that only touches the span's end adds nothing, unless the
    // span is a single instant.
    if (to <= from && start !== end) continue;
    const dignity = haloDignity(body, w.sign);
    const last = out[out.length - 1];
    if (last && last.dignity === dignity) {
      last.end = to;
      if (last.signs[last.signs.length - 1] !== w.sign) last.signs.push(w.sign);
    } else {
      out.push({ start: from, end: to, signs: [w.sign], dignity });
    }
  }
  return out;
}

/** The Moon's sign at an instant, from her windows. */
function moonSignAt(t: number): Sign {
  const list = windowsOf("Moon");
  const i = firstEndingAfter(list, t);
  const w = list[i];
  return w && w.start <= t ? w.sign : signOf(longitude("Moon", new Date(t * 1000)));
}

const HOUR = 3600;

/** One letter a night for the Moon's dignity at 9 p.m. local. */
export function moonNights(zone: string, start: number, end: number): { firstNight: string; nights: string } {
  const clock = zoneClock(zone, start, end);
  const first = clock.nightOf(start);
  const last = clock.nightOf(end);
  let nights = "";
  for (let n = first; n <= last; n++) {
    const nightStart = clock.nightStart(n); // 4 a.m. local
    let t = nightStart + 17 * HOUR;
    t -= clock.offsetAt(t) - clock.offsetAt(nightStart); // a clock change in between
    nights += NIGHT_CODES[haloDignity("Moon", moonSignAt(t))];
  }
  return { firstNight: nightName(first), nights };
}

export function pathOf(body: SkyBody, from: number, to: number, zone: string): PlanetPath | null {
  const start = Math.max(from, SKY_FROM);
  const end = Math.min(to, SKY_LAST);
  if (start > end) return null;
  const base = { start, end, startLabel: dateIn(zone, start), endLabel: dateIn(zone, end) };
  if (body === "Moon") return { ...base, kind: "nights", ...moonNights(zone, start, end) };
  return { ...base, kind: "segments", segments: pathSegments(body, start, end) };
}

/* ---------------------------------------------------------------------- */
/* Next station and sign change                                           */
/* ---------------------------------------------------------------------- */

/** `dateIn`'s "Oct 3, 2024" in pieces. */
function dateParts(zone: string, t: number): { month: string; day: string; year: string } {
  const [, month, day, year] = /^(\S+) (\d+), (\d+)$/.exec(dateIn(zone, t))!;
  return { month, day, year };
}

/** "Nov 13", or "Jan 10, 2027" when it isn't this year where the listener is. */
function shortDate(zone: string, t: number, now: number): string {
  const d = dateParts(zone, t);
  return d.year === dateParts(zone, now).year ? `${d.month} ${d.day}` : `${d.month} ${d.day}, ${d.year}`;
}

/** "Apr 12", or "Apr 12 or 13" when the window crosses midnight. */
function dayWords(zone: string, from: number, to: number, now: number): string {
  const a = dateParts(zone, from);
  const b = dateParts(zone, to);
  if (a.month === b.month && a.day === b.day && a.year === b.year) return shortDate(zone, from, now);
  if (a.year !== b.year) return `${a.month} ${a.day}, ${a.year} or ${b.month} ${b.day}, ${b.year}`;
  const year = a.year === dateParts(zone, now).year ? "" : `, ${a.year}`;
  // "Apr 12 or 13" in one month, "Mar 31 or Apr 1" across two.
  return `${a.month} ${a.day} or ${a.month === b.month ? "" : `${b.month} `}${b.day}${year}`;
}

/** "Between 10:35 and 11:35 p.m. CDT". */
function windowWords(zone: string, from: number, to: number): string {
  const a = timeIn(zone, from);
  const b = timeIn(zone, to);
  const aDate = dateParts(zone, from);
  const bDate = dateParts(zone, to);
  if (aDate.day !== bDate.day) {
    return `Between ${a}, ${aDate.month} ${aDate.day}, and ${b}, ${bDate.month} ${bDate.day}`;
  }
  // "10:35 p.m. CDT": the clock, then the half of the day and the zone, which
  // are said once when both ends share them.
  const [aClock, ...aRest] = a.split(" ");
  const bRest = b.split(" ").slice(1);
  return aRest.join(" ") === bRest.join(" ") ? `Between ${aClock} and ${b}` : `Between ${a} and ${b}`;
}

/** The "when" of an event, and its detail line. */
function whenWords(body: SkyBody, zone: string, t: number, now: number): { when: string; detail: string | null } {
  if (PRECISION[body] === "minute") return { when: `${shortDate(zone, t, now)}, ${timeIn(zone, t)}`, detail: null };
  // Centered on the data's instant, to the nearest 5 minutes, plus or minus
  // half an hour: Saturn's worst case (25 minutes) plus the rounding still fits.
  const center = Math.round(t / 300) * 300;
  const from = center - DAY_PRECISION_HALF_WINDOW;
  const to = center + DAY_PRECISION_HALF_WINDOW;
  return { when: dayWords(zone, from, to, now), detail: windowWords(zone, from, to) };
}

export function nextStation(body: SkyBody, zone: string, now: number): NextStation | null {
  const s = stationsOf(body).find((x) => x.time > now);
  if (!s) return null;
  const { when, detail } = whenWords(body, zone, s.time, now);
  return {
    time: s.time,
    precision: PRECISION[body],
    text: `${DISPLAY[body]} turns ${s.direction} ${when}`,
    detail,
    direction: s.direction,
    sign: s.sign,
  };
}

export function nextSignChange(body: SkyBody, zone: string, now: number): NextSignChange | null {
  const w = windowsOf(body).find((x) => x.start > now);
  if (!w) return null;
  const { when, detail } = whenWords(body, zone, w.start, now);
  return {
    time: w.start,
    precision: PRECISION[body],
    text: `${DISPLAY[body]} ${w.retrogradeAtStart ? "backs into" : "enters"} ${w.sign} ${when}`,
    detail,
    sign: w.sign,
    dignity: haloDignity(body, w.sign),
    retrograde: w.retrogradeAtStart,
  };
}

/** Everything the planet sheet shows, for a history spanning `from` to `to`. */
export function planetSheet(body: SkyBody, from: number, to: number, zone: string, now: number): PlanetSheet {
  return {
    body,
    now,
    tonight: tonightOf(body, now),
    dignityMap: dignityMapOf(body),
    path: pathOf(body, from, to, zone),
    next: { station: nextStation(body, zone, now), signChange: nextSignChange(body, zone, now) },
    questions: [...PLANET_QUESTIONS[body]],
  };
}
