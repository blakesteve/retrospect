import type { Scrobble, TaggedScrobble, TagResult, Verdict } from "./nostalgia";
import { firstListens, tagScrobbles } from "./nostalgia";
import type { WindowBounds } from "@/lib/ephemeris/retrogrades";
import { makeInWindow } from "@/lib/ephemeris/retrogrades";
import { mulberry32, type Rng } from "./rng";

const DAY = 86400;

/* ------------------------------------------------------------------ */
/* Metric metadata                                                     */
/* ------------------------------------------------------------------ */

export type MetricKey = "nostalgia" | "oldflame" | "intensity" | "nightowl" | "discovery";

export interface MetricMeta {
  key: MetricKey;
  /** 'share' = ratio of tagged-play rates; 'rate' = plays-per-day ratio. */
  kind: "share" | "rate";
  name: string;
  /** What a tagged play is, plural — "old favorites", "artist reunions". */
  tagNoun: string;
  /** Explainer step-3 heading + body. */
  defineTitle: string;
  defineBody: (thresholdDays: number) => string;
  /** The hero question: metric.question("a full moon") — leads the whole page. */
  question: (qSubject: string) => string;
  /** Hero "in plain terms" line. */
  plainTerms: (when: string, up: boolean, pct: number) => string;
  /** Verdict detail lines. */
  detailUp: (pct: string, when: string, pStr: string) => string;
  detailDown: (pct: string, when: string, pStr: string) => string;
  /** Label for the peak-day card. */
  peakDayLabel: string;
  peakDayBody: (count: number) => string;
  /** Threshold slider config, or null when the metric has no knob. */
  slider: { label: string; min: number; max: number; default: number } | null;
  /** Whether the track/artist level toggle applies. */
  hasLevelToggle: boolean;
}

export const METRICS: Record<MetricKey, MetricMeta> = {
  nostalgia: {
    key: "nostalgia",
    question: (s) => `Does ${s} send you running back to old favorites?`,
    kind: "share",
    name: "Nostalgia Index",
    tagNoun: "old favorites",
    defineTitle: "We defined “an old favorite.”",
    defineBody: (t) =>
      `A play counts as nostalgic if you first played it more than ${humanDays(t)} earlier. New discoveries don't count; comfort listens do.`,
    plainTerms: (when, up, pct) =>
      `In plain terms: ${when}, your urge to replay music you already love goes ${up ? "up" : "down"} by about ${pct}%.`,
    detailUp: (pct, when, p) => `You revisit old music ${pct} more ${when} (${p}).`,
    detailDown: (pct, when, p) => `You revisit old music ${pct} LESS ${when} (${p}).`,
    peakDayLabel: "Your most nostalgic day",
    peakDayBody: (n) => `${n.toLocaleString()} old favorites in a single day. Whatever happened, the music remembers.`,
    slider: { label: "“Old favorite” = first heard over", min: 90, max: 1825, default: 365 },
    hasLevelToggle: true,
  },
  oldflame: {
    key: "oldflame",
    question: (s) => `Does ${s} bring your old flames back?`,
    kind: "share",
    name: "Old Flame Index",
    tagNoun: "artist reunions",
    defineTitle: "We defined “an old flame.”",
    defineBody: (t) =>
      `A play counts as a reunion when you return to an artist you'd played at least 10 times before, then not touched for over ${humanDays(t)}. Not a casual repeat: a genuine "we need to talk."`,
    plainTerms: (when, up, pct) =>
      `In plain terms: ${when}, long-lost favorite artists come back into rotation about ${pct}% ${up ? "more" : "less"} often.`,
    detailUp: (pct, when, p) => `Long-lost favorite artists resurface ${pct} more often ${when} (${p}).`,
    detailDown: (pct, when, p) => `Long-lost favorite artists resurface ${pct} LESS often ${when} (${p}).`,
    peakDayLabel: "Your biggest reunion day",
    peakDayBody: (n) => `${n.toLocaleString()} old flames rekindled in a single day. Somebody was going through it.`,
    slider: { label: "A “reunion” needs a silence of", min: 180, max: 1460, default: 548 },
    hasLevelToggle: false,
  },
  intensity: {
    key: "intensity",
    question: (s) => `Does ${s} change how much you listen?`,
    kind: "rate",
    name: "Intensity Index",
    tagNoun: "plays",
    defineTitle: "We measured your engine.",
    defineBody: () =>
      `No tagging tricks here: we simply count how much you listen per day. Mars rules drive and momentum; the question is whether yours stalls (or floors it) when Mars reverses.`,
    plainTerms: (when, up, pct) =>
      `In plain terms: ${when}, you play about ${pct}% ${up ? "more" : "less"} music per day than usual.`,
    detailUp: (pct, when, p) => `You play ${pct} more music per day ${when} (${p}).`,
    detailDown: (pct, when, p) => `You play ${pct} LESS music per day ${when} (${p}).`,
    peakDayLabel: "Your loudest day",
    peakDayBody: (n) => `${n.toLocaleString()} plays in a single day. The neighbors know your taste by now.`,
    slider: null,
    hasLevelToggle: false,
  },
  nightowl: {
    key: "nightowl",
    question: (s) => `Does ${s} keep you up past midnight?`,
    kind: "share",
    name: "Night Owl Index",
    tagNoun: "after-midnight plays",
    defineTitle: "We defined “up too late.”",
    defineBody: () =>
      `A play counts as nocturnal if it lands between midnight and 4am, your local time. Full moon lore says nobody sleeps; your scrobbles kept the receipts.`,
    plainTerms: (when, up, pct) =>
      `In plain terms: ${when}, you're about ${pct}% ${up ? "more" : "less"} likely to be up past midnight with headphones on.`,
    detailUp: (pct, when, p) => `You're up past midnight with music ${pct} more often ${when} (${p}).`,
    detailDown: (pct, when, p) => `You're up past midnight with music ${pct} LESS often ${when} (${p}).`,
    peakDayLabel: "Your most nocturnal night",
    peakDayBody: (n) => `${n.toLocaleString()} plays between midnight and 4am. The moon saw everything.`,
    slider: null,
    hasLevelToggle: false,
  },
  discovery: {
    key: "discovery",
    question: (s) => `Does ${s} push you toward brand-new music?`,
    kind: "share",
    name: "Discovery Index",
    tagNoun: "first listens",
    defineTitle: "We defined “something new.”",
    defineBody: () =>
      `A play counts as a discovery if it's the very first time you ever played that track. Eclipse lore is all sudden endings and new chapters. Does your library agree?`,
    plainTerms: (when, up, pct) =>
      `In plain terms: ${when}, you try brand-new music about ${pct}% ${up ? "more" : "less"} often.`,
    detailUp: (pct, when, p) => `You discover new music ${pct} more often ${when} (${p}).`,
    detailDown: (pct, when, p) => `You discover new music ${pct} LESS often ${when} (${p}).`,
    peakDayLabel: "Your biggest discovery day",
    peakDayBody: (n) => `${n.toLocaleString()} brand-new tracks in a single day. A whole new chapter, timestamped.`,
    slider: null,
    hasLevelToggle: false,
  },
};

function humanDays(days: number): string {
  return days >= 365
    ? `${(days / 365).toFixed(days % 365 === 0 ? 0 : 1)} year${days >= 548 ? "s" : ""}`
    : `${days} days`;
}

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

/** Dispatch a share-metric tagger. (Intensity is handled by volumeIndex below.) */
export function tagForMetric(
  metric: MetricKey,
  scrobbles: Scrobble[],
  opts: { thresholdDays: number; level: "track" | "artist"; tzOffsetMinutes: number }
): TagResult {
  switch (metric) {
    case "nostalgia":
      return tagScrobbles(scrobbles, opts.level, opts.thresholdDays);
    case "oldflame":
      return tagOldFlame(scrobbles, opts.thresholdDays);
    case "nightowl":
      return tagNightOwl(scrobbles, opts.tzOffsetMinutes);
    case "discovery":
      return tagDiscovery(scrobbles);
    case "intensity":
      throw new Error("intensity is a rate metric — use volumeIndex");
  }
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
): { p: number; iterations: number; samples: number[] } {
  const spanLen = spanEnd - spanStart;
  if (!Number.isFinite(observedIndex) || spanLen <= 0 || uts.length === 0) {
    return { p: NaN, iterations: 0, samples: [] };
  }
  const inWindow = makeInWindow(bounds);
  const windowSec = overlapSeconds(bounds, spanStart, spanEnd);
  const outSec = Math.max(1, spanEnd - spanStart - windowSec);
  const observed = Math.abs(Math.log(observedIndex));
  const samples: number[] = [];
  let asExtreme = 0;
  let valid = 0;

  for (let i = 0; i < iterations; i++) {
    const offset = Math.floor(rng() * spanLen);
    let inN = 0;
    for (const t of uts) {
      const shifted = spanStart + ((((t - spanStart + offset) % spanLen) + spanLen) % spanLen);
      if (inWindow(shifted)) inN++;
    }
    const outN = uts.length - inN;
    if (!inN || !outN || windowSec <= 0) continue;
    const sim = inN / (windowSec / DAY) / (outN / (outSec / DAY));
    if (sim <= 0) continue;
    valid++;
    samples.push(sim);
    if (Math.abs(Math.log(sim)) >= observed) asExtreme++;
  }
  return { p: valid ? asExtreme / valid : NaN, iterations: valid, samples };
}

/* ------------------------------------------------------------------ */
/* Verdict from metric copy                                            */
/* ------------------------------------------------------------------ */

export function metricVerdict(
  metric: MetricMeta,
  index: number,
  p: number,
  minN: boolean,
  subject: { name: string; when: string; plural?: boolean }
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
      detail: metric.detailUp(pct(index - 1), subject.when, pStr),
      significant: true,
    };
  }
  if (p < 0.05 && index < 1) {
    return {
      headline: "Reverse-cursed.",
      detail: metric.detailDown(pct(1 - index), subject.when, pStr),
      significant: true,
    };
  }
  return {
    headline: `${subject.name} ${subject.plural ? "are" : "is"} innocent.`,
    detail: `Your ${metric.tagNoun} hold steady no matter what this sky does; chance explains everything we found (p=${p.toFixed(2)}).`,
    significant: false,
  };
}
