import { getBlobStore } from "@/lib/store/blob";
import { SHARED_PREFIXES } from "@/lib/store/userKeys";

/**
 * NASA's data, the same for everyone (spec 7.3), stored one file per source
 * per month as `space/{source}/{YYYY-MM}.json`. Each file records the source's
 * documented first date and when it was last refreshed. SERVER ONLY.
 *
 * Nothing here is per listener: `space/` is a shared prefix
 * (`SHARED_PREFIXES` in `userKeys.ts`), which removal and expiry never touch.
 */

export type SpaceSource = "donki-gst" | "donki-flr" | "jpl-cad" | "jpl-fireball" | "epic" | "sdo" | "apod";

/** A geomagnetic storm DONKI logged, its Kp readings as DONKI times them.
    Since 2014 a reading is timed at the end of its 3-hour window (a storm
    starting 15:00 has its first at 18:00). Up to mid-2013 a storm's first
    reading is the moment it began, often off the 3-hour grid (`readingSpan`
    in `compact.ts`). */
export interface Storm {
  id: string;
  start: string;
  readings: { time: string; kp: number }[];
}

/** A solar flare: its peak and NOAA class ("X9.0"). */
export interface Flare {
  id: string;
  peak: string;
  class: string;
}

/** A close approach within 0.05 AU. JPL gives the time on the TDB scale,
    about 69 s from UTC; it's kept as given, to the minute. */
export interface Approach {
  name: string;
  time: string;
  au: number;
  /** Absolute magnitude, for the size estimate; null when JPL has none. */
  h: number | null;
}

/** A fireball JPL logged: its time and impact energy in kilotons. */
export interface Fireball {
  time: string;
  kt: number | null;
}

/** One day's EPIC images of Earth. */
export interface EpicDay {
  date: string;
  images: { name: string; time: string; lat: number; lon: number }[];
}

/** The Sun on a storm or X-flare day: the AIA 171 image nearest the event,
    or null when SDO has none that day. */
export interface SdoDay {
  date: string;
  time: string;
  url: string | null;
}

/** The Astronomy Picture of the Day, without the picture (architect, 1 Oct):
    its title, credit and a link to the day's page. */
export interface ApodDay {
  date: string;
  title: string;
  credit: string;
  mediaType: string;
  link: string;
}

export interface SpaceRecords {
  "donki-gst": Storm;
  "donki-flr": Flare;
  "jpl-cad": Approach;
  "jpl-fireball": Fireball;
  epic: EpicDay;
  sdo: SdoDay;
  apod: ApodDay;
}

export interface SpaceMonth<S extends SpaceSource> {
  source: S;
  month: string;
  /** The source's documented first date (spec 7.3): before it, "unknown". */
  firstDate: string;
  /** ISO time of the last fetch. */
  refreshedAt: string;
  records: SpaceRecords[S][];
}

export const SPACE_PREFIX = SHARED_PREFIXES[0];

export const monthKey = (source: SpaceSource, month: string) => `${SPACE_PREFIX}${source}/${month}.json`;

export async function readMonth<S extends SpaceSource>(source: S, month: string): Promise<SpaceMonth<S> | null> {
  const raw = await getBlobStore().get(monthKey(source, month));
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as SpaceMonth<S>;
  } catch {
    return null;
  }
}

export async function writeMonth<S extends SpaceSource>(file: SpaceMonth<S>): Promise<void> {
  await getBlobStore().put(monthKey(file.source, file.month), Buffer.from(JSON.stringify(file)));
}

/** Which months of a source are stored, with when each was refreshed. */
export async function storedMonths(source: SpaceSource): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const { key, lastModified } of await getBlobStore().list(`${SPACE_PREFIX}${source}/`)) {
    const m = /\/(\d{4}-\d{2})\.json$/.exec(key);
    if (m) out.set(m[1], lastModified);
  }
  return out;
}

/** A small JSON blob under `space/` (a cursor, an index), or null. */
export async function readSpaceJson<T>(key: string): Promise<T | null> {
  const raw = await getBlobStore().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeSpaceJson(key: string, value: unknown): Promise<void> {
  await getBlobStore().put(key, Buffer.from(JSON.stringify(value)));
}

/** "2024-05" for a date or ISO time. */
export const monthOf = (iso: string) => iso.slice(0, 7);

const DAY_MS = 86_400_000;
/** A month is final once read this long after it ended: every source logs late. */
export const FINAL_AFTER_MS = 7 * DAY_MS;
/** The first moment after `month`, in ms. */
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return Date.UTC(y, m, 1);
};
/** Whether a month read at `readAt` (ms) can still change. */
export const changing = (month: string, readAt: number) => readAt < monthEnd(month) + FINAL_AFTER_MS;

/* Final months never change, so a process keeps the ones it has read. */
const finalMonths = new Map<string, SpaceMonth<SpaceSource>>();

/** Test hook. */
export function forgetFinalMonths(): void {
  finalMonths.clear();
}

/** Several months of a source, a dozen reads at a time; a month not stored is left out. */
export async function readMonths<S extends SpaceSource>(source: S, months: string[]): Promise<Map<string, SpaceMonth<S>>> {
  const out = new Map<string, SpaceMonth<S>>();
  const todo = months.filter((m) => {
    const hit = finalMonths.get(monthKey(source, m));
    if (hit) out.set(m, hit as SpaceMonth<S>);
    return !hit;
  });
  for (let i = 0; i < todo.length; i += 12) {
    await Promise.all(
      todo.slice(i, i + 12).map(async (m) => {
        const file = await readMonth(source, m);
        if (!file) return;
        out.set(m, file);
        if (!changing(m, Date.parse(file.refreshedAt))) finalMonths.set(monthKey(source, m), file);
      }),
    );
  }
  return out;
}

/** Every month from `from` to `to`, inclusive, as "YYYY-MM". */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
