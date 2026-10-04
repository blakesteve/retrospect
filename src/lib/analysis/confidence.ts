
/*
 * How much evidence a trial needs before Retrospect will call it either way,
 * and how the scramble test turns into a p-value. Everything that decides
 * whether a verdict is issued lives here, so the answers engine and its
 * payload read the same rules.
 */

/** Below this many plays inside the windows, no verdict. */
export const MIN_RETRO_N = 500;

/**
 * Below this many separate events (windows that hold some of the trial's
 * listening), no verdict.
 *
 * Plays inside one window aren't independent: a single retrograde that landed
 * on a holiday or a bad week moves every play in it together. So however many
 * plays there are, the number of real observations is closer to the number of
 * events. The floor is the smallest count at which the events alone could
 * clear the app's own bar for "unlikely to be chance": if the sky did nothing,
 * each event is as likely to come out above your usual as below it, so every
 * one of N events agreeing happens by chance 2 × (1/2)^N of the time. That is
 * 6.25% at five events, which can't clear 5%, and 3.1% at six, which can.
 * With fewer than six, even a perfectly consistent pattern is too easy for
 * chance to produce.
 *
 * It costs rare skies the most. Mercury turns retrograde about three times a
 * year, so six takes about two years of testable history. Venus takes about
 * ten, and Mars about thirteen.
 */
export const MIN_EVENTS = 6;

/**
 * Whether a trial was actually tested, and if not, why not.
 *
 * - "tested": there was enough to test. `significant` says whether it passed.
 * - "too-few-plays": fewer than MIN_RETRO_N plays inside the windows.
 * - "too-few-events": fewer than MIN_EVENTS separate events.
 * - "no-comparison": enough plays, but no ratio to test, e.g. nothing of
 *   this kind was played outside the windows.
 * - "warming-up": every play sits inside the measure's warm-up.
 *
 * Only "tested" gets a word from Yes to No. Everything else is untested, and
 * must never read as unremarkable.
 */
export type VerdictStatus =
  | "tested"
  | "too-few-plays"
  | "too-few-events"
  | "no-comparison"
  | "warming-up";

/** What a trial had to go on, for the floors above. */
export interface Evidence {
  /** Plays inside the windows. */
  retroN: number;
  /** Separate events (windows) the trial's plays fell into. */
  events: number;
}

/**
 * Which floor a trial fails first, or "tested" if it clears them all.
 *
 * Plays come first: a history with no plays inside the windows yet (Venus
 * hasn't turned retrograde since you started) is waiting on more history,
 * not broken, even though it has no ratio either.
 */
export function evidenceStatus(index: number, p: number, evidence: Evidence): VerdictStatus {
  if (evidence.retroN < MIN_RETRO_N) return "too-few-plays";
  if (!Number.isFinite(index) || !Number.isFinite(p)) return "no-comparison";
  if (evidence.events < MIN_EVENTS) return "too-few-events";
  return "tested";
}

/**
 * The scramble test's p-value: how often a shuffled calendar matched or beat
 * the real one, counting the real one as a possible outcome of chance too.
 *
 * `matches / valid` can come out 0, which claims more certainty than any
 * finite number of shuffles can support; the report printed that as
 * "p<0.001". Adding one to both sides is the standard correction for a
 * permutation test, and it means p is never below 1 / (valid + 1): with 2,000
 * shuffles, never below about 0.0005.
 */
export function permutationP(matches: number, valid: number): number {
  return valid > 0 ? (matches + 1) / (valid + 1) : NaN;
}

