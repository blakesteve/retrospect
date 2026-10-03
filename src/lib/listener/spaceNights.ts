import { stormGrade, type StormGrade } from "@/lib/space/kp";
import type { NasaLog } from "@/lib/space/compact";
import { BACKFILL_FROM, FIRST_DATES } from "@/lib/space/sources";
import { monthsBetween, readMonths, readSpaceJson, SPACE_PREFIX, type EpicDay } from "@/lib/space/store";
import { nightName, type ZoneClock } from "@/lib/zone";

/**
 * NASA's and JPL's facts for each night, in the listener's zone (spec 7.3,
 * 7.4). SERVER ONLY. A night before a source's documented start is unknown,
 * never quiet; `known` says which sources cover it.
 */

const AU_KM = 149_597_870.7;
/** The flybys count's distance (7.3). */
export const FLYBY_AU = 0.01;
const LUNAR_DISTANCE_KM = 384_400;

/** Lunar distances in an AU distance: one decimal under 10 in the copy (7.3). */
export const lunarDistances = (au: number) => (au * AU_KM) / LUNAR_DISTANCE_KM;

/** An asteroid's size from its absolute magnitude, at albedo 0.14 (7.3):
    D = 1329 / sqrt(0.14) × 10^(−H/5) km. In meters to six decimals; the copy
    says "about" with two significant figures. The power of ten differs in
    its last digits between Node versions and platforms, and a size travels
    into stored records and the committed samples, so those digits go here. */
export const metersFromH = (h: number) => Math.round((1329 / Math.sqrt(0.14)) * 10 ** (-h / 5) * 1e9) / 1e6;

/** A flare class's size, for comparing: "X9.3" is above "M9.9". */
export function flareSize(cls: string): number {
  const letter = "ABCMX".indexOf(cls.charAt(0).toUpperCase());
  const n = Number(cls.slice(1));
  return letter < 0 || !Number.isFinite(n) ? -1 : letter * 100 + Math.min(n, 99.99);
}

export interface Asteroid {
  name: string;
  time: number;
  ld: number;
  meters: number | null;
}

export interface SpaceNight {
  /** Which sources cover this night at all. */
  known: { storms: boolean; flares: boolean; asteroids: boolean; fireballs: boolean };
  /** The night's highest Kp in NASA's storm log, or null for no storm logged. */
  kp: number | null;
  stormGrade: StormGrade | null;
  /** The biggest flare that night ("X5.8"): any class when every flare is
      read (`allFlares`), else the log's X flares only; null for none logged. */
  biggestFlare: string | null;
  xFlare: boolean;
  /** The nearest approach within 0.05 AU that night. */
  asteroid: Asteroid | null;
  fireballs: { time: number; kt: number | null }[];
  /** Close approaches within 0.01 AU, "closer than about 4 lunar distances" (7.3). */
  flybys: number;
  epic: { url: string; time: string; credit: string } | "none" | "unknown";
}

export interface SpaceOptions {
  /** Read every flare (for the biggest of any class); otherwise the log's X flares only. */
  allFlares?: boolean;
  /** Pick the night's EPIC photo. */
  epic?: boolean;
  /** Degrees east the zone faces at its standard offset, for EPIC (7.3). */
  longitude?: number;
  /** EPIC's index, already read (`readEpicIndex`), null when it isn't
      stored: a caller asking for many single nights reads it once. */
  epicIndex?: EpicIndex | null;
}

/** The fill's index of EPIC (`work.ts`): the days read, and EPIC's own list. */
export interface EpicIndex {
  days: string[];
  available?: string[];
}

export const readEpicIndex = () => readSpaceJson<EpicIndex>(`${SPACE_PREFIX}epic-done.json`);

const uts = (iso: string) => Date.parse(iso) / 1000;

/** The zone's standard (not daylight) offset as a longitude: its smaller
    offset over a year, times 15°, in −180 to 180 (7.3). */
export function zoneLongitude(clock: ZoneClock, year: number): number {
  const jan = clock.offsetAt(Date.UTC(year, 0, 15) / 1000);
  const jul = clock.offsetAt(Date.UTC(year, 6, 15) / 1000);
  const lon = (Math.min(jan, jul) / 3600) * 15;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const angle = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * NASA's facts for the nights from `first` to `last`, read from the stored
 * month files (spec 7.3) and the storm and flare log. Nights with nothing
 * logged are still listed, with `known` saying what was checked.
 */
export async function spaceNights(
  clock: ZoneClock,
  first: number,
  last: number,
  log: NasaLog | null,
  opts: SpaceOptions = {},
): Promise<Map<number, SpaceNight>> {
  const from = clock.nightStart(first);
  const to = clock.nightStart(last + 1) - 1;
  // A night's UTC span can reach into the month either side.
  const months = monthsBetween(new Date((from - 86_400) * 1000).toISOString().slice(0, 7), new Date((to + 86_400) * 1000).toISOString().slice(0, 7));
  const jplFrom = Date.parse(`${BACKFILL_FROM["jpl-cad"]}-01T00:00:00Z`) / 1000;

  const out = new Map<number, SpaceNight>();
  for (let n = first; n <= last; n++) {
    const start = clock.nightStart(n);
    out.set(n, {
      known: {
        storms: !!log && start >= log.stormsFrom,
        flares: !!log && start >= log.flaresFrom,
        asteroids: start >= jplFrom,
        fireballs: start >= jplFrom,
      },
      kp: null,
      stormGrade: null,
      biggestFlare: null,
      xFlare: false,
      asteroid: null,
      fireballs: [],
      flybys: 0,
      epic: "unknown",
    });
  }
  const inRange = (t: number) => t >= from && t <= to;

  if (log) {
    for (const [s, e, kp] of log.kp) {
      if (e < from || s > to) continue;
      for (let n = clock.nightOf(s); n <= clock.nightOf(Math.max(s, e - 1)); n++) {
        const night = out.get(n);
        if (night && (night.kp === null || kp > night.kp)) night.kp = kp;
      }
    }
    for (const night of out.values()) if (night.kp !== null) night.stormGrade = stormGrade(night.kp);
    /* The log's X flares always count, month files or not: the filters,
       wild nights and question 8 read the log, and a night's door must agree
       with them even when a month file is missing or older. */
    for (const [peak, cls] of log.xflares) {
      if (!inRange(peak)) continue;
      const night = out.get(clock.nightOf(peak))!;
      if (!night.biggestFlare || flareSize(cls) > flareSize(night.biggestFlare)) night.biggestFlare = cls;
    }
  }

  const [flares, approaches, fireballs] = await Promise.all([
    opts.allFlares ? readMonths("donki-flr", months) : Promise.resolve(null),
    readMonths("jpl-cad", months),
    readMonths("jpl-fireball", months),
  ]);
  for (const file of flares?.values() ?? []) {
    for (const f of file.records) {
      const t = uts(f.peak);
      if (!inRange(t)) continue;
      const night = out.get(clock.nightOf(t))!;
      if (!night.biggestFlare || flareSize(f.class) > flareSize(night.biggestFlare)) night.biggestFlare = f.class;
    }
  }
  for (const night of out.values()) night.xFlare = !!night.biggestFlare && night.biggestFlare.toUpperCase().startsWith("X");
  /* A month not stored yet (production's first fill) isn't known to be
     quiet. For flares, the log still covers X class, so a missing month only
     leaves the smaller flares unknown; `known.flares` stays the log's. */
  for (const [n, night] of out) {
    const month = new Date(clock.nightStart(n) * 1000).toISOString().slice(0, 7);
    if (!approaches.has(month)) night.known.asteroids = false;
    if (!fireballs.has(month)) night.known.fireballs = false;
  }

  for (const file of approaches.values()) {
    for (const a of file.records) {
      const t = uts(a.time);
      if (!inRange(t)) continue;
      const night = out.get(clock.nightOf(t))!;
      if (a.au <= FLYBY_AU) night.flybys++;
      const ld = lunarDistances(a.au);
      if (!night.asteroid || ld < night.asteroid.ld) {
        night.asteroid = { name: a.name, time: t, ld, meters: a.h === null ? null : metersFromH(a.h) };
      }
    }
  }
  for (const file of fireballs.values()) {
    for (const f of file.records) {
      const t = uts(f.time);
      if (inRange(t)) out.get(clock.nightOf(t))!.fireballs.push({ time: t, kt: f.kt });
    }
  }

  if (opts.epic) await pickEpic(out, months, opts.longitude ?? 0, opts.epicIndex === undefined ? await readEpicIndex() : opts.epicIndex);
  return out;
}

/**
 * Each night's photo of Earth: of its date's EPIC images, the one whose
 * centroid longitude is nearest the listener's (7.3). Before EPIC's first
 * date, unknown. After it, a date is "none" only when EPIC's own list of
 * dates (kept by the fill) has been read past it and doesn't include it, or
 * EPIC listed it with no photos; a listed date not read yet is unknown, and
 * so is everything while the fill hasn't stored EPIC's list.
 */
async function pickEpic(nights: Map<number, SpaceNight>, months: string[], longitude: number, index: EpicIndex | null): Promise<void> {
  const files = await readMonths("epic", months.filter((m) => m >= BACKFILL_FROM.epic));
  const byDate = new Map<string, EpicDay>();
  for (const f of files.values()) for (const d of f.records) byDate.set(d.date, d);
  const available = index?.available ? new Set(index.available) : null;
  const lastListed = index?.available?.reduce((a, d) => (d > a ? d : a), "") ?? "";
  for (const [n, night] of nights) {
    const date = nightName(n);
    if (date < FIRST_DATES.epic) continue;
    const day = byDate.get(date);
    if (!day || day.images.length === 0) {
      const listedEmpty = !!day; // read, and EPIC had no photo
      const unlisted = !!available && date <= lastListed && !available.has(date);
      night.epic = listedEmpty || unlisted ? "none" : "unknown";
      continue;
    }
    const best = day.images.reduce((a, b) => (angle(b.lon, longitude) < angle(a.lon, longitude) ? b : a));
    const [y, m, d] = date.split("-");
    night.epic = {
      url: `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${best.name}.jpg`,
      time: best.time,
      credit: "NASA EPIC team",
    };
  }
}
