/**
 * Runs of consecutive nights (spec 6.2, rule 3). Questions 7 and 8 count a
 * run of storm (or X-flare) nights as one event (`nightsCondition`), and a
 * storm's wild nights get one card per run (7.5, `oneCardPerEvent`), so the
 * question, the filter dock and the wild row all count the same stretches.
 *
 * Pure, and free of imports, so anything can use it: nights are day numbers
 * (`ZoneClock.nightOf`), in any order, repeats allowed.
 */

/** The nights as runs, in order, each run's nights in order. */
export function nightRuns(nights: Iterable<number>): number[][] {
  const sorted = [...new Set(nights)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const n of sorted) {
    const run = runs.at(-1);
    if (run && run[run.length - 1] === n - 1) run.push(n);
    else runs.push([n]);
  }
  return runs;
}

/** Each night's run, named by the run's first night. */
export function runStarts(nights: Iterable<number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const run of nightRuns(nights)) for (const n of run) out.set(n, run[0]);
  return out;
}
