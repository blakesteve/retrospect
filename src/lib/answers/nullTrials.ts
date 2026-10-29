import { mulberry32 } from "@/lib/analysis/rng";
import { nasaLogFrom, type DonkiCompact } from "@/lib/space/compact";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { conditionFor } from "./conditions";
import { computeAnswers } from "./engine";
import donki from "./testdata/donki-compact.json";
import { QUESTIONS, questionById, type QuestionId } from "./questions";
import { synthHistory, synthSpan } from "./synthHistory";
import { answerWords } from "./words";

/**
 * The null-data test (spec 6.3, ClickUp 86e3fycx8): histories with no sky
 * effect, the 12 run on each exactly as the endpoint runs them, words by the
 * spec's rule. If the sky does nothing, a Yes is a false one, and the share of
 * histories with any Yes is what the correction is there to hold down.
 *
 * Benjamini-Hochberg at 10% flags something about 10% of the time when nothing
 * is there, so the bounds carry a margin (architect, 30 Sept): at most 13% of
 * 1,000 histories (10% plus about three standard deviations), run by
 * `npm run null-test`, and at most 19% of the 100 quick ones in the suite.
 *
 * Questions 7 and 8 run against NASA's real storm and flare log, as DONKI
 * had it on 1 Oct 2026 (`testdata/donki-compact.json`, from `npm run space`;
 * its storms' starts were added 3 Oct 2026, the readings unchanged), so all
 * 12 are in the count.
 */

export const NASA_FIXTURE = nasaLogFrom(donki as unknown as DonkiCompact)!;
if (!NASA_FIXTURE) throw new Error("testdata/donki-compact.json isn't a whole log");

export interface NullTrial {
  k: number;
  plays: number;
  startYear: number;
  /** Questions tested. */
  m: number;
  tested: QuestionId[];
  /** Tested with p under 0.05: what an uncorrected rule would call real. */
  lowP: QuestionId[];
  /** Yes by the spec's rule. */
  yes: QuestionId[];
  /** Couldn't be computed (the engine caught it throwing): never part of a passing run. */
  errored: QuestionId[];
}

/** The k-th null history, seeded by k: full histories run from 2006 to
    2022 starts with 5,000 to 80,000 plays; quick ones are young and light, so
    the suite can afford 100 of them. */
export function nullHistory(k: number, quick: boolean) {
  const rng = mulberry32(0x9e3779b9 ^ (k * 2654435761));
  const startYear = quick ? 2021 + Math.floor(rng() * 2) : 2006 + Math.floor(rng() * 17);
  const plays = quick
    ? 3_000 + Math.floor(rng() * 3_000)
    : Math.round(Math.exp(Math.log(5_000) + rng() * Math.log(80_000 / 5_000)));
  return { startYear, plays, history: synthHistory(plays, 50_000 + k, startYear) };
}

export function nullTrial(k: number, quick = false): NullTrial {
  const { startYear, plays, history } = nullHistory(k, quick);
  return { k, plays, startYear, ...judge(`null-${k}`, history).trial };
}

/** The 12 run on a history as the endpoint runs them, and the words by the spec's rule. */
function judge(name: string, history: Scrobble[]) {
  const record = computeAnswers(name, history, "America/Chicago", Date.now(), NASA_FIXTURE);
  const ps = record.questions.map((q) => (q.status === "tested" ? q.p : null));
  const { m, words } = answerWords(ps);
  const ids = (pick: (i: number) => boolean) => QUESTIONS.flatMap((q, i) => (pick(i) ? [q.id] : []));
  return {
    record,
    words,
    trial: {
      m,
      tested: ids((i) => ps[i] !== null),
      lowP: ids((i) => ps[i] !== null && ps[i]! < 0.05),
      yes: ids((i) => words[i] === "Yes"),
      errored: ids((i) => record.questions[i].notChecked === "error"),
    },
  };
}

const DAY = 86_400;
/** Where every made-up history ends: `synthHistory`'s last day, 30 Sept 2026. */
const END = Date.UTC(2026, 8, 30) / 1000;

/**
 * Young histories, in length bands (28 Oct 2026, ClickUp 86e3m6dgn): the
 * 1,000 above all run about four years or more, so a young history's
 * false-Yes rate went unmeasured. Each band ends where a group of questions
 * first clears its floors (6.1: 500 plays in its windows, then 6 events,
 * after any warm-up), so each is a different mix of questions tested:
 *
 * - 3 to 6 months: the full moon's sixth (about 5 months in), and NASA's
 *   storms and flares when the history is heavy.
 * - 6 to 12 months: the same, more often; the warm-up questions can't start.
 * - 1 to 2 years: the strong Moon (about 1.25 years) and the new moon (1.4)
 *   join, after their year of warm-up.
 * - 2 to 4¾ years: Mercury (2.9), Venus at home (2.9), Venus with Mars and
 *   Venus in detriment (3.2) and Mars in water (3.5), up to where the 1,000
 *   begin (1 Jan 2022). Venus and Mars retrograde need about 15 years.
 *
 * Every history ends 30 Sept 2026, as a young listener's history ends now,
 * so each band is its listeners against one stretch of sky.
 */
export interface Band {
  id: string;
  label: string;
  minDays: number;
  maxDays: number;
}
export const BANDS: Band[] = [
  { id: "2-4.75y", label: "2 to 4¾ years", minDays: 730, maxDays: 1733 },
  { id: "1-2y", label: "1 to 2 years", minDays: 365, maxDays: 730 },
  { id: "6-12m", label: "6 to 12 months", minDays: 182, maxDays: 365 },
  { id: "3-6m", label: "3 to 6 months", minDays: 91, maxDays: 182 },
];

/** The k-th history of band b: a length drawn evenly across the band, ending
    30 Sept 2026, by a listener of 10 to 120 plays a day (evenly on a log
    scale: light to past Blake's own 80). */
export function bandHistory(b: number, k: number) {
  const band = BANDS[b];
  const rng = mulberry32(0x85ebca6b ^ ((b + 1) * 0x27d4eb2f) ^ (k * 2654435761));
  const days = band.minDays + Math.floor(rng() * (band.maxDays - band.minDays));
  const perDay = Math.exp(Math.log(10) + rng() * Math.log(120 / 10));
  const plays = Math.round(perDay * days);
  return { days, plays, history: synthSpan(plays, 100_000 + b * 10_000 + k, END - days * DAY, END) };
}

export interface BandTrial extends Omit<NullTrial, "startYear"> {
  band: string;
  days: number;
}

export function bandTrial(b: number, k: number): BandTrial {
  const { days, plays, history } = bandHistory(b, k);
  return { k, band: BANDS[b].id, days, plays, ...judge(`band-${BANDS[b].id}-${k}`, history).trial };
}

/** The seam questions (6.1a), whose 6-event floor the edges below probe. */
export const FLOOR_QUESTIONS = ["mercury", "fullmoon", "newmoon", "moonstrong"] as const satisfies readonly QuestionId[];
export type FloorQuestion = (typeof FLOOR_QUESTIONS)[number];

/** A question's events (its windows grouped), in time order, 2017 to the end. */
function eventsOf(id: QuestionId) {
  const by = new Map<number, { start: number; end: number }>();
  for (const w of conditionFor(id)!.windows) {
    const g = by.get(w.event);
    by.set(w.event, g ? { start: Math.min(g.start, w.start), end: Math.max(g.end, w.end) } : { start: w.start, end: w.end });
  }
  const from = Date.UTC(2017, 0, 1) / 1000;
  return [...by.values()].filter((e) => e.start >= from && e.end < END).sort((a, b) => a.start - b.start);
}

/** Plays a day for a floor history: enough that 500 plays land in six of the
    question's windows (Mercury's run three weeks, the Moon's two or three days). */
const FLOOR_PER_DAY: Record<FloorQuestion, [number, number]> = {
  mercury: [15, 60],
  fullmoon: [60, 150],
  newmoon: [60, 150],
  moonstrong: [60, 150],
};

/**
 * The 6-event floor's edges: a history whose test span (after any warm-up)
 * holds exactly `events` of a question's events. The span opens in the gap
 * before the first of them and the history ends in the gap after the last,
 * clear of each by a third of the gap, two days at most. The strong Moon's
 * gaps between Taurus and Cancer are about two days, so an odd count puts
 * one edge in a short gap and an even count can put both there, where the
 * first or last play can land an event either way; and the engine counts an
 * event only when a play falls in it, so a history can come out an event or
 * two short, never over.
 * So trials report the count the engine gives, and the run reports how the
 * histories built for each count came out.
 */
export function floorHistory(id: FloorQuestion, events: number, k: number) {
  const q = questionById(id);
  const evs = eventsOf(id);
  const rng = mulberry32(0xc2b2ae35 ^ (FLOOR_QUESTIONS.indexOf(id) + 1) * 0x165667b1 ^ (events * 0x9e3779b9) ^ (k * 2654435761));
  const nextStart = (i: number) => (i + 1 < evs.length ? evs[i + 1].start : END);
  const usable = (i: number) =>
    i - events >= 0 && nextStart(i) <= END && evs[i].end < END - 2 * DAY && evs[i - events + 1].start - q.warmupDays * DAY > Date.UTC(2017, 0, 1) / 1000;
  const lasts = evs.map((_, i) => i).filter(usable);
  const last = lasts[Math.floor(rng() * lasts.length)];
  const firstEvent = last - events + 1;
  // A point in the gap from a to b, clear of each end by a third of it, two days at most.
  const inGap = (a: number, b: number) => {
    const clear = Math.min(2 * DAY, Math.floor((b - a) / 3));
    return a + clear + Math.floor(rng() * Math.max(1, b - a - 2 * clear));
  };
  const open = inGap(evs[firstEvent - 1].end, evs[firstEvent].start);
  const close = inGap(evs[last].end, Math.min(nextStart(last), END));
  const from = open - q.warmupDays * DAY;
  const [lo, hi] = FLOOR_PER_DAY[id];
  const perDay = Math.exp(Math.log(lo) + rng() * Math.log(hi / lo));
  const plays = Math.round(perDay * ((close - from) / DAY));
  return { plays, days: Math.round((close - from) / DAY), history: synthSpan(plays, 200_000 + FLOOR_QUESTIONS.indexOf(id) * 10_000 + events * 1_000 + k, from, close) };
}

export interface FloorTrial extends Omit<NullTrial, "startYear"> {
  question: FloorQuestion;
  /** The events the history was built to hold. */
  target: number;
  days: number;
  /** What the engine made of the question: its events, status and word. */
  events: number;
  /** Null when it wasn't run at all (not checked). */
  status: string | null;
  word: string | null;
}

export function floorTrial(id: FloorQuestion, events: number, k: number): FloorTrial {
  const { plays, days, history } = floorHistory(id, events, k);
  const { record, words, trial } = judge(`floor-${id}-${events}-${k}`, history);
  const i = QUESTIONS.findIndex((x) => x.id === id);
  const q = record.questions[i];
  return { k, plays, days, question: id, target: events, events: q.events ?? 0, status: q.status, word: words[i] ?? null, ...trial };
}

export interface NullSummary {
  histories: number;
  anyYes: number;
  anyYesShare: number;
  /** Histories with any tested p under 0.05: the uncorrected rule's rate. */
  anyLowP: number;
  anyLowPShare: number;
  perQuestion: Record<QuestionId, { tested: number; lowP: number; yes: number }>;
}

export function summarize(trials: NullTrial[]): NullSummary {
  const perQuestion = Object.fromEntries(QUESTIONS.map((q) => [q.id, { tested: 0, lowP: 0, yes: 0 }])) as NullSummary["perQuestion"];
  let anyYes = 0;
  let anyLowP = 0;
  for (const t of trials) {
    if (t.yes.length) anyYes++;
    if (t.lowP.length) anyLowP++;
    for (const id of t.tested) perQuestion[id].tested++;
    for (const id of t.lowP) perQuestion[id].lowP++;
    for (const id of t.yes) perQuestion[id].yes++;
  }
  const n = trials.length;
  return { histories: n, anyYes, anyYesShare: anyYes / n, anyLowP, anyLowPShare: anyLowP / n, perQuestion };
}
