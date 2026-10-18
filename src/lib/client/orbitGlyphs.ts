/**
 * Where the Sky view's wheel draws each planet's glyph (spec 8.6 item 2, 8.9):
 * on its own orbit at its true longitude, moved along the orbit where it
 * would cover a neighbor's glyph or retrograde mark. The orbits are 12 apart
 * and a glyph is 21 across, so two planets within a few degrees on
 * neighboring orbits drew over each other (ClickUp 86e3jrztm). Plain math, so
 * the wheel, its trips (`createTrips`'s `layout`) and its checks share it.
 *
 * The wheels draw their glyphs in their own font, Retrospect Sky Glyphs
 * (`public/fonts`, cut by `scripts/sky-glyph-font.py`), so the ink is the
 * same on every machine. Before it, Apple Symbols drew them on a Mac, and
 * CI's Linux fallback drew a ℞ into Mercury. Each glyph, and its ℞ when it
 * has one, counts as the least circle around its outline points and its
 * drawn outline, measured from that font (`INK`, `MARK`). Two planets'
 * circles never meet, with `GAP` to spare, and only planets that would meet
 * move.
 *
 * Two planets that would meet keep their order. Each such pair gets the
 * least angle between them that keeps them apart, read off the drawing at
 * the pair's place on the wheel, and the angles are spread to meet those
 * from the true places. Pairs that never meet (orbits far enough apart) may
 * be drawn in either order.
 */

import { pt } from "./spiral";

/** Each orbit's radius, and the rings around them: the Orrery's, the orbits
    drawn a little tighter so the natal planets get a ring of their own (nt)
    just inside the signs, their glyphs 16px at 375 like every other (10).
    The drawing is 436 across, centered on 0. */
export const RR = {
  c: 40,
  Moon: 53,
  Mercury: 65,
  Venus: 77,
  Sun: 89,
  Mars: 101,
  Jupiter: 113,
  Saturn: 125,
  nt: 139,
  zi: 150,
  zo: 181,
  si: 189,
  so: 207,
} as const;
export const ORBITS = ["Moon", "Mercury", "Venus", "Sun", "Mars", "Jupiter", "Saturn"] as const;
export type OrbitBody = (typeof ORBITS)[number];

const big = (body: string) => body === "Sun" || body === "Moon";
/** A planet's glyph size, the Sun and Moon larger. */
export const orbitGlyphSize = (body: string) => (big(body) ? 26 : 21);
/** The ℞ beside a retrograde planet: up and to its right, 16 across, so 12.6px
    on the 343px wheel at 375 (it was 12, 9.4px: ClickUp 86e3jrztm). 14 to the
    right, its ink and outline clear the widest planet's, Jupiter's (13 met it
    by 0.2); the Sun and Moon are never retrograde. */
export const retroMark = (body: string) => ({ dx: big(body) ? 16 : 14, dy: -10, size: 16 });

export interface OrbitGlyph {
  body: string;
  longitude: number;
  /** The orbit's radius. */
  r: number;
  /** The glyph's font size. */
  size: number;
  /** The ℞, as drawn beside the glyph: its anchor from the glyph's, on screen, and its font size. */
  mark: { dx: number; dy: number; size: number } | null;
}

/** A planet as the Sky view draws it, or null for a body with no orbit. */
export function orbitGlyph(b: { body: string; longitude: number; retrograde: boolean }): OrbitGlyph | null {
  if (!ORBITS.includes(b.body as OrbitBody)) return null;
  return { body: b.body, longitude: b.longitude, r: RR[b.body as OrbitBody], size: orbitGlyphSize(b.body), mark: b.retrograde ? retroMark(b.body) : null };
}

/** Room left between two planets' discs, in the drawing's units. */
export const GAP = 1;
/** Each glyph's least circle in Retrospect Sky Glyphs, outline (4.5) included,
    in shares of its font size: its center from the anchor (x from the middle
    of its advance, y down, the baseline .35em below) and its reach. Measured
    17 Oct 2026 from the font's outline points, which bound its curves. */
export const INK: Record<OrbitBody, { cx: number; cy: number; reach: number }> = {
  Sun: { cx: 0, cy: -0.003, reach: 0.479 },
  Moon: { cx: -0.107, cy: -0.003, reach: 0.444 },
  Mercury: { cx: 0, cy: -0.031, reach: 0.541 },
  Venus: { cx: 0, cy: 0.02, reach: 0.438 },
  Mars: { cx: 0.028, cy: 0.055, reach: 0.438 },
  Jupiter: { cx: 0.049, cy: 0.003, reach: 0.529 },
  Saturn: { cx: 0.019, cy: -0.026, reach: 0.537 },
};
/** The ℞'s, its outline 3. */
export const MARK = { cx: 0.042, cy: -0.007, reach: 0.533 };

type Disc = { x: number; y: number; r: number };

/** A glyph's ink circle where it's drawn. */
const inkDisc = (g: OrbitGlyph, angle: number): Disc => {
  const [x, y] = pt(angle, g.r);
  const ink = INK[g.body as OrbitBody];
  return { x: x + ink.cx * g.size, y: y + ink.cy * g.size, r: ink.reach * g.size };
};

const discs = (g: OrbitGlyph, angle: number): Disc[] => {
  const out = [inkDisc(g, angle)];
  if (g.mark) {
    const [x, y] = pt(angle, g.r);
    out.push({ x: x + g.mark.dx + MARK.cx * g.mark.size, y: y + g.mark.dy + MARK.cy * g.mark.size, r: MARK.reach * g.mark.size });
  }
  return out;
};

/** How far two planets' discs reach into each other, GAP included (≤ 0: they don't). */
export function overlap(a: OrbitGlyph, aAngle: number, b: OrbitGlyph, bAngle: number): number {
  let most = -Infinity;
  for (const p of discs(a, aAngle))
    for (const q of discs(b, bAngle)) most = Math.max(most, p.r + q.r + GAP - Math.hypot(p.x - q.x, p.y - q.y));
  return most;
}

/** Where a moved glyph's orbit leaves its ink circle on the way to its true
    place, as an angle; null when the true place is inside the circle. */
export function arcEdge(g: OrbitGlyph, angle: number): number | null {
  const ink = inkDisc(g, angle);
  const toward = turn(angle, g.longitude);
  const outside = (t: number) => {
    const [x, y] = pt(angle + t * toward, g.r);
    return Math.hypot(x - ink.x, y - ink.y) > ink.r;
  };
  if (!outside(1)) return null;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (outside(m)) hi = m;
    else lo = m;
  }
  return angle + hi * toward;
}

/** Whether `b`'s true place falls inside another planet's glyph or ℞, where
    it's drawn: a dot under it would be hidden, so it's drawn over it. In a
    tight cluster the middle planet's glyph can't clear both neighbors' true
    places, which sit either side of it at nearly the same angle. */
export function placeCovered(b: OrbitGlyph, others: readonly [OrbitGlyph, number][]): boolean {
  const [x, y] = pt(b.longitude, b.r);
  return others.some(([a, angle]) => a.body !== b.body && discs(a, angle).some((p) => Math.hypot(p.x - x, p.y - y) < p.r));
}

/** From `from` to `to`, the short way round, in degrees (-180 to 180). */
export const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/** Planets this far apart, or more, never meet. */
const NEAR = 60;
/** The least angle between a pair that met, so its order shows, in degrees. */
const ORDERED = 0.5;

/** The least angle `b` stands ahead of `a`, about `mid`, beyond which they never meet; 0 if they never do. */
function leastApart(a: OrbitGlyph, b: OrbitGlyph, mid: number): number {
  const meet = (d: number) => overlap(a, mid - d / 2, b, mid + d / 2) > 0;
  let last = -1;
  for (let d = 0; d <= 45; d += 0.25) if (meet(d)) last = d;
  if (last < 0) return 0;
  // Between the last angle they meet at and the next they don't.
  let lo = last;
  let hi = last + 0.25;
  for (let k = 0; k < 20; k++) {
    const m = (lo + hi) / 2;
    if (meet(m)) lo = m;
    else hi = m;
  }
  return hi + 0.05;
}

/** Each glyph's angle, by body: its true longitude, or moved along its orbit clear of its neighbors, in their order. */
export function orbitGlyphAngles(glyphs: readonly OrbitGlyph[]): Record<string, number> {
  const n = glyphs.length;
  if (n < 2) return Object.fromEntries(glyphs.map((g) => [g.body, g.longitude]));
  const rank = (g: OrbitGlyph) => ORBITS.indexOf(g.body as OrbitBody);
  // Round the circle in true order, from just after its widest gap, the
  // angles unwrapped so they only increase.
  const byLon = [...glyphs].sort((p, q) => p.longitude - q.longitude || rank(p) - rank(q));
  let start = 0;
  let widest = -1;
  for (let i = 0; i < n; i++) {
    const gap = (byLon[i].longitude - byLon[(i + n - 1) % n].longitude + 360) % 360;
    if (gap > widest) [widest, start] = [gap, i];
  }
  const seq = [...byLon.slice(start), ...byLon.slice(0, start)];
  const u = seq.map((g) => g.longitude);
  for (let i = 1; i < n; i++) while (u[i] < u[i - 1]) u[i] += 360;
  // A pair's true and drawn separation in that order (the last and first across the gap).
  const pairs: [number, number][] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (u[b] - u[a] < NEAR || u[a] + 360 - u[b] < NEAR) pairs.push([a, b]);
  const apart = (x: number[], a: number, b: number) => (u[b] - u[a] < NEAR ? x[b] - x[a] : x[a] + 360 - x[b]);
  const lead = (a: number, b: number): [number, number] => (u[b] - u[a] < NEAR ? [a, b] : [b, a]);

  let x = u.slice();
  // A pair that meets, at its true places or where it's been moved to, keeps
  // its order from then on, at least `ORDERED` apart whatever angle it needs
  // where it ends up; the rest may pass each other freely.
  const met = new Set<number>();
  for (let round = 0; round < 8; round++) {
    for (const [a, b] of pairs) if (overlap(seq[a], x[a], seq[b], x[b]) > 0) met.add(a * n + b);
    const need = pairs.flatMap(([a, b]) => {
      if (!met.has(a * n + b)) return [];
      const [p, q] = lead(a, b);
      return [{ a, b, least: Math.max(ORDERED, leastApart(seq[p], seq[q], x[p] + apart(x, a, b) / 2)) }];
    });
    x = u.slice();
    for (let it = 0; it < 4000; it++) {
      let short = 0;
      for (const { a, b, least } of need) {
        const d = apart(x, a, b);
        if (d >= least) continue;
        const push = (least - d) / 2;
        const [p, q] = lead(a, b);
        x[p] -= push;
        x[q] += push;
        short = Math.max(short, least - d);
      }
      if (short < 1e-4) break;
    }
    if (pairs.every(([a, b]) => overlap(seq[a], x[a], seq[b], x[b]) <= 0)) break;
  }
  return Object.fromEntries(seq.map((g, i) => [g.body, ((x[i] % 360) + 360) % 360]));
}

/** How far each planet's glyph stands off its longitude, in degrees, by body. */
export function glyphNudges(bodies: readonly { body: string; longitude: number; retrograde: boolean }[]): Record<string, number> {
  const glyphs = bodies.flatMap((b) => orbitGlyph(b) ?? []);
  const at = orbitGlyphAngles(glyphs);
  return Object.fromEntries(glyphs.map((g) => [g.body, turn(g.longitude, at[g.body])]));
}

/** The Sky view's layout for its trips (`createTrips`): each orbit planet's glyph angle. */
export const skyGlyphLayout = (bodies: readonly { body: string; longitude: number; retrograde?: boolean }[]) =>
  orbitGlyphAngles(bodies.flatMap((b) => orbitGlyph({ ...b, retrograde: b.retrograde ?? false }) ?? []));

/** Whether a glyph stands off its true longitude at all. */
export const movedOff = (longitude: number, angle: number) => Math.abs(turn(longitude, angle)) > 0.5;

/** How far from a glyph's ink center its true place may be before it's marked, as a share of the font size. */
export const BESIDE = 0.45;

/** A glyph's true place on its orbit, and whether it falls beside the glyph's
    ink, so a dot marks it; nearer, the glyph still stands over its true place. */
export function truePlace(g: OrbitGlyph, angle: number): { x: number; y: number; beside: boolean } {
  const [x, y] = pt(g.longitude, g.r);
  const ink = inkDisc(g, angle);
  return { x, y, beside: Math.hypot(x - ink.x, y - ink.y) > BESIDE * g.size };
}
