import { makeInWindow, type WindowBounds } from "@/lib/ephemeris/retrogrades";
import { mulberry32, type Rng } from "./rng";
import { evidenceStatus, permutationP, type Evidence, type VerdictStatus } from "./confidence";

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
  /** Two-tailed p-value, (matches + 1) / (iterations + 1): see permutationP. */
  p: number;
  /** Rotations that matched or beat the observed swing, either way. */
  matches: number;
  /** Rotations that produced a comparison at all. */
  iterations: number;
  /** Null-distribution index samples, for the skeptic-mode histogram. A
      rotation with none of the tagged plays outside the windows (an infinite
      index) counts toward `matches` and `iterations` but can't be drawn, so
      it's left out; one with none inside (index 0) is drawn at 0. */
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
    return { p: NaN, matches: 0, iterations: 0, samples: [] };
  }
  // An observed index of 0 (none of the tagged plays inside the windows) is
  // an infinite swing, and only an equally total swing can match it.
  const observed = Math.abs(Math.log(observedIndex));
  const samples: number[] = [];
  let matches = 0;
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
    // No plays on one side: this rotation has nothing to compare.
    if (!retroN || !directN) continue;
    /* Rotations where one side has none of the tagged plays used to be
       dropped. They are the most extreme outcomes chance can produce, so
       dropping them meant an observed index of 0 could never be matched and
       came out p = 0. Count them: none inside is an index of 0, none outside
       an infinite one, and both are a total swing. */
    const sim = directNost ? retroNost / retroN / (directNost / directN) : Infinity;
    valid++;
    if (Number.isFinite(sim)) samples.push(sim);
    if (Math.abs(Math.log(sim)) >= observed) matches++;
  }
  return { p: permutationP(matches, valid), matches, iterations: valid, samples };
}

export interface Verdict {
  headline: string;
  /** Plain English, and never a p-value: pages add the likelihood, and the
      p-value only for a visitor who has asked for it. */
  detail: string;
  /** Passed the scramble test. Only ever true when status is "tested". */
  significant: boolean;
  /** Whether there was enough to test at all. Untested and unremarkable both
      have `significant: false`; this is what tells them apart. */
  status: VerdictStatus;
}

export interface VerdictSubject {
  /** "Mercury" — the accused. */
  name: string;
  /** "when Mercury is retrograde" — phrasing for the detail line. */
  when: string;
}

const MERCURY: VerdictSubject = { name: "Mercury", when: "when Mercury is retrograde" };

/** The Mercury × Nostalgia verdict. The report uses `metricVerdict`, which
    is this for any measure; the two share their floors and their status. */
export function verdict(
  index: number,
  p: number,
  evidence: Evidence,
  subject: VerdictSubject = MERCURY
): Verdict {
  const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
  const status = evidenceStatus(index, p, evidence);
  if (status !== "tested") {
    return {
      headline: "The stars withhold judgment.",
      detail: "Not enough listening history for a verdict yet. Keep scrobbling.",
      significant: false,
      status,
    };
  }
  if (p < 0.05 && index > 1) {
    return {
      headline: "The heavens have a measurable grip on you.",
      detail: `You revisit old music ${pct(index - 1)} more ${subject.when}.`,
      significant: true,
      status,
    };
  }
  if (p < 0.05 && index < 1) {
    return {
      headline: "Reverse-cursed.",
      detail: `You revisit old music ${pct(1 - index)} LESS ${subject.when}.`,
      significant: true,
      status,
    };
  }
  return {
    headline: `${subject.name} is innocent.`,
    detail: "Nothing here is bigger than what chance produces on its own.",
    significant: false,
    status,
  };
}
