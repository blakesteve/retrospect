import { mulberry32 } from "@/lib/analysis/rng";
import { computeAnswers } from "./engine";
import { QUESTIONS, type QuestionId } from "./questions";
import { synthHistory } from "./synthHistory";
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
 */

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
  const record = computeAnswers(`null-${k}`, history, "America/Chicago");
  const ps = record.questions.map((q) => (q.status === "tested" ? q.p : null));
  const { m, words } = answerWords(ps);
  const ids = (pick: (i: number) => boolean) => QUESTIONS.flatMap((q, i) => (pick(i) ? [q.id] : []));
  return {
    k,
    plays,
    startYear,
    m,
    tested: ids((i) => ps[i] !== null),
    lowP: ids((i) => ps[i] !== null && ps[i]! < 0.05),
    yes: ids((i) => words[i] === "Yes"),
  };
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
