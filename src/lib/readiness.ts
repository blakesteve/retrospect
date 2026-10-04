/**
 * Plain English for "this needs more history": the profile's habits that wait
 * for it (7.4, "Your habits"). A history younger than a habit's warm-up has
 * nothing to report yet. It isn't an error and it isn't a verdict; it's a
 * date on the calendar, and this says which one.
 */

/** "March 2027", in the listener's zone (9.2). */
function fmtMonthYear(uts: number, zone: string): string {
  return new Date(uts * 1000).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: zone,
  });
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

/** One sentence naming every withheld habit and when it can start, or null,
    its months in the listener's zone. */
export function pendingHabitsSentence(pending: PendingHabit[], nowMs: number, zone: string): string | null {
  if (pending.length === 0) return null;
  const parts = pending.map((p) => {
    /* A future start is not a promise of an answer on that date: the habit
       then needs `minPlays` songs after it, and the sentence says so. */
    const when =
      p.readyFromUts * 1000 > nowMs
        ? `from ${fmtMonthYear(p.readyFromUts, zone)}, once you've played about ${p.minPlays} songs after that`
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
