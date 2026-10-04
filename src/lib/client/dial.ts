/**
 * The Sky view's dial as plain logic (spec 8.6 item 3, 11): a slider over
 * every night of the history, the first night to tonight. Where a key moves
 * it, what it says, where a tap lands, when letting go snaps to a wild
 * night, where "Play your years" is, and where a song's star sits on the
 * rim's spiral. No DOM and no sky, so the browser imports it before
 * astronomy-engine arrives.
 */
import { addDays, dateText, daysIn, shiftMonth, weekdayOf, WEEKDAYS, type NightDate } from "./dates";

/** Each kind of night the dial ticks, by its offset from the first night (the dial route). */
export interface DialMarks {
  /** [offset, "Kp 9"] */
  storm: [number, string][];
  /** [offset, "X5.8"] */
  xflare: [number, string][];
  /** [offset, "total solar"] */
  eclipse: [number, string][];
  /** The offsets of nights an asteroid came closer than the Moon. */
  asteroid: number[];
  /** [offset, rank, title, heads its event] */
  wild: [number, number, string, boolean][];
}

/** What one night holds, for the dial's words and its flashes. */
export interface DialNight {
  storm?: string;
  xflare?: string;
  eclipse?: string;
  asteroid?: boolean;
  wild?: string;
}

/** Every marked night by offset, once, so a frame looks one up rather than searching. */
export function marksByNight(marks: DialMarks): Map<number, DialNight> {
  const out = new Map<number, DialNight>();
  const put = (i: number, patch: DialNight) => out.set(i, { ...out.get(i), ...patch });
  for (const [i, kp] of marks.storm) put(i, { storm: kp });
  for (const [i, cls] of marks.xflare) put(i, { xflare: cls });
  for (const [i, kind] of marks.eclipse) put(i, { eclipse: kind });
  for (const i of marks.asteroid) put(i, { asteroid: true });
  for (const [i, , title] of marks.wild) put(i, { wild: title });
  return out;
}

/** The night `i` nights after the first. */
export const nightAt = (first: NightDate, i: number): NightDate => addDays(first, i);
/** How many nights `date` is after `first`. */
export const offsetOf = (first: NightDate, date: NightDate): number => Math.round((Date.parse(date) - Date.parse(first)) / 86_400_000);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where a key moves the dial (11): Right and Up a night later, Left and Down
 * a night earlier, with Shift a week; Page Up a month later and Page Down a
 * month earlier, on the same day (or the month's last); Home the first
 * night and End tonight. Held to the history. Null for any other key.
 */
export function dialKey(key: string, shift: boolean, i: number, n: number, first: NightDate): number | null {
  const last = n - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(i + (shift ? 7 : 1), 0, last);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(i - (shift ? 7 : 1), 0, last);
    case "PageUp":
    case "PageDown": {
      const date = nightAt(first, i);
      const month = shiftMonth(date.slice(0, 7), key === "PageUp" ? 1 : -1);
      const day = Math.min(Number(date.slice(8, 10)), daysIn(month));
      return clamp(offsetOf(first, `${month}-${String(day).padStart(2, "0")}`), 0, last);
    }
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

const playsText = (plays: number) => (plays === 1 ? "1 play" : `${plays.toLocaleString("en-US")} plays`);

/**
 * What the dial says at a night (11): "Friday, May 10, 2024: 39 plays,
 * solar storm Kp 9". Tonight is "so far"; a night without music says so.
 */
export function dialValueText(date: NightDate, plays: number, night: DialNight | undefined, tonight: boolean): string {
  const parts = [plays === 0 ? (tonight ? "no plays yet" : "no plays") : `${playsText(plays)}${tonight ? " so far" : ""}`];
  if (night?.storm) parts.push(`solar storm ${night.storm}`);
  if (night?.xflare) parts.push(`${night.xflare} flare`);
  if (night?.eclipse) parts.push(`${night.eclipse} eclipse`);
  if (night?.asteroid) parts.push(`an asteroid closer than the Moon`);
  return `${WEEKDAYS[weekdayOf(date)]}, ${dateText(date)}${tonight ? ", tonight" : ""}: ${parts.join(", ")}`;
}

/** Letting go within this many nights of a wild night snaps to it (8.6). */
export const SNAP_NIGHTS = 6;

/** The wild night a release at `i` snaps to: the nearest within 6 nights,
    the earlier on a tie; null with none that close. */
export function snapTarget(i: number, wild: readonly number[]): number | null {
  let best: number | null = null;
  for (const w of wild) {
    const d = Math.abs(w - i);
    if (d > SNAP_NIGHTS) continue;
    if (best === null || d < Math.abs(best - i) || (d === Math.abs(best - i) && w < best)) best = w;
  }
  return best;
}

/** The night under a point on the track, `x` from its first night's end and `width` from first to last. */
export const nightAtX = (x: number, width: number, n: number): number => (n <= 1 || width <= 0 ? 0 : Math.round(clamp(x / width, 0, 1) * (n - 1)));
/** Where a night (or a fraction of one) sits on the track. */
export const xOfNight = (i: number, width: number, n: number): number => (n <= 1 ? 0 : (clamp(i, 0, n - 1) / (n - 1)) * width);

/** "Play your years" runs the whole history in 15 seconds (8.6). */
export const PLAY_MS = 15_000;
/** Under reduced motion it steps a month a second instead (8.6, 11). */
export const REDUCED_STEP_MS = 1000;

/** Where play starts: where the dial is, or the first night if it's at tonight. */
export const playStart = (i: number, n: number): number => (i >= n - 1 ? 0 : i);
/** Where play is `elapsed` ms after starting at night `from`: a fraction of a
    night, at the whole history's pace, held at tonight. */
export const playAt = (from: number, n: number, elapsed: number): number => Math.min(n - 1, from + (Math.max(0, elapsed) / PLAY_MS) * (n - 1));

/** A star's distance from the center on the rim's spiral (8.6): from the
    inner radius at the first play of the history to the outer at now. */
export const spiralRadius = (uts: number, startUts: number, nowUts: number, inner: number, outer: number): number =>
  inner + (outer - inner) * clamp((uts - startUts) / Math.max(1, nowUts - startUts), 0, 1);

/** A star's size by its plays, the most-played the largest (8.6), as the Orrery drew them. */
export const starSize = (plays: number, maxPlays: number): number => 2.7 + 3.8 * Math.sqrt(clamp(plays / Math.max(1, maxPlays), 0, 1));

/**
 * The dial's waveform (8.6 item 3): each column's average plays, smoothed
 * over about a week, as a height from 0 to 1. Columns above the 98th
 * percentile are held to it before smoothing, so one huge night can't
 * flatten the rest of a history; the top is the highest smoothed column,
 * so a history's busiest stretch always reaches it, however its nights fall.
 */
export function playsWave(plays: readonly number[], cols: number): number[] {
  const n = plays.length;
  const k = Math.max(1, Math.min(cols, n));
  const sum = Array<number>(k).fill(0);
  const count = Array<number>(k).fill(0);
  plays.forEach((p, i) => {
    // In integers, so a night never falls short into the column before.
    const c = Math.min(k - 1, Math.floor((i * k) / Math.max(1, n)));
    sum[c] += p;
    count[c]++;
  });
  const mean = sum.map((s, c) => (count[c] ? s / count[c] : 0));
  const sorted = [...mean].sort((a, b) => a - b);
  const cap = sorted[Math.min(k - 1, Math.floor(0.98 * (k - 1)))] || sorted[k - 1];
  const held = mean.map((v) => Math.min(v, cap));
  // About a week either way, and at least a column.
  const r = Math.max(1, Math.round((3 * k) / Math.max(1, n)));
  const smooth = held.map((_, c) => {
    let s = 0;
    let m = 0;
    for (let j = Math.max(0, c - r); j <= Math.min(k - 1, c + r); j++) {
      s += held[j];
      m++;
    }
    return s / m;
  });
  const top = Math.max(...smooth) || 1;
  return smooth.map((v) => v / top);
}

/** A night's plays as the dial passes it: the night's own at rest, the
    average of the nights about it while the sky travels or plays, when the
    dial crosses several nights a frame and one night's count would flicker. */
export function playsAround(plays: readonly number[], i: number, moving: boolean): number {
  if (!moving) return plays[i] ?? 0;
  let s = 0;
  let m = 0;
  for (let j = Math.max(0, i - 7); j <= Math.min(plays.length - 1, i + 7); j++) {
    s += plays[j];
    m++;
  }
  return m ? s / m : 0;
}

/** Wild nights to mark on the track, wilder first: each at least `gap`px from every one kept before it. */
export function spaced(xs: readonly number[], gap: number): number[] {
  const kept: number[] = [];
  for (const x of xs) if (kept.every((k) => Math.abs(k - x) >= gap)) kept.push(x);
  return kept;
}

/** A star among the most played draws a sparkle behind it: over 100 plays of
    the Orrery's most played 212, as a share of this history's most played. */
export const sparkles = (plays: number, maxPlays: number): boolean => plays / Math.max(1, maxPlays) > 100 / 212;

/** How strongly the Moon's wave is drawn: fully while a month spans 6px or
    more, fading out by 3px, where its peaks can no longer be told apart. */
export const moonWaveOpacity = (nights: number, width: number): number => clamp(((29.53 * width) / Math.max(1, nights) - 3) / 3, 0, 1);

/** The wheel's opening (8.11): the planets wind back into place, the outer
    farther, the Orrery's way. */
export const OPENING_MS = 1900;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
/** Where planet `k` (Moon 0 to Saturn 6) is drawn at `p` (0 to 1) of the opening. */
export const openingLongitude = (lon: number, k: number, p: number): number => {
  const e = easeOut(clamp(p * 1.3 - k * 0.05, 0, 1));
  return (((lon - (1 - e) * (150 + k * 24)) % 360) + 360) % 360;
};
/** How much of the spiral is drawn at `p` of the opening. */
export const openingSpiral = (p: number): number => easeOut(clamp(p * 1.2, 0, 1));

/** The ring around the center, as wide as the night's plays (the Orrery's pulse). */
export const pulseWidth = (plays: number, top: number): number => 1.2 + clamp(plays / Math.max(1, top), 0, 1) * 7.5;
