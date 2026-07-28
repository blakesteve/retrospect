import type { Scrobble } from "./analysis/nostalgia";
import { tagScrobbles } from "./analysis/nostalgia";
import { tagDiscovery, tagOldFlame } from "./analysis/metrics";

/**
 * The sky-independent report: what actually runs this person's listening.
 * This is the guaranteed payoff — even a listener the stars can't touch has
 * fingerprints, and they're usually more interesting than the horoscope.
 */

const DAY = 86400;
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
  oldFavoriteShare: number;
  discoveryShare: number;
  reunionShare: number;
  busiestDay: { date: string; count: number };
  longestStreakDays: number;
}

export function buildProfile(scrobbles: Scrobble[], tzOffsetMinutes: number): ListeningProfile | null {
  if (scrobbles.length < 500) return null;
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
  const topMo = monthCounts.indexOf(Math.max(...monthCounts));

  // Baseline habit shares (sky not consulted).
  const meanTag = (tagged: { nostalgic: boolean }[]) =>
    tagged.length ? tagged.filter((t) => t.nostalgic).length / tagged.length : 0;
  const oldFavoriteShare = meanTag(tagScrobbles(sorted, "track", 365).tagged);
  const discoveryShare = meanTag(tagDiscovery(sorted).tagged);
  const reunionShare = meanTag(tagOldFlame(sorted, 548).tagged);

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

  // Archetypes: two or three honest badges.
  const archetypes: Archetype[] = [];
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
  if (discoveryShare >= 0.1) {
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
  if (reunionShare >= 0.015) {
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
    topMonth: {
      month: MONTHS[topMo],
      delta: monthCounts[topMo] / n / (1 / 12) - 1,
    },
    playsPerDay,
    oldFavoriteShare,
    discoveryShare,
    reunionShare,
    busiestDay,
    longestStreakDays,
  };
}
