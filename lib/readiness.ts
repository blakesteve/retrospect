import { humanDays, type MetricKey } from "./analysis/metrics";

/**
 * Plain English for "this needs more history", shared by the API and the
 * pages so a young visitor is told the same thing everywhere.
 *
 * Three measures (Nostalgia, Old Flame, Discovery) ignore the first stretch
 * of a history, because nothing in it can count yet: a song can't be an old
 * favorite a week after you first heard it. So a history younger than that
 * stretch has nothing to test. It isn't an error and it isn't a verdict; it's
 * a date on the calendar, and these functions say which one.
 */

/** Why a trial had nothing to test. */
export interface Warmup {
  /**
   * "young-history": the whole history is younger than the warm-up.
   * "era-in-warmup": the history is old enough, but the requested era ends
   * before the warm-up does.
   */
  reason: "young-history" | "era-in-warmup";
  /** Length of this measure's warm-up, in days. */
  days: number;
  /** First scrobble of the whole history the trial read, unix seconds. */
  historyStartUts: number;
  /** historyStartUts + days: the first moment a play can count, unix seconds. */
  readyFromUts: number;
}

export const TOO_SOON_HEADLINE = "Too soon to tell.";

/** "March 2027". UTC, so the server and every visitor agree on the month. */
export function fmtMonthYear(uts: number): string {
  return new Date(uts * 1000).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** What a measure has to wait for, in words. Only the warm-up measures have one. */
function whatItNeeds(metric: MetricKey, days: number): string {
  switch (metric) {
    case "nostalgia":
      return `Retrospect counts a play as an old favorite when you first played it more than ${humanDays(days)} earlier.`;
    case "oldflame":
      return `Retrospect counts an old flame when you go back to an artist you'd played at least 10 times, after more than ${humanDays(days)} away.`;
    case "discovery":
      return `Every song is new at the start of a history, so Retrospect only starts counting first listens after the first ${days === 365 ? "year" : humanDays(days)} of your history.`;
    default:
      return "";
  }
}

/**
 * The explanation under "Too soon to tell." `skyWhen` is the phenomenon's own
 * phrase, "when Mercury is retrograde". Pass `nowMs` from a page so a history
 * that has gone quiet isn't promised a date that has already passed; the API
 * leaves it out and states only the calendar fact.
 *
 * It promises when plays START counting, never when an answer arrives: a
 * verdict also needs enough listening during the event itself, and for a rare
 * event that can take years.
 */
export function warmupExplanation(
  metric: MetricKey,
  w: Warmup,
  skyWhen: string,
  nowMs?: number,
): string {
  const need = whatItNeeds(metric, w.days);
  if (w.reason === "era-in-warmup") {
    return `${need} Everything you played in that stretch comes before ${fmtMonthYear(w.readyFromUts)}, when plays start counting. Try a stretch with listening after that.`;
  }
  const start = fmtMonthYear(w.historyStartUts);
  const ready = fmtMonthYear(w.readyFromUts);
  if (nowMs !== undefined && w.readyFromUts * 1000 <= nowMs) {
    return `${need} Your history stops before ${ready}, when plays start counting. Once Last.fm records listening after that, this can start.`;
  }
  return `${need} Your history starts in ${start}, so the first plays that can count arrive in ${ready}. After that, it needs enough of your listening ${skyWhen}, so how soon depends on how much you listen and how often that comes around.`;
}

/* ------------------------------------------------------------------ */
/* Profile habits that wait for history                                */
/* ------------------------------------------------------------------ */

export type PendingHabitKey = "old-favorites" | "first-listens" | "reunions";

export interface PendingHabit {
  habit: PendingHabitKey;
  /** History start + this habit's warm-up, unix seconds. */
  readyFromUts: number;
  /** Plays after the warm-up so far. */
  countedPlays: number;
  /** Plays after the warm-up a habit needs before it's reported. */
  minPlays: number;
}

const HABIT_WORDS: Record<PendingHabitKey, string> = {
  "old-favorites": "whether you mostly replay old favorites or go looking for new music",
  "first-listens": "how often you try songs you've never played before",
  reunions: "whether you go back to artists after long breaks",
};

/** "1 more song", "12 more songs", "about 430 more songs". */
function moreSongs(n: number): string {
  if (n === 1) return "1 more song";
  return n < 20 ? `${n} more songs` : `about ${Math.ceil(n / 10) * 10} more songs`;
}

/** One sentence naming every withheld habit and when it can start, or null. */
export function pendingHabitsSentence(pending: PendingHabit[], nowMs: number): string | null {
  if (pending.length === 0) return null;
  const parts = pending.map((p) => {
    /* A future start is not a promise of an answer on that date: the habit
       then needs `minPlays` songs after it, and the sentence says so. */
    const when =
      p.readyFromUts * 1000 > nowMs
        ? `from ${fmtMonthYear(p.readyFromUts)}, once you've played about ${p.minPlays} songs after that`
        : `needs ${moreSongs(Math.max(1, p.minPlays - p.countedPlays))}`;
    return `${HABIT_WORDS[p.habit]} (${when})`;
  });
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}`;
  return parts.length === 1
    ? `One habit needs more history before it means anything: ${list}.`
    : `A few habits need more history before they mean anything: ${list}.`;
}

/* ------------------------------------------------------------------ */
/* The sweep's summary when nothing turned up                          */
/* ------------------------------------------------------------------ */

/**
 * What the 25-trial sweep says when it found no convictions or leads.
 *
 * It used to say "All 25 trials came back clean" whatever happened, even when
 * most trials had nothing to test and were skipped. A young history reaches
 * that on the same page as "Too soon to tell", so an untested trial read as a
 * tested, unremarkable one. `judged` counts only trials that were actually
 * tested (verdict status "tested"), and history length is only blamed for the
 * ones waiting on more of it; a trial that failed or had nothing to compare
 * is said to be untested, not young.
 */
export function sweepNoHitsSentence(counts: {
  /** Trials whose verdict status is "tested". */
  judged: number;
  /** Trials waiting on more history: warming up, or too few plays or
      separate events for a verdict. */
  waiting: number;
  total: number;
}): string {
  const { judged, waiting, total } = counts;
  const untested = total - judged - waiting;
  if (judged === total) {
    return `All ${total} trials came back clean, not even a lead. The sky has absolutely no hold on you; you may be the most ungovernable listener we’ve ever scanned. Honestly? Iconic.`;
  }
  if (judged === 0 && waiting === total) {
    return `None of these ${total} trials can be judged on your history yet. They need more of your listening first.`;
  }
  const needs = (n: number) => `${n} need${n === 1 ? "s" : ""} more of your history first`;
  const notTested = (n: number) => `${n} couldn't be tested this time`;
  const why = [waiting > 0 && needs(waiting), untested > 0 && notTested(untested)].filter(Boolean).join(" and ");
  if (judged === 0) {
    return `None of these ${total} trials could be judged: ${why}.`;
  }
  const others = total - judged;
  const tail =
    waiting > 0 && untested > 0
      ? `Of the other ${others}, ${why}`
      : waiting > 0
        ? `The other ${others} need${others === 1 ? "s" : ""} more of your history first`
        : `The other ${others} couldn't be tested this time`;
  return `Nothing turned up in the ${judged} trial${judged === 1 ? "" : "s"} Retrospect could judge. ${tail}, so this isn't the last word.`;
}

