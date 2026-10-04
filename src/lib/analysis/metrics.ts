import type { Scrobble, TaggedScrobble, TagResult } from "./nostalgia";
import { firstListens } from "./nostalgia";
import type { WindowBounds } from "@/lib/ephemeris/retrogrades";
import { makeInWindow } from "@/lib/ephemeris/retrogrades";
import { mulberry32, type Rng } from "./rng";
import { permutationP } from "./confidence";

const DAY = 86400;

/* ------------------------------------------------------------------ */
/* Taggers — all share metrics reduce to TaggedScrobble[] and reuse    */
/* computeIndex/permutationTest from nostalgia.ts unchanged.           */
/* ------------------------------------------------------------------ */

/** Reunion with an artist you'd played ≥ minPriorPlays times, after ≥ gapDays of silence. */
export function tagOldFlame(
  scrobbles: Scrobble[],
  gapDays: number,
  minPriorPlays = 10
): TagResult {
  if (scrobbles.length === 0) return { tagged: [], spanStart: 0, spanEnd: 0 };
  const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
  const gapSec = gapDays * DAY;
  const spanStart = sorted[0].uts + gapSec; // a reunion can't exist before one gap has fit
  const spanEnd = sorted[sorted.length - 1].uts;

  const lastPlay = new Map<string, number>();
  const playCount = new Map<string, number>();
  const tagged: TaggedScrobble[] = [];
  for (const s of sorted) {
    const key = s.artist.toLowerCase();
    const prev = lastPlay.get(key);
    const count = playCount.get(key) ?? 0;
    if (s.uts >= spanStart) {
      tagged.push({
        uts: s.uts,
        nostalgic: prev !== undefined && s.uts - prev > gapSec && count >= minPriorPlays,
      });
    }
    lastPlay.set(key, s.uts);
    playCount.set(key, count + 1);
  }
  return { tagged, spanStart, spanEnd };
}

/** Plays landing between midnight and 4am, user-local time (tzOffsetMinutes east of UTC). */
export function tagNightOwl(scrobbles: Scrobble[], tzOffsetMinutes: number): TagResult {
  if (scrobbles.length === 0) return { tagged: [], spanStart: 0, spanEnd: 0 };
  const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
  const shift = tzOffsetMinutes * 60;
  const tagged: TaggedScrobble[] = sorted.map((s) => ({
    uts: s.uts,
    nostalgic: Math.floor(((s.uts + shift) % DAY + DAY) % DAY / 3600) < 4,
  }));
  return { tagged, spanStart: sorted[0].uts, spanEnd: sorted[sorted.length - 1].uts };
}

/** First-ever play of a track. Warm-up excluded: early history is all "new" by construction. */
export function tagDiscovery(scrobbles: Scrobble[], warmupDays = 365): TagResult {
  if (scrobbles.length === 0) return { tagged: [], spanStart: 0, spanEnd: 0 };
  const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
  const first = firstListens(sorted, "track");
  const spanStart = sorted[0].uts + warmupDays * DAY;
  const spanEnd = sorted[sorted.length - 1].uts;
  const tagged: TaggedScrobble[] = [];
  for (const s of sorted) {
    if (s.uts < spanStart) continue;
    const key = `${s.artist} ${s.track}`.toLowerCase();
    tagged.push({ uts: s.uts, nostalgic: first.get(key) === s.uts });
  }
  return { tagged, spanStart, spanEnd };
}

/* ------------------------------------------------------------------ */
/* Rate metric (intensity): plays/day inside windows vs outside        */
/* ------------------------------------------------------------------ */

export interface VolumeResult {
  index: number;
  /** plays per day */
  retroRate: number;
  directRate: number;
  retroN: number;
  directN: number;
}

function overlapSeconds(bounds: WindowBounds[], spanStart: number, spanEnd: number): number {
  let total = 0;
  for (const [a, b] of bounds) {
    const lo = Math.max(a, spanStart);
    const hi = Math.min(b, spanEnd);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

export function volumeIndex(
  uts: number[],
  bounds: WindowBounds[],
  spanStart: number,
  spanEnd: number
): VolumeResult {
  const inWindow = makeInWindow(bounds);
  const windowSec = overlapSeconds(bounds, spanStart, spanEnd);
  const outSec = Math.max(0, spanEnd - spanStart - windowSec);
  let retroN = 0;
  for (const t of uts) if (inWindow(t)) retroN++;
  const directN = uts.length - retroN;
  const retroRate = windowSec > 0 ? retroN / (windowSec / DAY) : NaN;
  const directRate = outSec > 0 ? directN / (outSec / DAY) : NaN;
  const index = retroRate > 0 && directRate > 0 ? retroRate / directRate : NaN;
  return { index, retroRate, directRate, retroN, directN };
}

export function volumePermutationTest(
  uts: number[],
  bounds: WindowBounds[],
  spanStart: number,
  spanEnd: number,
  observedIndex: number,
  iterations = 2000,
  rng: Rng = mulberry32(0x5eed)
): { p: number; matches: number; iterations: number; samples: number[] } {
  const spanLen = spanEnd - spanStart;
  if (!Number.isFinite(observedIndex) || spanLen <= 0 || uts.length === 0) {
    return { p: NaN, matches: 0, iterations: 0, samples: [] };
  }
  const inWindow = makeInWindow(bounds);
  const windowSec = overlapSeconds(bounds, spanStart, spanEnd);
  const outSec = Math.max(1, spanEnd - spanStart - windowSec);
  const observed = Math.abs(Math.log(observedIndex));
  const samples: number[] = [];
  let matches = 0;
  let valid = 0;
  if (windowSec <= 0) return { p: NaN, matches: 0, iterations: 0, samples };

  for (let i = 0; i < iterations; i++) {
    const offset = Math.floor(rng() * spanLen);
    let inN = 0;
    for (const t of uts) {
      const shifted = spanStart + ((((t - spanStart + offset) % spanLen) + spanLen) % spanLen);
      if (inWindow(shifted)) inN++;
    }
    const outN = uts.length - inN;
    /* A rotation with every play inside the windows, or none, is a total
       swing (an index of infinity or 0). These used to be dropped, which let
       p come out 0; see permutationTest in nostalgia.ts. */
    const sim = outN ? inN / (windowSec / DAY) / (outN / (outSec / DAY)) : Infinity;
    valid++;
    if (Number.isFinite(sim)) samples.push(sim);
    if (Math.abs(Math.log(sim)) >= observed) matches++;
  }
  return { p: permutationP(matches, valid), matches, iterations: valid, samples };
}
