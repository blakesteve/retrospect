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
import { TOO_SOON_HEADLINE, warmupExplanation, type Warmup } from "./readiness";
import { countEvents } from "./analysis/confidence";
import { isNoiseArtist } from "./noise";

const DAY = 86400;
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

// The noise filter lives in noise.ts; the profile and genre routes and
// genres.ts still import it from here.
export { isNoiseArtist };

export interface Report {
  username: string;
  thresholdDays: number;
  level: NostalgiaLevel;
  body: PhenomenonKey;
  /** The metric this phenomenon was tried on. */
  metric: MetricKey;
  /**
   * Whether the trial had anything to test.
   *
   * "ran": it did. Its verdict can still be withheld, for too few plays or
   * too few separate events; `verdict.status` says which, and is what tells
   * an untested trial from a tested, unremarkable one.
   *
   * "warming-up": nothing to test, because every play in the requested span
   * sits inside this measure's warm-up (see `warmup`). The trial's own
   * numbers are empty: index, rates and p are NaN (null over JSON), the plays
   * inside and outside the windows are 0, and there are no null samples, peak
   * day or sign breakdown. The history-wide parts are filled in as usual.
   */
  trialStatus: "ran" | "warming-up";
  /** Set when trialStatus is "warming-up", null when it ran. */
  warmup: Warmup | null;
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
  /** Event windows overlapping your listening in the requested span, from
      its first play to its last, including windows only partly inside it.
      The same on every path: "happened N times on you" means this. */
  windowCount: number;
  /** Plays inside those windows, across the same span: what "N songs played
      when Mercury is retrograde" counts. The trial itself may test fewer
      (`retroN`), because a measure's warm-up drops the start of a history. */
  windowPlays: number;
  /** The separate events the trial's verdict rests on: windows inside the
      tested span that hold some of its plays (see countEvents). 0 when
      warming up. Below MIN_EVENTS there is no verdict. */
  eventsTested: number;
  index: number;
  /** share metrics: fraction of plays tagged; rate metric: plays per day. */
  retroRate: number;
  directRate: number;
  retroN: number;
  directN: number;
  /** (matches + 1) / (iterations + 1): never 0. See permutationP. */
  p: number;
  /** Shuffled calendars that matched or beat the real swing, either way. */
  matches: number;
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

/**
 * What a report request gets back. "No data at all" and "too young to test"
 * are different answers: the first is an empty outcome, the second is a
 * report whose `trialStatus` is "warming-up".
 */
export type ReportOutcome =
  | { kind: "report"; report: Report }
  /** Nothing stored for this user: not synced yet, or synced and empty. */
  | { kind: "no-scrobbles" }
  /** The history exists, but none of it falls inside the requested era. */
  | { kind: "empty-era" };

/* Keyed on what the history holds, not only its newest play. Backfill reads
   newest to oldest, so the newest play is fixed from the first page while
   older ones keep arriving; a report built part-way through (a link unfurl
   can ask for one) would otherwise be served after the sync finished. For a
   young history that is "Too soon to tell." on a ten-year history. */
const cache = new Map<string, { stamp: string; report: Report }>();

export async function buildReport(
  username: string,
  opts: ReportOptions
): Promise<ReportOutcome> {
  const { thresholdDays, level, fromMonth, toMonth, excludeNoise } = opts;
  const phen = getPhenomenon(opts.body ?? "mercury")!;
  const metric = METRICS[opts.metric ?? phen.metric];
  const tzOffsetMinutes = opts.tzOffsetMinutes ?? 0;
  const store = getStore();
  let all = await store.getScrobbles(username);
  if (all.length === 0) return { kind: "no-scrobbles" };

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
  const stamp = `${all.length}|${all[0].uts}|${newestUts}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.stamp === stamp) return { kind: "report", report: hit.report };

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
  if (scoped.length === 0) return { kind: "empty-era" };

  /* ---- History-wide parts: none of these depend on a metric's warm-up ---- */

  // Yearly volume (scoped).
  const yearly = new Map<number, number>();
  for (const s of scoped) {
    const year = new Date(s.uts * 1000).getUTCFullYear();
    yearly.set(year, (yearly.get(year) ?? 0) + 1);
  }

  // Anthem: most-played track inside the phenomenon's windows (scoped).
  const inWindow = makeInWindow(phen.bounds);
  const anthemCounts = new Map<string, { artist: string; track: string; plays: number }>();
  let windowPlays = 0;
  for (const s of scoped) {
    if (!inWindow(s.uts)) continue;
    windowPlays++;
    const key = `${s.artist} ${s.track}`.toLowerCase();
    const entry = anthemCounts.get(key);
    if (entry) entry.plays++;
    else anthemCounts.set(key, { artist: s.artist, track: s.track, plays: 1 });
  }
  let retroAnthem: Report["retroAnthem"] = null;
  for (const entry of anthemCounts.values()) {
    if (!retroAnthem || entry.plays > retroAnthem.plays) retroAnthem = entry;
  }

  /* One definition of "the windows that happened to you", for every path:
     those overlapping your listening in the requested span. It used to be
     the tested span on a normal trial and this span on a young one, while the
     reveal and step 2 both said "your history"; a 12-month history read
     "happened 0 times on you" beside a 7-play anthem from those windows. */
  const firstScoped = scoped[0].uts;
  const lastScoped = scoped[scoped.length - 1].uts;
  const windowCount = phen.bounds.filter(([a, b]) => b >= firstScoped && a <= lastScoped).length;

  const historyWide = {
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
    windows: phen.windows,
    windowCount,
    windowPlays,
    yearlyCounts: [...yearly.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    retroAnthem,
  };

  /* ---- Metric dispatch: share metrics tag plays; intensity counts them ---- */
  let result: { index: number; retroRate: number; directRate: number; retroN: number; directN: number };
  let test: { p: number; matches: number; iterations: number; samples: number[] };
  let spanStart: number;
  let spanEnd: number;
  let taggedInRange: { uts: number; nostalgic: boolean }[];

  if (metric.kind === "share") {
    const full = tagForMetric(metric.key, all, { thresholdDays, level, tzOffsetMinutes });
    taggedInRange = full.tagged.filter((s) => inRange(s.uts));
    spanStart = Math.max(full.spanStart, rangeStart);
    spanEnd = Math.min(full.spanEnd, rangeEnd);
    if (taggedInRange.length === 0) {
      /* Every play in the requested span sits inside this measure's warm-up,
         so there is nothing to test. This used to return null, which the route
         reported as "No scrobbles synced yet" and the page as an error screen
         asking whether the username was right, for every history under a year
         old. The history-wide parts above don't need the warm-up, so the
         report still carries them and the page renders everything that works.

         `full.tagged` holds every post-warm-up play in the whole history, so
         when it is empty the history itself is too young; when it isn't, the
         requested era is what ends before the warm-up does. */
      const warmup: Warmup = {
        reason: full.tagged.length === 0 ? "young-history" : "era-in-warmup",
        days: Math.round((full.spanStart - all[0].uts) / DAY),
        historyStartUts: all[0].uts,
        readyFromUts: full.spanStart,
      };
      const report: Report = {
        ...historyWide,
        trialStatus: "warming-up",
        warmup,
        eventsTested: 0,
        index: NaN,
        retroRate: NaN,
        directRate: NaN,
        retroN: 0,
        directN: 0,
        p: NaN,
        matches: 0,
        iterations: 0,
        nullSamples: [],
        verdict: {
          headline: TOO_SOON_HEADLINE,
          detail: warmupExplanation(metric.key, warmup, phen.when),
          significant: false,
          status: "warming-up",
        },
        mostNostalgicDay: null,
        bySign: [],
      };
      cache.set(cacheKey, { stamp, report });
      return { kind: "report", report };
    }
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

  const eventsTested = countEvents(
    phen.bounds,
    spanStart,
    spanEnd,
    taggedInRange.map((s) => s.uts),
    metric.kind === "rate",
  );

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
    ...historyWide,
    trialStatus: "ran",
    warmup: null,
    eventsTested,
    ...result,
    p: test.p,
    matches: test.matches,
    iterations: test.iterations,
    nullSamples: downsample(test.samples, MAX_SAMPLES),
    verdict: metricVerdict(
      metric,
      result.index,
      test.p,
      { retroN: result.retroN, events: eventsTested },
      {
        name: phen.subjectName,
        when: phen.when,
        plural: phen.subjectPlural,
        eventNoun: phen.eventNoun,
        cadence: phen.cadence,
      },
    ),
    mostNostalgicDay,
    bySign,
  };
  cache.set(cacheKey, { stamp, report });
  return { kind: "report", report };
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
