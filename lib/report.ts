import { type NostalgiaLevel, type Verdict, computeIndex, permutationTest } from "./analysis/nostalgia";
import {
  METRICS,
  metricVerdict,
  tagForMetric,
  volumeIndex,
  volumePermutationTest,
  type MetricKey,
} from "./analysis/metrics";
import { mulberry32 } from "./analysis/rng";
import { makeInWindow, type ZodiacSign } from "./ephemeris/retrogrades";
import { getPhenomenon, type PhenomenonKey } from "./ephemeris/phenomena";
import { getStore } from "./store/jsonStore";

/** Below this many in-window scrobbles we refuse to issue a verdict. */
const MIN_RETRO_N = 500;
const PERMUTATIONS = 2000;
/** Cap the null-distribution samples sent to the client. */
const MAX_SAMPLES = 600;

export interface ReportOptions {
  /** Metric knob: nostalgia threshold / old-flame gap, in days. Ignored by knob-less metrics. */
  thresholdDays: number;
  level: NostalgiaLevel;
  /** Which sky phenomenon to put on trial. Default: mercury. */
  body?: PhenomenonKey;
  /** Override the phenomenon's classic metric — any metric × any sky. */
  metric?: MetricKey;
  /** Minutes east of UTC for the user's clock (night-owl metric). Default 0. */
  tzOffsetMinutes?: number;
  /** Optional inclusive month range, "YYYY-MM" (defaults to full history). */
  fromMonth?: string;
  toMonth?: string;
  /** Drop sleep/ambient-noise "artists" (rain sounds, white noise, ASMR…). */
  excludeNoise?: boolean;
}

/**
 * Sleep-noise detector. Scrobblers faithfully log eight hours of "Rolling
 * Thunder — Nature Sounds.ca" every night, which buries actual music taste
 * under a monsoon. Artist-name heuristic; intentionally conservative.
 */
const NOISE_RE =
  /\b(white noise|brown noise|pink noise|nature sounds?|rain sounds?|sleep sounds?|ocean sounds?|asmr|binaural|noise machine|sounds? for sleep|sleep(y)? (noise|sounds?|music)|meditation sounds?)\b/i;
export const isNoiseArtist = (artist: string) =>
  NOISE_RE.test(artist) || /\bsounds?\b.*\.(ca|com|net|org)\b/i.test(artist);

export interface Report {
  username: string;
  thresholdDays: number;
  level: NostalgiaLevel;
  body: PhenomenonKey;
  /** The metric this phenomenon was tried on. */
  metric: MetricKey;
  fromMonth: string | null;
  toMonth: string | null;
  /** Full-history bounds, for the range picker (unaffected by the filter). */
  historyStartYear: number;
  historyEndYear: number;
  scrobbleCount: number;
  /** How many scrobbles the noise filter removed (0 when filter is off). */
  noiseRemoved: number;
  firstScrobbleUts: number;
  lastScrobbleUts: number;
  /** Event windows overlapping the analyzed span. */
  windowCount: number;
  index: number;
  /** share metrics: fraction of plays tagged; rate metric: plays per day. */
  retroRate: number;
  directRate: number;
  retroN: number;
  directN: number;
  p: number;
  iterations: number;
  nullSamples: number[];
  verdict: Verdict;
  windows: { start: string; end: string }[];
  yearlyCounts: { year: number; count: number }[];
  /** The track you played most inside the phenomenon's windows. */
  retroAnthem: { artist: string; track: string; plays: number } | null;
  /** The single day with the most metric-tagged plays. */
  mostNostalgicDay: { date: string; count: number } | null;
  /** Index split by the zodiac sign of each event, sorted most-affected first. */
  bySign: { sign: ZodiacSign; index: number; retroN: number; windows: number }[];
}

const cache = new Map<string, { newestUts: number; report: Report }>();

export async function buildReport(
  username: string,
  opts: ReportOptions
): Promise<Report | null> {
  const { thresholdDays, level, fromMonth, toMonth, excludeNoise } = opts;
  const phen = getPhenomenon(opts.body ?? "mercury")!;
  const metric = METRICS[opts.metric ?? phen.metric];
  const tzOffsetMinutes = opts.tzOffsetMinutes ?? 0;
  const store = getStore();
  let all = await store.getScrobbles(username);
  if (all.length === 0) return null;

  let noiseRemoved = 0;
  if (excludeNoise) {
    const kept = all.filter((s) => !isNoiseArtist(s.artist));
    noiseRemoved = all.length - kept.length;
    if (kept.length > 0) all = kept;
  }

  const newestUts = all[all.length - 1].uts;
  const historyStartYear = new Date(all[0].uts * 1000).getUTCFullYear();
  const historyEndYear = new Date(newestUts * 1000).getUTCFullYear();

  // tz always participates: night-owl tagging AND peak-day bucketing use it.
  const cacheKey = `${username.toLowerCase()}|${phen.key}|${metric.key}|${thresholdDays}|${level}|${fromMonth ?? ""}|${toMonth ?? ""}|${excludeNoise ? "nn" : ""}|${tzOffsetMinutes}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.newestUts === newestUts) return hit.report;

  // Range filter in unix seconds. First-listen/last-play state is always
  // judged against the FULL history — a 2013 track is still "old" in a
  // 2018–2022 window.
  const parseMonth = (m: string | undefined, endOfMonth: boolean): number => {
    if (!m) return endOfMonth ? Infinity : -Infinity;
    const [y, mo] = m.split("-").map(Number);
    return Date.UTC(y, endOfMonth ? mo : mo - 1, 1) / 1000; // end: first instant AFTER the month
  };
  const rangeStart = parseMonth(fromMonth, false);
  const rangeEnd = parseMonth(toMonth, true);
  const inRange = (uts: number) => uts >= rangeStart && uts < rangeEnd;

  const scoped = all.filter((s) => inRange(s.uts));
  if (scoped.length === 0) return null;

  /* ---- Metric dispatch: share metrics tag plays; intensity counts them ---- */
  let result: { index: number; retroRate: number; directRate: number; retroN: number; directN: number };
  let test: { p: number; iterations: number; samples: number[] };
  let spanStart: number;
  let spanEnd: number;
  let taggedInRange: { uts: number; nostalgic: boolean }[];

  if (metric.kind === "share") {
    const full = tagForMetric(metric.key, all, { thresholdDays, level, tzOffsetMinutes });
    taggedInRange = full.tagged.filter((s) => inRange(s.uts));
    spanStart = Math.max(full.spanStart, rangeStart);
    spanEnd = Math.min(full.spanEnd, rangeEnd);
    if (taggedInRange.length === 0) return null;
    result = computeIndex(taggedInRange, phen.bounds);
    test = permutationTest(
      taggedInRange,
      phen.bounds,
      spanStart,
      spanEnd,
      result.index,
      PERMUTATIONS,
      mulberry32(hashCode(cacheKey)) // seeded per-report: stable between visits
    );
  } else {
    spanStart = scoped[0].uts;
    spanEnd = scoped[scoped.length - 1].uts;
    const times = scoped.map((s) => s.uts);
    // For intensity, "tagged" = every play (used by peak-day + sign breakdown).
    taggedInRange = times.map((uts) => ({ uts, nostalgic: true }));
    result = volumeIndex(times, phen.bounds, spanStart, spanEnd);
    test = volumePermutationTest(
      times,
      phen.bounds,
      spanStart,
      spanEnd,
      result.index,
      PERMUTATIONS,
      mulberry32(hashCode(cacheKey))
    );
  }

  // Yearly volume (scoped).
  const yearly = new Map<number, number>();
  for (const s of scoped) {
    const year = new Date(s.uts * 1000).getUTCFullYear();
    yearly.set(year, (yearly.get(year) ?? 0) + 1);
  }

  // Anthem: most-played track inside the phenomenon's windows (scoped).
  const inWindow = makeInWindow(phen.bounds);
  const anthemCounts = new Map<string, { artist: string; track: string; plays: number }>();
  for (const s of scoped) {
    if (!inWindow(s.uts)) continue;
    const key = `${s.artist} ${s.track}`.toLowerCase();
    const entry = anthemCounts.get(key);
    if (entry) entry.plays++;
    else anthemCounts.set(key, { artist: s.artist, track: s.track, plays: 1 });
  }
  let retroAnthem: Report["retroAnthem"] = null;
  for (const entry of anthemCounts.values()) {
    if (!retroAnthem || entry.plays > retroAnthem.plays) retroAnthem = entry;
  }

  // Peak day: most metric-tagged plays in a single day — bucketed in the
  // USER'S timezone. A Chicago evening belongs to Chicago's date, not London's.
  const tzShiftSec = tzOffsetMinutes * 60;
  const dayCounts = new Map<string, number>();
  for (const s of taggedInRange) {
    if (!s.nostalgic) continue;
    const date = new Date((s.uts + tzShiftSec) * 1000).toISOString().slice(0, 10);
    dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
  }
  let mostNostalgicDay: Report["mostNostalgicDay"] = null;
  for (const [date, count] of dayCounts) {
    if (!mostNostalgicDay || count > mostNostalgicDay.count) {
      mostNostalgicDay = { date, count };
    }
  }

  const windowCount = phen.bounds.filter(([a, b]) => b >= spanStart && a <= spanEnd).length;

  // Per-sign breakdown: this sign's windows vs. everywhere-outside baseline.
  const signBounds = new Map<ZodiacSign, [number, number][]>();
  for (const w of phen.windows) {
    const a = Date.parse(w.start) / 1000;
    const b = Date.parse(w.end) / 1000;
    if (b < spanStart || a > spanEnd) continue;
    const list = signBounds.get(w.sign) ?? [];
    list.push([a, b]);
    signBounds.set(w.sign, list);
  }
  const bySign: Report["bySign"] = [];
  if (metric.kind === "share") {
    let directN = 0;
    let directNost = 0;
    for (const s of taggedInRange) {
      if (!inWindow(s.uts)) {
        directN++;
        if (s.nostalgic) directNost++;
      }
    }
    const directRateAll = directN ? directNost / directN : NaN;
    for (const [sign, bounds] of signBounds) {
      const inThisSign = makeInWindow(bounds.sort((x, y) => x[0] - y[0]));
      let n = 0;
      let nost = 0;
      for (const s of taggedInRange) {
        if (inThisSign(s.uts)) {
          n++;
          if (s.nostalgic) nost++;
        }
      }
      if (n < 200 || !Number.isFinite(directRateAll) || directRateAll <= 0) continue;
      bySign.push({ sign, index: nost / n / directRateAll, retroN: n, windows: bounds.length });
    }
  } else {
    // Intensity: plays/day in this sign's windows vs. plays/day outside all windows.
    const times = scoped.map((s) => s.uts);
    const base = volumeIndex(times, phen.bounds, spanStart, spanEnd);
    for (const [sign, bounds] of signBounds) {
      const sorted = bounds.sort((x, y) => x[0] - y[0]);
      const sub = volumeIndex(times, sorted, spanStart, spanEnd);
      if (sub.retroN < 200 || !Number.isFinite(base.directRate) || base.directRate <= 0) continue;
      bySign.push({
        sign,
        index: sub.retroRate / base.directRate,
        retroN: sub.retroN,
        windows: sorted.length,
      });
    }
  }
  bySign.sort((a, b) => Math.abs(Math.log(b.index)) - Math.abs(Math.log(a.index)));

  const report: Report = {
    username,
    thresholdDays,
    level,
    body: phen.key,
    metric: metric.key,
    fromMonth: fromMonth ?? null,
    toMonth: toMonth ?? null,
    historyStartYear,
    historyEndYear,
    scrobbleCount: scoped.length,
    noiseRemoved,
    firstScrobbleUts: scoped[0].uts,
    lastScrobbleUts: scoped[scoped.length - 1].uts,
    windowCount,
    ...result,
    p: test.p,
    iterations: test.iterations,
    nullSamples: downsample(test.samples, MAX_SAMPLES),
    verdict: metricVerdict(metric, result.index, test.p, result.retroN >= MIN_RETRO_N, {
      name: phen.subjectName,
      when: phen.when,
      plural: phen.subjectPlural,
    }),
    windows: phen.windows,
    yearlyCounts: [...yearly.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    retroAnthem,
    mostNostalgicDay,
    bySign,
  };
  cache.set(cacheKey, { newestUts, report });
  return report;
}

function downsample(xs: number[], max: number): number[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  return out;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
