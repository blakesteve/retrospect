/**
 * Where the Sky view's wheel draws each planet's glyph (spec 8.6 item 2, 8.9):
 * on its own orbit at its true longitude, moved along the orbit where it
 * would cover a neighbor's glyph or retrograde mark. The orbits are 12 apart
 * and a glyph is 21 across, so two planets within a few degrees on
 * neighboring orbits drew over each other (ClickUp 86e3jrztm). Plain math, so
 * the wheel, its trips (`createTrips`'s `layout`) and its checks share it.
 *
 * Each glyph, and its ℞ when it has one, counts as a disc around its ink.
 * Apple Symbols' planets, outline included, reach 11.7 below where they're
 * anchored and 8.2 above (☿, ♀ and ♃'s crosses hang lowest; measured 17 Oct
 * 2026), so each disc sits 0.08 of the font size below the anchor and
 * reaches 0.55 of it: about as far as the widest, ♃, reaches with its
 * outline, `GAP` keeping two of them apart. Another font's ink is measured
 * where it's drawn (`e2e/sky.spec.ts` counts shared pixels in whatever font
 * the page used). Two planets' discs never meet, and only planets that would
 * meet move.
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
    on the 343px wheel at 375 (it was 12, 9.4px: ClickUp 86e3jrztm). */
export const retroMark = (body: string) => ({ dx: big(body) ? 16 : 13, dy: -10, size: 16 });

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
/** A glyph's disc: its center this far below the anchor, and its reach, each a share of the font size. */
const GLYPH = { drop: 0.08, reach: 0.55 };
/** The ℞'s: its ink reaches 7.1 below its anchor and 4.8 above at 16, outline included. */
const MARK = { drop: 0.07, reach: 0.45 };

type Disc = { x: number; y: number; r: number };

const discs = (g: OrbitGlyph, angle: number): Disc[] => {
  const [x, y] = pt(angle, g.r);
  const out = [{ x, y: y + GLYPH.drop * g.size, r: GLYPH.reach * g.size }];
  if (g.mark) out.push({ x: x + g.mark.dx, y: y + g.mark.dy + MARK.drop * g.mark.size, r: MARK.reach * g.mark.size });
  return out;
};

/** How far two planets' discs reach into each other, GAP included (≤ 0: they don't). */
export function overlap(a: OrbitGlyph, aAngle: number, b: OrbitGlyph, bAngle: number): number {
  let most = -Infinity;
  for (const p of discs(a, aAngle))
    for (const q of discs(b, bAngle)) most = Math.max(most, p.r + q.r + GAP - Math.hypot(p.x - q.x, p.y - q.y));
  return most;
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
  const [gx, gy] = pt(angle, g.r);
  return { x, y, beside: Math.hypot(x - gx, y - (gy + GLYPH.drop * g.size)) > BESIDE * g.size };
}
