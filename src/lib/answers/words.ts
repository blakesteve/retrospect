/**
 * The answer word (spec 6.3) and the likelihood phrase (9.1). Pure, and free of
 * data, so the rule can be tested with whole p vectors.
 */

export type AnswerWord = "Yes" | "Maybe" | "Not clearly" | "No" | "Too early" | "Not checked";

/** The false-discovery rate a Yes is corrected at. */
export const FDR = 0.1;
/** A Yes also needs its own p under this (Blake, 29 Sept). */
export const YES_P = 0.05;

/**
 * Benjamini-Hochberg over the tested questions' p-values: which pass at `FDR`,
 * and each one's adjusted p, the smallest over j >= i of m x p(j) / j, capped
 * at 1. Returned in the order given.
 */
export function benjaminiHochberg(ps: number[], q = FDR): { passed: boolean[]; adjusted: number[] } {
  const m = ps.length;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let k = 0;
  order.forEach(({ p }, r) => {
    if (p <= (q * (r + 1)) / m) k = r + 1;
  });
  const adjusted = new Array<number>(m);
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    running = Math.min(running, (m * order[r].p) / (r + 1));
    adjusted[order[r].i] = Math.min(1, running);
  }
  const passed = new Array<boolean>(m).fill(false);
  for (let r = 0; r < k; r++) passed[order[r].i] = true;
  return { passed, adjusted };
}

/** The word for a tested question (spec 6.3). */
export function wordFor(p: number, passedCorrection: boolean): AnswerWord {
  if (passedCorrection && p < YES_P) return "Yes";
  if (p < 0.1) return "Maybe";
  if (p < 0.35) return "Not clearly";
  return "No";
}

/** The likelihood phrase follows p alone (9.1). */
export function likelihoodFor(p: number): string {
  if (p < 0.01) return "Very unlikely to be chance.";
  if (p < 0.05) return "Unlikely to be chance.";
  if (p < 0.35) return "Could be chance.";
  return "Could easily be chance.";
}

/**
 * Words for a listener's questions. `tested[i]` is question i's p when its
 * status is "tested", or null otherwise. Questions that aren't tested are left
 * out of `m` and get no word here: the caller says "Too early" or "Not
 * checked".
 */
export function answerWords(tested: (number | null)[]): {
  m: number;
  words: (AnswerWord | null)[];
  pAdjusted: (number | null)[];
} {
  const idx = tested.flatMap((p, i) => (p === null ? [] : [i]));
  const { passed, adjusted } = benjaminiHochberg(idx.map((i) => tested[i]!));
  const words = tested.map(() => null as AnswerWord | null);
  const pAdjusted = tested.map(() => null as number | null);
  idx.forEach((i, r) => {
    words[i] = wordFor(tested[i]!, passed[r]);
    pAdjusted[i] = adjusted[r];
  });
  return { m: idx.length, words, pAdjusted };
}
