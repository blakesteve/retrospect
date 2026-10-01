import { tagScrobbles, type Scrobble } from "@/lib/analysis/nostalgia";
import { tagDiscovery } from "@/lib/analysis/metrics";
import { MIN_EVENTS, MIN_RETRO_N, permutationP, type VerdictStatus } from "@/lib/analysis/confidence";
import { mulberry32 } from "@/lib/analysis/rng";
import { isNoiseArtist } from "@/lib/noise";
import { degreeInSign, longitude, signOf, type SkyBody } from "@/lib/sky/sky";
import { zoneClock, type ZoneClock } from "@/lib/zone";
import type { NasaLog } from "@/lib/space/compact";
import { selectSongs, songsOf } from "@/lib/listener/songs";
import { conditionFor, nightsCondition, type Condition, type ConditionWindow } from "./conditions";
import { QUESTIONS, type Measure, type Question, type QuestionId } from "./questions";
import { circle, countRotated, offsetOf, place, type Circle } from "./rotation";

/**
 * Computes all 12 questions for one listener and zone in one pass (spec 6.8,
 * as step 0 measured it): the four measures are tagged once, then each
 * question runs its 2,000 rotations by rotating the windows (`rotation.ts`).
 * What comes back is numbers only. Every sentence is built when the answers
 * are served (`payload.ts`), so copy can change without a recompute and the
 * time-dependent ones ("The next one begins Saturday") stay current.
 */

/** Bump when anything here changes what an answer would be. Stored answers
    from another version are served once, then recomputed (spec 6.6). */
/** 2: questions 5 and 6 measure old favorites and how much you listen
    (1 Oct 2026). The version is in every seed (6.6), so all 12 reshuffle. */
export const ANSWERS_VERSION = 2;
/** The stored record's shape, apart from the analysis: a record in an older
    format is recomputed, with the same seeds (6.6 keeps the analysis version
    in the seed, and adding pairings changed no answer). 2: pairings. */
export const RECORD_FORMAT = 2;
export const ROTATIONS = 2_000;
/** At most this many shuffles go to the client, for the histogram. */
export const MAX_NULL_SAMPLES = 600;

const DAY = 86_400;

export type NotChecked = "nasa" | "error";

export interface EarlyRead {
  /** The event's first and last second (its windows, merged). */
  start: number;
  end: number;
  /** The measure inside this event's windows against everything outside the
      windows, as a fraction (0.14 is 14% more). Null when it can't be
      measured: the event fell in the first year, or holds no plays. */
  swing: number | null;
  /** Still going when the history ends. */
  inProgress: boolean;
  /** Before the measure's warm-up ended (the first year, for questions 1, 3, 5 and 11). */
  firstYear: boolean;
  /** Retrogrades: "from 10°50′ Aries back to 24°37′ Pisces". */
  path: string | null;
}

export interface MergedEvent {
  start: number;
  end: number;
  windows: { start: number; end: number; sign?: string; aspect?: 60 | 120; side?: "+" | "-" }[];
}

export interface QuestionRecord {
  id: QuestionId;
  /** The test's status, or null when the question wasn't checked. */
  status: VerdictStatus | null;
  notChecked: NotChecked | null;
  /** Inside against outside, as a ratio (1.23 is 23% more). Null when there's
      none to compute. */
  index: number | null;
  p: number | null;
  matches: number;
  /** Rotations that gave a comparison. */
  iterations: number;
  /** Spec 6.4's c: the range is exp(log index -/+ c) - 1. Null when no
      range can be shown (c is infinite, or the question wasn't tested). */
  rangeC: number | null;
  /** Plays the measure tests that fell inside the windows. */
  inPlays: number;
  /** Separate events, after merges (spec 6.2). */
  events: number;
  spanStart: number;
  spanEnd: number;
  /** When a measure with a warm-up starts counting. */
  warmupReadyFrom: number | null;
  /** Events made of several windows, for the "counts once" note. */
  merged: MergedEvent[];
  /** Below the event floor only (spec 6.5). */
  earlyReads: EarlyRead[];
  /** Spec 6.5: how much one stretch this long swings on its own, as a
      fraction. Below the event floor only. */
  typicalSingleSwing: number | null;
  /** Shuffled indexes, at most MAX_NULL_SAMPLES, for the histogram. */
  nullSamples: number[];
  /** Songs first played while the condition held (7.4): the listed songs
      (7.5) whose first play falls inside a window, or for 7 and 8 on a
      night NASA logged. Facts, not proof. */
  pairings: string[];
}

export interface AnswerRecord {
  version: number;
  /** RECORD_FORMAT when computed; missing on a record from before step 5. */
  format?: number;
  zone: string;
  /** What the history held: plays, first and last play. Behind the store's
      means a recompute. */
  stamp: string;
  /** NASA's latest refresh (spec 7.3). Null until step 4 brings the data. */
  nasaStamp: string | null;
  computedAt: number;
  /** Plays after the noise filter. */
  plays: number;
  historyStart: number;
  historyEnd: number;
  /** Some question threw and is "not checked": the next request recomputes. */
  incomplete: boolean;
  questions: QuestionRecord[];
}

/** What a history held, for the freshness check (spec 6.6). */
export const historyStamp = (stored: Scrobble[]) =>
  stored.length === 0 ? "0" : `${stored.length}|${stored[0].uts}|${stored[stored.length - 1].uts}`;

interface Tagged {
  /** Times of the plays the measure tests, in order. */
  times: number[];
  /** Whether each is tagged; null for how much you listen, which counts. */
  tags: boolean[] | null;
  spanStart: number;
  spanEnd: number;
}

/** The four measures, noise filter on, tagged once for all 12 questions. */
export function tagMeasures(plays: Scrobble[], zone: string): Record<Measure, Tagged> {
  const first = plays[0].uts;
  const last = plays[plays.length - 1].uts;
  const old = tagScrobbles(plays, "track", 365);
  const fresh = tagDiscovery(plays, 365);
  const clock = zoneClock(zone, first, last);
  const times = plays.map((s) => s.uts);
  return {
    oldfavorites: {
      times: old.tagged.map((t) => t.uts),
      tags: old.tagged.map((t) => t.nostalgic),
      spanStart: old.spanStart,
      spanEnd: old.spanEnd,
    },
    firstlistens: {
      times: fresh.tagged.map((t) => t.uts),
      tags: fresh.tagged.map((t) => t.nostalgic),
      spanStart: fresh.spanStart,
      spanEnd: fresh.spanEnd,
    },
    // After-midnight plays: 0:00 to 3:59 on the listener's clock (6.7).
    aftermidnight: {
      times,
      tags: times.map((t) => Math.floor(((clock.localSeconds(t) % DAY) + DAY) % DAY / 3600) < 4),
      spanStart: first,
      spanEnd: last,
    },
    listening: { times, tags: null, spanStart: first, spanEnd: last },
  };
}

/** FNV-1a of the lowercased username, the question and the version (6.6).
    Neither the zone nor the history is in it. */
export function seedFor(username: string, id: QuestionId): number {
  const s = `${username.toLowerCase()}|${id}|${ANSWERS_VERSION}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The 2,000 rotations' draws for a question, as fractions of the span. */
export function drawsFor(username: string, id: QuestionId): number[] {
  const rng = mulberry32(seedFor(username, id));
  return Array.from({ length: ROTATIONS }, () => rng());
}

function overlapSeconds(windows: ConditionWindow[], S: number, E: number): number {
  let total = 0;
  for (const w of windows) {
    const lo = Math.max(w.start, S);
    const hi = Math.min(w.end, E);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

/** Plays (and tagged plays) inside the windows, by binary search over times. */
function countInside(times: number[], tags: boolean[] | null, windows: { start: number; end: number }[]) {
  let n = 0;
  let tagged = 0;
  let k = 0;
  for (const w of windows) {
    // Windows are sorted and disjoint, so the walk only moves forward.
    let lo = k;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < w.start) lo = mid + 1;
      else hi = mid;
    }
    k = lo;
    while (k < times.length && times[k] <= w.end) {
      n++;
      if (tags?.[k]) tagged++;
      k++;
    }
  }
  return { n, tagged };
}

/** Today's two ratios, unchanged: a share against a share, or plays per day
    against plays per day. NaN when there's nothing to compare. */
function ratio(
  tags: boolean[] | null,
  inN: number,
  inTag: number,
  outN: number,
  outTag: number,
  inSec: number,
  outSec: number,
): number {
  if (tags) {
    const inRate = inN ? inTag / inN : NaN;
    const outRate = outN ? outTag / outN : NaN;
    return inN && outN && outRate > 0 ? inRate / outRate : NaN;
  }
  const inRate = inSec > 0 ? inN / (inSec / DAY) : NaN;
  const outRate = outSec > 0 ? outN / (outSec / DAY) : NaN;
  return inRate > 0 && outRate > 0 ? inRate / outRate : NaN;
}

/** The degrees a retrograde ran between, "from 10°50′ Aries back to 24°37′ Pisces". */
function retrogradePath(body: SkyBody, start: number, end: number): string {
  const at = (t: number) => {
    const lon = longitude(body, new Date(t * 1000));
    const { degree, minute } = degreeInSign(lon);
    return `${degree}°${String(minute).padStart(2, "0")}′ ${signOf(lon)}`;
  };
  return `from ${at(start)} back to ${at(end)}`;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function downsample(xs: number[], max: number): number[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  return Array.from({ length: max }, (_, i) => xs[Math.floor(i * step)]);
}

const fourFigures = (x: number) => Number(x.toPrecision(4));

const blank = (q: Question, rest: Partial<QuestionRecord>): QuestionRecord => ({
  id: q.id,
  status: null,
  notChecked: null,
  index: null,
  p: null,
  matches: 0,
  iterations: 0,
  rangeC: null,
  inPlays: 0,
  events: 0,
  spanStart: 0,
  spanEnd: 0,
  warmupReadyFrom: null,
  merged: [],
  earlyReads: [],
  typicalSingleSwing: null,
  nullSamples: [],
  pairings: [],
  ...rest,
});

/**
 * One question, start to finish: span, observed index, floors, rotations,
 * range and early reads. `draws` are its rotations' fractions (drawsFor).
 */
export function runQuestion(
  q: Question,
  condition: Condition,
  measure: Tagged,
  history: { first: number; last: number },
  draws: number[],
): QuestionRecord {
  const S = measure.spanStart;
  const E = measure.spanEnd;
  const warmupReadyFrom = q.warmupDays > 0 ? history.first + q.warmupDays * DAY : null;

  // The measure's plays inside its span. A measure with a warm-up starts late.
  const startAt = lowerIndex(measure.times, S);
  const endAt = upperIndex(measure.times, E);
  const times = measure.times.slice(startAt, endAt);
  const tags = measure.tags ? measure.tags.slice(startAt, endAt) : null;
  if (times.length === 0 || E <= S) {
    /* A warm-up that runs past the last play is a young history. Anything
       else here (a single play, say) is too little to test, and says so with
       its count, as spec 14 asks. */
    const young = warmupReadyFrom !== null && warmupReadyFrom > history.last;
    const inPlays = young ? 0 : countInside(times, null, condition.windows.filter((w) => w.end >= S && w.start <= E)).n;
    return blank(q, { status: young ? "warming-up" : "too-few-plays", inPlays, spanStart: S, spanEnd: E, warmupReadyFrom });
  }

  const windows = condition.windows.filter((w) => w.end >= S && w.start <= E);
  const inside = countInside(times, tags, windows);
  const totalTag = tags ? tags.reduce((n, t) => n + (t ? 1 : 0), 0) : 0;
  const L = E - S;
  const inSec = overlapSeconds(windows, S, E);
  const index = ratio(
    tags,
    inside.n,
    inside.tagged,
    times.length - inside.n,
    totalTag - inside.tagged,
    inSec,
    Math.max(0, L - inSec),
  );

  /* Events (6.2): an event counts when one of its windows overlaps the span
     and, for a share, holds a play. A window you didn't listen in at all is a
     real observation of how much you listen, so for the rate every one counts. */
  const counted = new Set<number>();
  for (const w of windows) {
    if (counted.has(w.event)) continue;
    if (!tags || countInside(times, null, [w]).n > 0) counted.add(w.event);
  }
  const events = counted.size;
  const merged = groupEvents(windows)
    .filter((g) => g.windows.length > 1 && counted.has(g.event))
    .map(({ start, end, windows: ws }) => ({
      start,
      end,
      windows: ws.map(({ start: a, end: b, sign, aspect, side }) => ({ start: a, end: b, sign, aspect, side })),
    }));

  const base = blank(q, {
    index: Number.isFinite(index) ? index : null,
    inPlays: inside.n,
    events,
    spanStart: S,
    spanEnd: E,
    warmupReadyFrom,
    merged,
  });

  // Floors, plays first, as today (confidence.ts).
  if (inside.n < MIN_RETRO_N) return { ...base, status: "too-few-plays" };
  if (!Number.isFinite(index)) return { ...base, status: "no-comparison" };

  // The rotations.
  const c = circle(times, tags, S, L);
  const placed = windows.map((w) => place(w.start, w.end, S, L));
  const outSec = Math.max(1, L - inSec);
  const observed = Math.abs(Math.log(index));
  const sims: number[] = [];
  const logs: number[] = [];
  let matches = 0;
  const hit: [number, number] = [0, 0];
  for (const u of draws) {
    const o = offsetOf(u, L);
    let inN = 0;
    let inTag = 0;
    for (const pw of placed) {
      if (!pw) continue;
      countRotated(c, pw[0], pw[1], o, hit);
      inN += hit[0];
      inTag += hit[1];
    }
    const outN = c.n - inN;
    let sim: number;
    if (tags) {
      // No plays on one side: this rotation has nothing to compare.
      if (!inN || !outN) continue;
      const outTag = totalTag - inTag;
      sim = outTag ? inTag / inN / (outTag / outN) : Infinity;
    } else {
      if (inSec <= 0) break;
      sim = outN ? inN / (inSec / DAY) / (outN / (outSec / DAY)) : Infinity;
    }
    const lg = Math.abs(Math.log(sim));
    logs.push(lg);
    if (Number.isFinite(sim)) sims.push(sim);
    if (lg >= observed) matches++;
  }
  const iterations = logs.length;
  const p = permutationP(matches, iterations);
  if (!Number.isFinite(p)) return { ...base, status: "no-comparison" };

  const rangeC = rangeHalfWidth(logs);

  const tested = {
    ...base,
    p,
    matches,
    iterations,
    rangeC: Number.isFinite(rangeC) ? rangeC : null,
    nullSamples: downsample(sims, MAX_NULL_SAMPLES).map(fourFigures),
  };
  if (events >= MIN_EVENTS) return { ...tested, status: "tested" };

  return {
    ...tested,
    status: "too-few-events",
    rangeC: null,
    ...earlyReads(q, condition, windows, counted, { times, tags, totalTag, S, E, inSec, history, c, draws }),
  };
}

/**
 * Spec 6.4's c, from the rotations' |log index| values: the K-th largest,
 * counting the largest as the first, where K = ceil(0.05 x (R + 1)) - 1. With
 * R = 2,000 that's the 100th largest. The range then excludes zero exactly
 * when the observed |log index| is above c, which is when p < 0.05: above c
 * means at most K - 1 rotations matched it, and p = (matches + 1) / (R + 1).
 * Below 19 rotations no p can be under 0.05, so c is infinite.
 */
export function rangeHalfWidth(absLogs: number[]): number {
  const K = Math.ceil(0.05 * (absLogs.length + 1)) - 1;
  if (K < 1) return Infinity;
  const sorted = [...absLogs].sort((a, b) => b - a);
  return sorted[K - 1];
}

function lowerIndex(a: number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperIndex(a: number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function groupEvents(windows: ConditionWindow[]) {
  const groups: { event: number; start: number; end: number; windows: ConditionWindow[] }[] = [];
  for (const w of windows) {
    const g = groups[groups.length - 1];
    if (g && g.event === w.event) {
      g.windows.push(w);
      g.end = w.end;
    } else {
      groups.push({ event: w.event, start: w.start, end: w.end, windows: [w] });
    }
  }
  return groups;
}

/**
 * Spec 6.5, for a question below the event floor: each event on its own, and
 * how much one stretch that long swings by chance, from the same rotations.
 */
function earlyReads(
  q: Question,
  condition: Condition,
  windowsInSpan: ConditionWindow[],
  counted: Set<number>,
  ctx: {
    times: number[];
    tags: boolean[] | null;
    totalTag: number;
    S: number;
    E: number;
    inSec: number;
    history: { first: number; last: number };
    c: Circle;
    draws: number[];
  },
): { earlyReads: EarlyRead[]; typicalSingleSwing: number | null } {
  const { times, tags, totalTag, S, E, inSec, history, c, draws } = ctx;
  const L = E - S;
  // Everything outside the windows, for each event's comparison.
  const all = countInside(times, tags, windowsInSpan);
  const outN = times.length - all.n;
  const outTag = totalTag - all.tagged;
  const outSec = Math.max(0, L - inSec);

  // Events that happened while there was a history, the first year included.
  const lived = groupEvents(condition.windows.filter((w) => w.end >= history.first && w.start <= history.last));
  const rows: EarlyRead[] = lived.map((g) => {
    const firstYear = g.end < S;
    const inSpan = g.windows.filter((w) => w.end >= S && w.start <= E);
    let swing: number | null = null;
    if (!firstYear && inSpan.length > 0) {
      const own = countInside(times, tags, inSpan);
      const r = ratio(tags, own.n, own.tagged, outN, outTag, overlapSeconds(inSpan, S, E), outSec);
      swing = Number.isFinite(r) ? r - 1 : null;
    }
    return {
      start: g.start,
      end: g.end,
      swing,
      inProgress: g.end > history.last,
      firstYear,
      path:
        condition.kind === "retrograde" && condition.body ? retrogradePath(condition.body, g.start, g.end) : null,
    };
  });

  /* One stretch on its own: each counted event's windows, rotated to every
     drawn position, against everything outside all the windows at that
     rotation. Positions where it holds no plays are skipped. An event still
     going when the history ends is clipped short, so it's left out of "this
     long" unless it's the only one. */
  const lastEnd = new Map<number, number>();
  for (const w of windowsInSpan) lastEnd.set(w.event, Math.max(lastEnd.get(w.event) ?? 0, w.end));
  const finished = [...counted].filter((e) => (lastEnd.get(e) ?? 0) <= E);
  const pooled = new Set(finished.length > 0 ? finished : counted);
  const placedAll = windowsInSpan.map((w) => place(w.start, w.end, S, L));
  const swings: number[] = [];
  const hit: [number, number] = [0, 0];
  for (const u of draws) {
    const o = offsetOf(u, L);
    let allN = 0;
    let allTag = 0;
    const perEvent = new Map<number, [number, number, number]>();
    windowsInSpan.forEach((w, i) => {
      const pw = placedAll[i];
      if (!pw) return;
      countRotated(c, pw[0], pw[1], o, hit);
      allN += hit[0];
      allTag += hit[1];
      if (!pooled.has(w.event)) return;
      const acc = perEvent.get(w.event) ?? [0, 0, 0];
      acc[0] += hit[0];
      acc[1] += hit[1];
      acc[2] += pw[1] - pw[0];
      perEvent.set(w.event, acc);
    });
    const restN = c.n - allN;
    const restTag = totalTag - allTag;
    for (const [n, tg, sec] of perEvent.values()) {
      if (n === 0) continue;
      const r = ratio(tags, n, tg, restN, restTag, sec, outSec);
      if (Number.isFinite(r)) swings.push(r - 1);
    }
  }
  const typical = typicalSwingOf(swings);
  return { earlyReads: rows, typicalSingleSwing: typical === null ? null : fourFigures(typical) };
}

/** Spec 6.5: the larger of the 5th and 95th percentiles of one stretch's
    swings, in absolute terms (nearest rank). Null with none. */
export function typicalSwingOf(swings: number[]): number | null {
  if (swings.length === 0) return null;
  const sorted = [...swings].sort((a, b) => a - b);
  return Math.max(Math.abs(percentile(sorted, 0.05)), Math.abs(percentile(sorted, 0.95)));
}

/**
 * The nights NASA logged for question 7 or 8, in the listener's zone, among
 * the nights `first` to `last`: every night a storm's Kp reading overlaps
 * (`readingSpan`), or the night of each X-class flare's peak (7.3).
 */
export function nasaNights(id: "storms" | "flares", log: NasaLog, clock: ZoneClock, first: number, last: number): number[] {
  const nights: number[] = [];
  const keep = (n: number) => {
    if (n >= first && n <= last) nights.push(n);
  };
  if (id === "storms") {
    for (const [start, end] of log.kp) {
      for (let n = clock.nightOf(start); n <= clock.nightOf(Math.max(start, end - 1)); n++) keep(n);
    }
  } else {
    for (const [peak] of log.xflares) keep(clock.nightOf(peak));
  }
  return nights;
}

/**
 * The whole nights inside NASA's coverage for question 7 or 8: from the log's
 * start to `coveredUntil` (3 days before its refresh, since DONKI logs
 * late), within the measure's own span. A night only partly covered is left
 * out, since part of it isn't logged yet. Null when no whole night is.
 */
export function nasaSpan(
  id: "storms" | "flares",
  log: NasaLog,
  clock: ZoneClock,
  span: { spanStart: number; spanEnd: number },
): { first: number; last: number; spanStart: number; spanEnd: number } | null {
  const from = Math.max(span.spanStart, id === "storms" ? log.stormsFrom : log.flaresFrom);
  const to = Math.min(span.spanEnd, log.coveredUntil);
  let first = clock.nightOf(from);
  if (clock.nightStart(first) < from) first++;
  let last = clock.nightOf(to);
  if (clock.nightStart(last + 1) - 1 > to) last--;
  if (last < first) return null;
  return { first, last, spanStart: clock.nightStart(first), spanEnd: clock.nightStart(last + 1) - 1 };
}

/**
 * All 12 for a listener's stored history in one zone. Questions 7 and 8 need
 * NASA's log (`nasa`); without it they're "not checked" (spec 6.6), and they
 * test only nights inside its coverage, ending 3 days before its last
 * refresh. A question that throws is "not checked" too, and the record is
 * marked incomplete so the next request tries again; the other 11 stand.
 */
export function computeAnswers(
  username: string,
  stored: Scrobble[],
  zone: string,
  now = Date.now(),
  nasa: NasaLog | null = null,
): AnswerRecord {
  const plays = stored.filter((s) => !isNoiseArtist(s.artist));
  const kept = plays.length > 0 ? plays : stored;
  const record: AnswerRecord = {
    version: ANSWERS_VERSION,
    format: RECORD_FORMAT,
    zone,
    stamp: historyStamp(stored),
    nasaStamp: nasa?.stamp ?? null,
    computedAt: now,
    plays: kept.length,
    historyStart: kept[0]?.uts ?? 0,
    historyEnd: kept[kept.length - 1]?.uts ?? 0,
    incomplete: false,
    questions: [],
  };
  if (kept.length === 0) {
    record.questions = QUESTIONS.map((q) =>
      blank(q, q.nasa ? { notChecked: "nasa" } : { status: "too-few-plays" }),
    );
    return record;
  }
  const measures = tagMeasures(kept, zone);
  const history = { first: record.historyStart, last: record.historyEnd };
  const clock = zoneClock(zone, history.first, history.last);
  // Songs whose first play is news: listed (7.5), and not from the first 90 days.
  const songs = selectSongs(songsOf(kept), kept[0].uts).listed.filter((s) => !s.early);
  const pairingsOf = (condition: Condition) =>
    songs.filter((s) => condition.windows.some((w) => s.firstPlayUts >= w.start && s.firstPlayUts <= w.end)).map((s) => s.songId);
  record.questions = QUESTIONS.map((q) => {
    if (q.nasa && !nasa) return blank(q, { notChecked: "nasa" });
    try {
      if (q.nasa) {
        const id = q.id as "storms" | "flares";
        const measure = measures[q.measure];
        // Inside NASA's coverage only: before its log starts a night is
        // unknown, and its last 3 days aren't logged yet (6.1, 7.3). The
        // nights come from that span alone, so no early read shows one
        // outside it.
        const covered = nasaSpan(id, nasa!, clock, measure);
        const span = covered
          ? { ...measure, spanStart: covered.spanStart, spanEnd: covered.spanEnd }
          : { ...measure, spanEnd: measure.spanStart };
        const nights = covered ? nasaNights(id, nasa!, clock, covered.first, covered.last) : [];
        const condition = nightsCondition(nights, clock);
        return { ...runQuestion(q, condition, span, history, drawsFor(username, q.id)), pairings: pairingsOf(condition) };
      }
      const condition = conditionFor(q.id)!;
      return { ...runQuestion(q, condition, measures[q.measure], history, drawsFor(username, q.id)), pairings: pairingsOf(condition) };
    } catch (err) {
      console.error(`[retrospect] question ${q.id} failed:`, err);
      record.incomplete = true;
      return blank(q, { notChecked: "error" });
    }
  });
  return record;
}
