import type { Scrobble, TagResult } from "./analysis/nostalgia";
import { tagScrobbles } from "./analysis/nostalgia";
import { tagDiscovery, tagOldFlame } from "./analysis/metrics";
import type { PendingHabit, PendingHabitKey } from "./readiness";

/**
 * The sky-independent report: what actually runs this person's listening.
 * This is the guaranteed payoff — even a listener the stars can't touch has
 * fingerprints, and they're usually more interesting than the horoscope.
 */

const DAY = 86400;

/** A profile needs this many scrobbles at all. */
export const PROFILE_MIN_SCROBBLES = 500;

/**
 * Three habits only count plays after a warm-up: old favorites and first
 * listens after the first year, reunions after the first 548 days. Around a
 * year old that leaves almost nothing (a 365-day history kept its last 74
 * plays, under seven hours of listening) and an empty list used to come back
 * as a share of 0, which produced "Only 0% of your plays are old favorites".
 *
 * So a habit is reported only once this many plays have passed its warm-up,
 * the same floor a trial needs inside its windows before it gives a verdict
 * (MIN_RETRO_N in lib/report.ts). Below it the share is null and the habit is
 * listed in `pending` with the date it can start.
 */
export const HABIT_MIN_COUNTED = 500;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface Archetype {
  emoji: string;
  label: string;
  why: string;
}

export interface ListeningProfile {
  archetypes: Archetype[];
  /** Share of plays per local hour, 24 entries summing to ~1. */
  hourShares: number[];
  goldenHour: { startHour: number; endHour: number; share: number };
  nightShare: number;
  topWeekday: { day: string; share: number };
  topMonth: { month: string; delta: number };
  playsPerDay: number;
  /** Share of post-warm-up plays that are old favorites; null while pending. */
  oldFavoriteShare: number | null;
  /** Share of post-warm-up plays that are first listens; null while pending. */
  discoveryShare: number | null;
  /** Share of post-warm-up plays that are artist reunions; null while pending. */
  reunionShare: number | null;
  /** Habits withheld for want of history, and when each can start. */
  pending: PendingHabit[];
  busiestDay: { date: string; count: number };
  longestStreakDays: number;
}

export function buildProfile(scrobbles: Scrobble[], tzOffsetMinutes: number): ListeningProfile | null {
  if (scrobbles.length < PROFILE_MIN_SCROBBLES) return null;
  const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
  const shift = tzOffsetMinutes * 60;
  const n = sorted.length;

  // Local-time histograms.
  const hourCounts = new Array<number>(24).fill(0);
  const weekdayCounts = new Array<number>(7).fill(0);
  const monthCounts = new Array<number>(12).fill(0);
  const dayCounts = new Map<string, number>();
  for (const s of sorted) {
    const local = new Date((s.uts + shift) * 1000);
    hourCounts[local.getUTCHours()]++;
    weekdayCounts[local.getUTCDay()]++;
    monthCounts[local.getUTCMonth()]++;
    const day = local.toISOString().slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const hourShares = hourCounts.map((c) => c / n);
  const nightShare = (hourCounts[0] + hourCounts[1] + hourCounts[2] + hourCounts[3]) / n;

  // Golden hour: best 2-hour window.
  let goldenHour = { startHour: 0, endHour: 2, share: 0 };
  for (let h = 0; h < 24; h++) {
    const share = hourShares[h] + hourShares[(h + 1) % 24];
    if (share > goldenHour.share) goldenHour = { startHour: h, endHour: (h + 2) % 24, share };
  }

  const topWd = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const topMonth = loudestMonth(monthCounts, sorted[0].uts + shift, sorted[n - 1].uts + shift);

  // Baseline habit shares (sky not consulted), withheld below the floor.
  const pending: PendingHabit[] = [];
  const habitShare = (habit: PendingHabitKey, result: TagResult): number | null => {
    const counted = result.tagged.length;
    if (counted >= HABIT_MIN_COUNTED) {
      return result.tagged.filter((t) => t.nostalgic).length / counted;
    }
    pending.push({
      habit,
      readyFromUts: result.spanStart,
      countedPlays: counted,
      minPlays: HABIT_MIN_COUNTED,
    });
    return null;
  };
  const oldFavoriteShare = habitShare("old-favorites", tagScrobbles(sorted, "track", 365));
  const discoveryShare = habitShare("first-listens", tagDiscovery(sorted));
  const reunionShare = habitShare("reunions", tagOldFlame(sorted, 548));

  const spanDays = Math.max(1, (sorted[n - 1].uts - sorted[0].uts) / DAY);
  const playsPerDay = n / spanDays;

  // Busiest single (local) day + longest daily streak.
  let busiestDay = { date: "", count: 0 };
  for (const [date, count] of dayCounts) {
    if (count > busiestDay.count) busiestDay = { date, count };
  }
  const days = [...dayCounts.keys()].sort();
  let longestStreakDays = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of days) {
    const t = Date.parse(d + "T00:00:00Z");
    run = t - prev === DAY * 1000 ? run + 1 : 1;
    prev = t;
    if (run > longestStreakDays) longestStreakDays = run;
  }

  // Archetypes: two or three honest badges. A pending habit gets none.
  const archetypes: Archetype[] = [];
  if (oldFavoriteShare !== null) {
    if (oldFavoriteShare >= 0.55) {
      archetypes.push({
        emoji: "🛋",
        label: "Comfort Creature",
        why: `${Math.round(oldFavoriteShare * 100)}% of your plays are songs you already knew and loved. You return to what works.`,
      });
    } else if (oldFavoriteShare <= 0.35) {
      archetypes.push({
        emoji: "🧭",
        label: "Restless Explorer",
        why: `Only ${Math.round(oldFavoriteShare * 100)}% of your plays are old favorites. You rarely look back; there's always something next.`,
      });
    } else {
      archetypes.push({
        emoji: "⚖️",
        label: "Balanced Diet",
        why: `${Math.round(oldFavoriteShare * 100)}% comfort listens, ${100 - Math.round(oldFavoriteShare * 100)}% new territory. A genuinely even split is rarer than it sounds.`,
      });
    }
  }
  if (discoveryShare !== null && discoveryShare >= 0.1) {
    archetypes.push({
      emoji: "⛏",
      label: "Crate Digger",
      why: `${Math.round(discoveryShare * 100)}% of your plays are first listens, tracks you had never played before that moment. You hunt.`,
    });
  }
  if (nightShare >= 0.12) {
    archetypes.push({
      emoji: "🦉",
      label: "Night Owl",
      why: `${Math.round(nightShare * 100)}% of your listening lands between midnight and 4am. The small hours are your listening room.`,
    });
  } else if (nightShare <= 0.04) {
    archetypes.push({
      emoji: "🌤",
      label: "Daylight Listener",
      why: `Almost none of your listening happens between midnight and 4am (${(nightShare * 100).toFixed(1)}%). Your headphones sleep when you do.`,
    });
  }
  if (playsPerDay >= 60) {
    archetypes.push({
      emoji: "📻",
      label: "Always On",
      why: `${Math.round(playsPerDay)} plays a day, averaged over your whole history. Music is the background radiation of your life.`,
    });
  } else if (playsPerDay <= 15) {
    archetypes.push({
      emoji: "🎯",
      label: "Selective Ears",
      why: `A deliberate ${Math.round(playsPerDay)} plays a day. You choose what you hear; quality over volume.`,
    });
  }
  if (reunionShare !== null && reunionShare >= 0.015) {
    archetypes.push({
      emoji: "🕯",
      label: "Rekindler",
      why: "You regularly return to artists after years of silence. Some doors never close for you.",
    });
  }

  return {
    archetypes: archetypes.slice(0, 3),
    hourShares,
    goldenHour,
    nightShare,
    topWeekday: { day: WEEKDAYS[topWd], share: weekdayCounts[topWd] / n },
    topMonth,
    playsPerDay,
    oldFavoriteShare,
    discoveryShare,
    reunionShare,
    pending,
    busiestDay,
    longestStreakDays,
  };
}

/** A calendar month needs this many days of history to be the loudest. */
const MIN_MONTH_DAYS = 14;

/**
 * The calendar month you listen hardest in, as plays per day, against your
 * plays per day overall.
 *
 * It used to compare each month's share of all plays with a twelfth, as if
 * every history covered all twelve months equally. A three-month history
 * put a third of its plays in each of its months and read "+329% vs average".
 * And a history covering two Januaries but one August favored January for
 * the calendar alone. Dividing each month's plays by the days of history it
 * actually covers compares like with like. A month with under two weeks of
 * history (a partial first or last month) can't win, unless no month has
 * that much, and isn't part of the usual pace it's compared against.
 *
 * Takes local-time seconds, so a day boundary is the listener's midnight.
 */
export function loudestMonth(
  monthCounts: number[],
  firstLocalUts: number,
  lastLocalUts: number,
): { month: string; delta: number } {
  const days = new Array<number>(12).fill(0);
  const firstDay = Math.floor(firstLocalUts / DAY);
  const lastDay = Math.floor(lastLocalUts / DAY);
  for (let d = firstDay; d <= lastDay; d++) days[new Date(d * DAY * 1000).getUTCMonth()]++;
  // A month with no plays at all can't be the loudest, however long it is.
  const eligible = days.some((d, m) => d >= MIN_MONTH_DAYS && monthCounts[m] > 0)
    ? (m: number) => days[m] >= MIN_MONTH_DAYS && monthCounts[m] > 0
    : (m: number) => days[m] > 0 && monthCounts[m] > 0;
  /* The usual pace is over the same months that can win, so a busy partial
     month that can't win doesn't drag the winner below "usual" either. */
  let plays = 0;
  let covered = 0;
  for (let m = 0; m < 12; m++) {
    if (!eligible(m)) continue;
    plays += monthCounts[m];
    covered += days[m];
  }
  const overall = plays / covered;
  let top = -1;
  let topRate = -1;
  for (let m = 0; m < 12; m++) {
    if (!eligible(m)) continue;
    const rate = monthCounts[m] / days[m];
    if (rate > topRate) {
      top = m;
      topRate = rate;
    }
  }
  return { month: MONTHS[top], delta: topRate / overall - 1 };
}
