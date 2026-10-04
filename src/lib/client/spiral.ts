import { spiralRadius } from "./dial";

/* The Sky view's spiral calendar (spec 8.6 item 2): a turn a year, its angle
   the Sun's longitude, its radius how far into the history. Drawn smooth at
   any length (the Sun's place read every 8 days, 10 for the very longest
   histories, and a point every 2.5° or so between), and drawn finer as the turns crowd together, so 16 years
   in the same band read as engraved lines and not as one gold band. */

/** 0° Aries at 9 o'clock, the zodiac counterclockwise, as a chart is drawn. */
export const pt = (lon: number, r: number): [number, number] => {
  const a = (lon * Math.PI) / 180;
  return [-r * Math.cos(a), r * Math.sin(a)];
};

const DAY = 86_400;
const YEAR = 365.2422 * DAY;
/** The Sun's place is read this far apart (farther past 26 years, held to
    MAX_READS); between, it's interpolated: the Sun's motion barely bends in
    10 days, under 0.01° off. */
const READ_EVERY = 8 * DAY;
const MAX_READS = 1200;
/** Points a turn, so a chord never shows as a corner. */
const PER_TURN = 144;
const MAX_POINTS = 5000;

export interface Spiral {
  from: number;
  to: number;
  x: Float64Array;
  y: Float64Array;
  /** Distance along the path to each point. */
  cum: Float64Array;
  length: number;
  /** How many years the spiral winds. */
  turns: number;
  /** The space between one turn and the next, in the wheel's units. */
  gap: number;
  /** The whole path. */
  d: string;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** The spiral from the history's start to now, with the Sun's longitude at any instant. */
export function buildSpiral(from: number, to: number, sunLon: (uts: number) => number, ri: number, ro: number): Spiral {
  const span = Math.max(1, to - from);
  const turns = span / YEAR;
  // The Sun's place, unwrapped so it only grows: it never moves back.
  const reads = Math.max(2, Math.min(MAX_READS, Math.ceil(span / READ_EVERY) + 1));
  const lon = new Float64Array(reads);
  let prev = 0;
  for (let j = 0; j < reads; j++) {
    const l = sunLon(from + (span * j) / (reads - 1));
    lon[j] = j === 0 ? l : lon[j - 1] + ((((l - prev) % 360) + 360) % 360);
    prev = l;
  }
  const k = Math.max(121, Math.min(MAX_POINTS, Math.ceil(turns * PER_TURN) + 1));
  const x = new Float64Array(k);
  const y = new Float64Array(k);
  const cum = new Float64Array(k);
  const parts: string[] = [];
  for (let j = 0; j < k; j++) {
    const q = (j / (k - 1)) * (reads - 1);
    const i = Math.min(reads - 2, Math.floor(q));
    const a = lon[i] + (lon[i + 1] - lon[i]) * (q - i);
    const t = from + (span * j) / (k - 1);
    const [px, py] = pt(a, spiralRadius(t, from, to, ri, ro));
    // Measured as drawn, to a tenth.
    x[j] = Math.round(px * 10) / 10;
    y[j] = Math.round(py * 10) / 10;
    if (j > 0) cum[j] = cum[j - 1] + Math.hypot(x[j] - x[j - 1], y[j] - y[j - 1]);
    parts.push(`${f1(x[j])} ${f1(y[j])}`);
  }
  return { from, to, x, y, cum, length: cum[k - 1], turns, gap: (ro - ri) / Math.max(turns, 1e-9), d: `M${parts[0]}L${parts.slice(1).join(" ")}` };
}

/** Where on the spiral an instant falls, and how far along the path. */
export function spiralAt(s: Spiral, uts: number): { x: number; y: number; along: number } {
  const k = s.x.length;
  const q = Math.min(1, Math.max(0, (uts - s.from) / Math.max(1, s.to - s.from))) * (k - 1);
  const i = Math.min(k - 2, Math.floor(q));
  const f = q - i;
  return { x: s.x[i] + (s.x[i + 1] - s.x[i]) * f, y: s.y[i] + (s.y[i + 1] - s.y[i]) * f, along: s.cum[i] + (s.cum[i + 1] - s.cum[i]) * f };
}

/** The spiral between two instants, as `pieces` paths end to end, earliest first. */
export function spiralPieces(s: Spiral, a: number, b: number, pieces: number): string[] {
  const k = s.x.length;
  const span = Math.max(1, s.to - s.from);
  const idx = (uts: number) => Math.min(1, Math.max(0, (uts - s.from) / span)) * (k - 1);
  const out: string[] = [];
  for (let p = 0; p < pieces; p++) {
    const qa = idx(a + ((b - a) * p) / pieces);
    const qb = idx(a + ((b - a) * (p + 1)) / pieces);
    if (qb <= qa) {
      out.push("");
      continue;
    }
    const at = (q: number) => {
      const i = Math.min(k - 2, Math.floor(q));
      const f = q - i;
      return `${f1(s.x[i] + (s.x[i + 1] - s.x[i]) * f)} ${f1(s.y[i] + (s.y[i + 1] - s.y[i]) * f)}`;
    };
    const mid: string[] = [];
    for (let j = Math.floor(qa) + 1; j < qb; j++) mid.push(`${f1(s.x[j])} ${f1(s.y[j])}`);
    out.push(`M${at(qa)}L${[...mid, at(qb)].join(" ")}`);
  }
  return out;
}

/** How the spiral is stroked at a gap between turns: the prototype's dashed
    track and gold line while the turns stand apart (a few years), finer and
    fainter as they crowd, so the band never fills solid. */
export function spiralStrokes(gap: number): { baseWidth: number; baseOpacity: number; baseDash: string | undefined; doneWidth: number; doneOpacity: number } {
  if (gap >= 4.5) return { baseWidth: 1, baseOpacity: 0.26, baseDash: "1.2 3.2", doneWidth: 1.5, doneOpacity: 0.66 };
  // Each line at most half its gap, so dark always shows between turns; a
  // dashed track would shimmer against its neighbors, so it goes solid.
  const s = Math.min(1, Math.max(0, (gap - 1) / 3.5));
  return {
    baseWidth: Math.max(0.2, Math.min(1, gap * 0.3)),
    baseOpacity: 0.14 + 0.12 * s,
    baseDash: undefined,
    doneWidth: Math.max(0.25, Math.min(1.5, gap * 0.5)),
    doneOpacity: 0.3 + 0.36 * s,
  };
}

/** The bright tail behind the dial's moment: the last year at most. */
export const TAIL_SECONDS = YEAR;
