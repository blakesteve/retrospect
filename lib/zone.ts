/**
 * The listener's time zone, and their nights (spec 7.1).
 *
 * The browser sends its IANA zone as `tz`, and every play is read with that
 * zone's real offsets, daylight saving included. Asking `Intl` about each of
 * 500,000 plays costs seconds, so a clock finds the zone's offset changes once
 * for each year it covers and each play is then a binary search.
 *
 * A night runs from 4 a.m. to 4 a.m. local time and is named by the date it
 * starts on, so a 1 a.m. song belongs to the night before. A night that
 * crosses a daylight-saving change is 23 or 25 hours long.
 */

const DAY = 86400;
const HOUR = 3600;

/** A night starts at this local hour. */
export const NIGHT_START_HOUR = 4;

/** The zone used when a request sends none, or one that's refused. */
export const FALLBACK_ZONE = "UTC";

/**
 * The zone's canonical name, or null if it isn't one.
 *
 * Validated by building a formatter (spec 6.6) and named by what the
 * formatter resolves it to, which folds aliases together: in Node 24,
 * Asia/Kolkata and Asia/Calcutta both resolve to "Asia/Calcutta", US/Central
 * to "America/Chicago", and "utc" and "Etc/GMT" to "UTC". Never checked
 * against `Intl.supportedValuesOf("timeZone")`, which in Node 24 leaves out
 * UTC, Asia/Kolkata and Europe/Kyiv.
 *
 * Node 24 also accepts a bare offset such as "+05:30". That's a fixed offset
 * with no daylight saving, not a place, so it's refused.
 */
export function canonicalZone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  let zone: string;
  try {
    zone = new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return /^[+-]/.test(zone) ? null : zone;
}

export interface RequestZone {
  zone: string;
  /** True when the request sent no zone, or one that was refused, so times
      are in UTC for that reason. A browser that reports UTC is on UTC, and
      this is false. */
  fellBack: boolean;
}

/** The zone a request asks for in `tz`, or UTC. */
export function requestZone(params: URLSearchParams): RequestZone {
  const zone = canonicalZone(params.get("tz"));
  return zone ? { zone, fellBack: false } : { zone: FALLBACK_ZONE, fellBack: true };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Seconds east of UTC at `uts`, asked of `Intl`. About 3 µs a call (Node 24),
    which is why plays go through a clock instead. */
export function intlOffset(zone: string, uts: number): number {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  const at = Math.floor(uts);
  const v: Record<string, string> = {};
  for (const part of f.formatToParts(at * 1000)) v[part.type] = part.value;
  const wall = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second) / 1000;
  return wall - at;
}

/** One UTC year of a zone: its offset at the first second, then each change. */
interface YearOffsets {
  start: number;
  at: number[];
  offset: number[];
}

const years = new Map<string, YearOffsets>();

/**
 * Probes once a day and bisects each change to the second, then probes again
 * from the change, so two changes inside one day are both found. Two that
 * cancel out inside one day would be missed. Probing hourly instead finds the
 * same 10,469 changes in all 421 zones Node 24 knows, 2002 through 2035
 * (checked once, 30 September 2026).
 */
function yearOffsets(zone: string, year: number): YearOffsets {
  const key = `${zone}|${year}`;
  const cached = years.get(key);
  if (cached) return cached;
  const from = Date.UTC(year, 0, 1) / 1000;
  const last = Date.UTC(year + 1, 0, 1) / 1000 - 1;
  const out: YearOffsets = { start: intlOffset(zone, from), at: [], offset: [] };
  let prevAt = from;
  let prev = out.start;
  let probe = Math.min(from + DAY, last);
  while (prevAt < last) {
    if (intlOffset(zone, probe) === prev) {
      prevAt = probe;
      probe = Math.min(probe + DAY, last);
      continue;
    }
    // The first second whose offset isn't `prev`.
    let lo = prevAt;
    let hi = probe;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (intlOffset(zone, mid) === prev) lo = mid;
      else hi = mid;
    }
    prev = intlOffset(zone, hi);
    out.at.push(hi);
    out.offset.push(prev);
    prevAt = hi;
  }
  years.set(key, out);
  return out;
}

export interface ZoneClock {
  readonly zone: string;
  /** Seconds east of UTC at this instant. */
  offsetAt(uts: number): number;
  /** The local wall clock, as seconds since 1970 (read it as if it were UTC). */
  localSeconds(uts: number): number;
  /** The night this instant belongs to, as days from 1970-01-01 to the date
      the night starts on. Name it with `nightName`. */
  nightOf(uts: number): number;
}

const yearOf = (uts: number) => new Date(uts * 1000).getUTCFullYear();

/** The instants a clock reads: 1970 up to 2100. Plays start in 2002 and the
    sky data ends with 2035; anything else (NaN, milliseconds passed as
    seconds) is a bug upstream, and reading it would build decades of
    offsets for nothing. */
const EARLIEST = 0;
const LATEST = Date.UTC(2100, 0, 1) / 1000;
const checked = (uts: number): number => {
  if (!(uts >= EARLIEST && uts < LATEST)) throw new RangeError(`Not an instant a zone clock reads: ${uts}`);
  return uts;
};

/**
 * A clock for one zone, covering the years from `fromUts` to `toUts` (a
 * history's first and last play). An instant outside them extends it.
 * Throws a RangeError for a name `canonicalZone` refuses, and for an instant
 * before 1970 or from 2100 on.
 */
export function zoneClock(zone: string, fromUts: number, toUts: number = fromUts): ZoneClock {
  const name = canonicalZone(zone);
  if (!name) throw new RangeError(`Not a time zone: ${JSON.stringify(zone)}`);

  // at[0] is the first covered second, so every covered instant finds an entry.
  let at: number[] = [];
  let offset: number[] = [];
  let firstYear = 0;
  let lastYear = -1;
  let coveredFrom = 0;
  let coveredTo = 0;

  const cover = (from: number, to: number) => {
    firstYear = from;
    lastYear = to;
    at = [];
    offset = [];
    for (let y = from; y <= to; y++) {
      const year = yearOffsets(name, y);
      if (offset.length === 0 || offset[offset.length - 1] !== year.start) {
        at.push(Date.UTC(y, 0, 1) / 1000);
        offset.push(year.start);
      }
      for (let i = 0; i < year.at.length; i++) {
        at.push(year.at[i]);
        offset.push(year.offset[i]);
      }
    }
    coveredFrom = Date.UTC(from, 0, 1) / 1000;
    coveredTo = Date.UTC(to + 1, 0, 1) / 1000;
  };
  cover(yearOf(Math.min(checked(fromUts), checked(toUts))), yearOf(Math.max(fromUts, toUts)));

  const offsetAt = (uts: number): number => {
    // Written so NaN takes this branch too, and is refused.
    if (!(uts >= coveredFrom && uts < coveredTo)) {
      checked(uts);
      const y = yearOf(uts);
      cover(Math.min(firstYear, y), Math.max(lastYear, y));
    }
    let lo = 0;
    let hi = at.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= uts) lo = mid;
      else hi = mid - 1;
    }
    return offset[lo];
  };

  return {
    zone: name,
    offsetAt,
    localSeconds: (uts) => uts + offsetAt(uts),
    nightOf: (uts) => Math.floor((uts + offsetAt(uts) - NIGHT_START_HOUR * HOUR) / DAY),
  };
}

/** A night's name, the date it starts on: "2026-03-07". */
export function nightName(night: number): string {
  return new Date(night * DAY * 1000).toISOString().slice(0, 10);
}

/** The weekday a night starts on, 0 for Sunday to 6 for Saturday. */
export function nightWeekday(night: number): number {
  return (((night + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

/** The month a night starts in, 0 for January to 11 for December. */
export function nightMonth(night: number): number {
  return new Date(night * DAY * 1000).getUTCMonth();
}
