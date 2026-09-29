import type { Report } from "./report";
import { METRICS } from "./analysis/metrics";
import { PHENOMENA } from "./ephemeris/phenomena";

/*
 * How a trial's result reads to a visitor. Plain English by default: how
 * likely the swing is to be chance, in words and as a plain frequency. The
 * p-value is only for a visitor who has asked for it, and always comes with
 * what it means.
 *
 * The reveal and the dashboard both read a trial through this module, so
 * they can't give one trial two verdicts a click apart, which they did
 * when the reveal printed the binary verdict and the dashboard added a
 * "lead" tier the reveal didn't know about.
 */

/** A lead is a big swing with p under this. The "could be chance" band ends
    at the same place, so a lead never reads "could easily be chance" beside
    "worth raising an eyebrow at". */
export const LEAD_P = 0.35;

export type LikelihoodBand = "very-unlikely" | "unlikely" | "could-be" | "could-easily-be";

export interface Likelihood {
  band: LikelihoodBand;
  /** "Could easily be chance." */
  label: string;
  /** "Shuffle the sky and a swing this big, up or down, turns up about 3 times in 10." */
  sentence: string;
}

/**
 * The words for a p-value. Never "proves": the strongest is "very unlikely
 * to be chance", because that is all a scramble test can say.
 *
 * The band comes from p, which counts the real calendar as one possible
 * outcome of chance (see permutationP). The sentence reports what the
 * shuffles actually did: `matches` of `iterations`.
 */
export function likelihood(p: number, matches: number, iterations: number): Likelihood {
  const band: LikelihoodBand =
    p < 0.01 ? "very-unlikely" : p < 0.05 ? "unlikely" : p < LEAD_P ? "could-be" : "could-easily-be";
  const label = {
    "very-unlikely": "Very unlikely to be chance.",
    unlikely: "Unlikely to be chance.",
    "could-be": "Could be chance.",
    "could-easily-be": "Could easily be chance.",
  }[band];
  return { band, label, sentence: frequency(matches, iterations) };
}

function frequency(matches: number, iterations: number): string {
  const swing = "a swing this big, up or down,";
  if (matches === 0) {
    return `Shuffle the sky ${iterations.toLocaleString()} times and ${swing} never turns up.`;
  }
  const rate = matches / iterations;
  if (rate < 0.2) {
    const n = Math.round(iterations / matches);
    return `Shuffle the sky and ${swing} turns up about 1 time in ${n.toLocaleString()}.`;
  }
  const k = Math.round(rate * 10);
  return k >= 10
    ? `Shuffle the sky and ${swing} turns up almost every time.`
    : `Shuffle the sky and ${swing} turns up about ${k} times in 10.`;
}

/**
 * "0.27", "0.036", "0.0005": two significant figures, no "<0.001", and more
 * digits whenever rounding would put the printed value on the other side of a
 * line the words depend on (0.01, 0.05, the lead line). Otherwise a p of
 * 0.04998 prints "0.050" under "Unlikely to be chance".
 */
export function formatP(p: number): string {
  const edges = [0.01, 0.05, LEAD_P];
  for (let digits = 2; digits <= 6; digits++) {
    const shown = Number(p.toPrecision(digits));
    if (edges.every((e) => shown < e === p < e)) return String(shown);
  }
  return String(p);
}

/** The p-value with what it means, for a visitor who turned p-values on. */
export function pValueNote(p: number, iterations: number): string {
  return `p = ${formatP(p)}: the share of ${iterations.toLocaleString()} shuffled skies (plus the real one) that matched or beat this swing. Under 0.05 is the usual bar for "unlikely to be chance".`;
}

/**
 * - confirmed: tested, and passed the scramble test.
 * - lead: tested, a big swing that chance could still fake.
 * - null: tested, and nothing chance couldn't produce.
 * - untested: not enough to test (see VerdictStatus). Never a lead, never a
 *   conviction, and never "nothing there".
 */
export type TrialTier = "confirmed" | "lead" | "null" | "untested";

export function trialTier(r: Report): TrialTier {
  if (r.verdict.status !== "tested") return "untested";
  if (r.verdict.significant) return "confirmed";
  const pct = Math.abs(r.index - 1) * 100;
  return pct >= 10 && r.p < LEAD_P ? "lead" : "null";
}

/** Deterministic phrase variety: stable per trial, different across trials. */
function phraseSeed(r: Report): number {
  const s = `${r.username}|${r.body}|${r.metric}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
const pick = <T,>(seed: number, salt: number, arr: T[]): T => arr[(seed + salt) % arr.length];

export interface Reading {
  tier: TrialTier;
  /** The big line: "Maybe, +38%". */
  big: string;
  /** The plain-English line under it. */
  sub: string;
  /** Null when there was nothing to test. */
  likelihood: Likelihood | null;
}

/** The answer to a trial, for both the reveal and the dashboard hero. Not
    for a warming-up trial, which has its own "Too soon to tell." */
export function readTrial(r: Report): Reading {
  const tier = trialTier(r);
  const metric = METRICS[r.metric];
  const meta = PHENOMENA[r.body];
  const seed = phraseSeed(r);
  const d = Number.isFinite(r.index) ? Math.round((r.index - 1) * 100) : 0;
  const dStr = `${d > 0 ? "+" : ""}${d}%`;
  const pct = Math.abs(d);

  if (tier === "untested") {
    return { tier, big: "Not enough to tell.", sub: r.verdict.detail, likelihood: null };
  }
  const big =
    tier === "confirmed"
      ? r.index > 1
        ? pick(seed, 1, [`Yes, ${dStr}`, `Oh yes, ${dStr}`, `Confirmed: ${dStr}`])
        : pick(seed, 2, [`Backwards, ${dStr}`, `Inverted: ${dStr}`])
      : tier === "lead"
        ? pick(seed, 3, [`Maybe, ${dStr}`, `Hmm… ${dStr}`, `Possibly, ${dStr}`])
        : d === 0
          ? pick(seed, 4, ["No, dead flat.", "No, flatline.", "No, not a hair."])
          : pick(seed, 5, [`No, just ${dStr}`, `Nah, ${dStr}`, `Not really, ${dStr}`]);
  const sub =
    tier === "confirmed"
      ? metric.plainTerms(meta.when, r.index > 1, pct)
      : tier === "lead"
        ? pick(seed, 6, [
            `${dStr} is a real-looking lean, but chance can fake a swing this size. Not convicted. Definitely a suspect.`,
            `A ${pct}% lean is worth raising an eyebrow at, but not enough for a conviction. Keep the file open.`,
            `${dStr} isn't nothing. It also isn't proof. Call it a lead.`,
          ])
        : d === 0
          ? `No swing at all. ${r.verdict.headline}`
          : pick(seed, 7, [
              `That ${pct}% drift is small enough for chance to produce on its own. ${r.verdict.headline}`,
              `Shuffle the calendar and swings like ${dStr} show up on their own, no planets required. ${r.verdict.headline}`,
              `Swings of ${pct}% turn up in shuffled calendars too. ${r.verdict.headline}`,
            ]);
  return { tier, big, sub, likelihood: likelihood(r.p, r.matches, r.iterations) };
}

/**
 * Where a trial lands in the 25-trial sweep.
 * - conviction / lead: a chip. Only ever a tested trial.
 * - tested: tested, nothing there. Counts toward "judged".
 * - waiting: not enough history yet (warming up, too few plays or events).
 * - untested: nothing to compare at all.
 */
export type SweepCategory = "conviction" | "lead" | "tested" | "waiting" | "untested";

export function sweepCategory(r: Report): SweepCategory {
  const tier = trialTier(r);
  if (tier === "confirmed") return "conviction";
  if (tier === "lead") return "lead";
  if (tier === "null") return "tested";
  return r.verdict.status === "no-comparison" ? "untested" : "waiting";
}

/** A duel side's label. Untested is its own answer, never "within chance". */
export function duelSideLabel(r: Report | undefined): string {
  if (!r) return "no result";
  if (r.verdict.status !== "tested") return "not enough to test";
  if (!r.verdict.significant) return "within chance";
  return `moved ${Math.round(Math.abs(r.index - 1) * 100)}%, unlikely to be chance`;
}

/**
 * Why one side of a duel round wasn't scored, from its verdict's status. It
 * used to blame "listening" for everything, including a 25,000-play history
 * that simply hadn't seen enough Venus retrogrades.
 */
export function duelUnscoredReason(name: string, r: Report, eventsMany: string): string {
  switch (r.verdict.status) {
    case "too-few-events":
      return `${name}'s history hasn't had enough ${eventsMany} yet to call a pattern`;
    case "no-comparison":
      return `${name}'s listening has nothing to compare here`;
    default:
      return `there isn't enough of ${name}'s listening to test yet`;
  }
}
