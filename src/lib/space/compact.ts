import { getBlobStore } from "@/lib/store/blob";
import { FIRST_DATES } from "./sources";
import { SPACE_PREFIX, monthOf, monthsBetween, type Flare, type Storm } from "./store";

/**
 * The storm and flare log the answers engine reads in one call (architect,
 * 30 Sept): every Kp reading and every X-class flare peak, as UTC times, kept
 * by month and patched as DONKI's monthly files are refreshed. Nights are
 * per listener's zone, so they're worked out by the engine, never stored.
 */

export const COMPACT_KEY = `${SPACE_PREFIX}donki-compact.json`;

export interface DonkiCompact {
  /** ISO time the log is whole up to: the oldest read of any month DONKI can
      still change (`work.ts`). The answers route refreshes when it's 3 hours
      old. */
  refreshedAt: string;
  /** Kp readings by the month of their storm's start: [from, to, Kp], the
      span each covers (`readingSpan`). */
  kp: Record<string, [number, number, number][]>;
  /** X-class flare peaks by month: [peak, class]. */
  xflares: Record<string, [number, string][]>;
  /** When each month above was read from DONKI. A stored month newer than
      this is patched in again: two passes at once can write the log over
      each other, and the one written last may hold the older month. */
  kpAt: Record<string, string>;
  xflaresAt: Record<string, string>;
}

export const emptyCompact = (): DonkiCompact => ({ refreshedAt: "", kp: {}, xflares: {}, kpAt: {}, xflaresAt: {} });

const uts = (isoTime: string) => Date.parse(isoTime) / 1000;

const THREE_HOURS = 3 * 3600;

/**
 * The span a Kp reading covers, in Unix seconds: the 3 hours before its time,
 * as DONKI times readings since 2014, but never before its storm began. Up to
 * mid-2013 a storm's first reading is the moment it began (20:57, 15:52, at
 * its start time), so it covers only that instant; read as a 3-hour window
 * it put 1 to 6 nights per zone before storms began (checked over the whole
 * log, 1 Oct 2026). A few records have a reading before their own start; it
 * keeps its 3 hours.
 */
export function readingSpan(stormStart: number, time: number): [number, number] {
  return [time >= stormStart ? Math.max(time - THREE_HOURS, stormStart) : time - THREE_HOURS, time];
}

/** A month's storms into the log, read from DONKI at `readAt` (ISO). */
export function patchStorms(c: DonkiCompact, month: string, storms: Storm[], readAt: string): void {
  c.kp[month] = storms.flatMap((s) =>
    s.readings.map((r): [number, number, number] => [...readingSpan(uts(s.start), uts(r.time)), r.kp]),
  );
  c.kpAt[month] = readAt;
}

/** A month's flares into the log, X class only, read from DONKI at `readAt`. */
export function patchFlares(c: DonkiCompact, month: string, flares: Flare[], readAt: string): void {
  c.xflares[month] = flares.filter((f) => /^X/i.test(f.class)).map((f): [number, string] => [uts(f.peak), f.class]);
  c.xflaresAt[month] = readAt;
}

export async function readCompact(): Promise<DonkiCompact | null> {
  const raw = await getBlobStore().get(COMPACT_KEY);
  if (!raw) return null;
  try {
    return { ...emptyCompact(), ...(JSON.parse(raw.toString("utf8")) as Partial<DonkiCompact>) };
  } catch {
    return null;
  }
}

export async function writeCompact(c: DonkiCompact): Promise<void> {
  await getBlobStore().put(COMPACT_KEY, Buffer.from(JSON.stringify(c)));
}

/** DONKI logs late: the last 3 days before a refresh don't count yet (7.3). */
export const NASA_LAG_SECONDS = 3 * 86_400;

/** What the engine needs from the log. */
export interface NasaLog {
  /** For stored answers' freshness (6.6): the day coverage ends and a hash of
      the log, so answers are recomputed at most daily, or when what NASA
      logged changes, not on every 3-hourly refresh. */
  stamp: string;
  /** When the log was last whole, Unix seconds. */
  refreshedAt: number;
  /** Nights are tested up to here: the start of the UTC day 3 days before
      `refreshedAt`, since DONKI logs late. */
  coveredUntil: number;
  /** Where each log starts: before it, a night is unknown, not quiet. */
  stormsFrom: number;
  flaresFrom: number;
  /** [from, to, Kp], sorted by from. */
  kp: [number, number, number][];
  /** [peak, class], sorted by peak. */
  xflares: [number, string][];
}

/** FNV-1a over a string, as 8 hex digits. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The log, or null while any month from DONKI's start to the latest refresh
 * is missing: a month that hasn't been read would otherwise count as quiet,
 * every storm in it an "outside" night. Questions 7 and 8 then read "Not
 * checked yet" (spec 6.6).
 */
export function nasaLogFrom(c: DonkiCompact | null): NasaLog | null {
  if (!c || !c.refreshedAt) return null;
  const through = monthOf(c.refreshedAt);
  const missing = (from: string, have: Record<string, unknown>) => monthsBetween(from, through).some((m) => !(m in have));
  if (missing(FIRST_DATES["donki-gst"].slice(0, 7), c.kp) || missing(FIRST_DATES["donki-flr"].slice(0, 7), c.xflares)) {
    return null;
  }
  const refreshedAt = uts(c.refreshedAt);
  const lagged = refreshedAt - NASA_LAG_SECONDS;
  const coveredUntil = lagged - (lagged % 86_400);
  const kp = Object.values(c.kp).flat().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const xflares = Object.values(c.xflares).flat().sort((a, b) => a[0] - b[0]);
  return {
    stamp: `${new Date(coveredUntil * 1000).toISOString().slice(0, 10)}|${fnv1a(JSON.stringify([kp, xflares]))}`,
    refreshedAt,
    coveredUntil,
    stormsFrom: uts(`${FIRST_DATES["donki-gst"]}T00:00:00Z`),
    flaresFrom: uts(`${FIRST_DATES["donki-flr"]}T00:00:00Z`),
    kp,
    xflares,
  };
}

export async function readNasaLog(): Promise<NasaLog | null> {
  return nasaLogFrom(await readCompact());
}
