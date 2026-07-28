import { makeInWindow, type WindowBounds } from "@/lib/ephemeris/retrogrades";
import { mulberry32, type Rng } from "./rng";

export interface Scrobble {
  uts: number; // unix seconds
  artist: string;
  track: string;
}

export type NostalgiaLevel = "track" | "artist";

export interface TaggedScrobble {
  uts: number;
  nostalgic: boolean;
}

export interface TagResult {
  tagged: TaggedScrobble[];
  /** Analysis span (warm-up excluded), unix seconds. */
  spanStart: number;
  spanEnd: number;
}

export interface IndexResult {
  /** P(nostalgic | retrograde) / P(nostalgic | direct). NaN if undersampled. */
  index: number;
  retroRate: number;
  directRate: number;
  retroN: number;
  directN: number;
}

export interface PermutationResult {
  /** Two-tailed p-value: share of rotations with |log(index)| >= observed. */
  p: number;
  iterations: number;
  /** Null-distribution index samples, for the skeptic-mode histogram. */
  samples: number[];
}

const DAY = 86400;

/** Earliest scrobble time per identity key at the given level. */
export function firstListens(
  scrobbles: Scrobble[],
  level: NostalgiaLevel
): Map<string, number> {
  const first = new Map<string, number>();
  for (const s of scrobbles) {
    const key =
      level === "track"
        ? `${s.artist} ${s.track}`.toLowerCase()
        : s.artist.toLowerCase();
    const seen = first.get(key);
    if (seen === undefined || s.uts < seen) first.set(key, s.uts);
  }
  return first;
}

/**
 * Tag each scrobble as nostalgic (first heard > threshold ago) or not.
 * The user's first `thresholdDays` of history is excluded: nothing can be
 * nostalgic yet, and including it only adds noise.
 */
export function tagScrobbles(
  scrobbles: Scrobble[],
  level: NostalgiaLevel,
  thresholdDays: number
): TagResult {
  if (scrobbles.length === 0) return { tagged: [], spanStart: 0, spanEnd: 0 };
  const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
  const first = firstListens(sorted, level);
  const thresholdSec = thresholdDays * DAY;
  const spanStart = sorted[0].uts + thresholdSec;
  const spanEnd = sorted[sorted.length - 1].uts;

  const tagged: TaggedScrobble[] = [];
  for (const s of sorted) {
    if (s.uts < spanStart) continue;
    const key =
      level === "track"
        ? `${s.artist} ${s.track}`.toLowerCase()
        : s.artist.toLowerCase();
    tagged.push({ uts: s.uts, nostalgic: s.uts - first.get(key)! > thresholdSec });
  }
  return { tagged, spanStart, spanEnd };
}

export function computeIndex(
  tagged: TaggedScrobble[],
  bounds: WindowBounds[]
): IndexResult {
  const inRetro = makeInWindow(bounds);
  let retroN = 0,
    retroNost = 0,
    directN = 0,
    directNost = 0;
  for (const s of tagged) {
    if (inRetro(s.uts)) {
      retroN++;
      if (s.nostalgic) retroNost++;
    } else {
      directN++;
      if (s.nostalgic) directNost++;
    }
  }
  const retroRate = retroN ? retroNost / retroN : NaN;
  const directRate = directN ? directNost / directN : NaN;
  const index = retroN && directN && directRate > 0 ? retroRate / directRate : NaN;
  return { index, retroRate, directRate, retroN, directN };
}

/**
 * Circular permutation test. Rotates the retrograde mask along the analysis
 * span by uniform random offsets, preserving window count/durations/spacing
 * and the listening series' own autocorrelation, and asks how often chance
 * produces an index at least as extreme (two-tailed, in |log index|).
 */
export function permutationTest(
  tagged: TaggedScrobble[],
  bounds: WindowBounds[],
  spanStart: number,
  spanEnd: number,
  observedIndex: number,
  iterations = 2000,
  rng: Rng = mulberry32(0x5eed)
): PermutationResult {
  const spanLen = spanEnd - spanStart;
  if (!Number.isFinite(observedIndex) || spanLen <= 0 || tagged.length === 0) {
    return { p: NaN, iterations: 0, samples: [] };
  }
  const observed = Math.abs(Math.log(observedIndex));
  const samples: number[] = [];
  let asExtreme = 0;
  let valid = 0;

  for (let i = 0; i < iterations; i++) {
    const offset = Math.floor(rng() * spanLen);
    const inRetro = makeInWindow(bounds);
    let retroN = 0,
      retroNost = 0,
      directN = 0,
      directNost = 0;
    for (const s of tagged) {
      const shifted = spanStart + ((((s.uts - spanStart + offset) % spanLen) + spanLen) % spanLen);
      if (inRetro(shifted)) {
        retroN++;
        if (s.nostalgic) retroNost++;
      } else {
        directN++;
        if (s.nostalgic) directNost++;
      }
    }
    if (!retroN || !directN || !directNost) continue;
    const sim = retroNost / retroN / (directNost / directN);
    if (sim <= 0) continue;
    valid++;
    samples.push(sim);
    if (Math.abs(Math.log(sim)) >= observed) asExtreme++;
  }
  return { p: valid ? asExtreme / valid : NaN, iterations: valid, samples };
}

export interface Verdict {
  headline: string;
  detail: string;
  significant: boolean;
}

export interface VerdictSubject {
  /** "Mercury" — the accused. */
  name: string;
  /** "when Mercury is retrograde" — phrasing for the detail line. */
  when: string;
}

const MERCURY: VerdictSubject = { name: "Mercury", when: "when Mercury is retrograde" };

export function verdict(
  index: number,
  p: number,
  minN: boolean,
  subject: VerdictSubject = MERCURY
): Verdict {
  const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
  if (!minN || !Number.isFinite(index) || !Number.isFinite(p)) {
    return {
      headline: "The stars withhold judgment.",
      detail: "Not enough listening history for a verdict yet. Keep scrobbling.",
      significant: false,
    };
  }
  const pStr = p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`;
  if (p < 0.05 && index > 1) {
    return {
      headline: "The heavens have a measurable grip on you.",
      detail: `You revisit old music ${pct(index - 1)} more ${subject.when} (${pStr}).`,
      significant: true,
    };
  }
  if (p < 0.05 && index < 1) {
    return {
      headline: "Reverse-cursed.",
      detail: `You revisit old music ${pct(1 - index)} LESS ${subject.when} (${pStr}).`,
      significant: true,
    };
  }
  return {
    headline: `${subject.name} is innocent.`,
    detail: `Your nostalgia does not follow the sky (p=${p.toFixed(2)}).`,
    significant: false,
  };
}
