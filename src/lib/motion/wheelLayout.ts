/**
 * Where the sky wheel draws each planet's glyph (spec 8.9): at its true
 * longitude, nudged apart where glyphs would overlap. Plain math, shared by
 * the wheel and its travel (8.11), so a trip can blend one layout into the
 * next instead of re-laying the glyphs every frame, which flips a pair's
 * order, and jumps them, as two planets cross.
 */

/** The wheel's drawing box and radii, in its own units. */
export const VB = 320;
export const C = VB / 2;
export const R0 = C - 3;
export const R1 = R0 * 0.8;
export const RP = R0 * 0.6;
export const RA = R0 * 0.36;

export const BODY_ORDER = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

/** A glyph's size: the Sun and Moon larger. */
export const glyphSize = (body: string) => VB * 0.074 * (body === "Sun" || body === "Moon" ? 1.32 : 1);

interface Placed {
  body: string;
  a: number;
  sz: number;
}

/** The least angle between two glyphs' centers, in degrees, so they don't touch. */
export const separation = (a: string, b: string) => (((glyphSize(a) + glyphSize(b)) / 2) * 1.28 * 180) / (RP * Math.PI);

/** Push glyphs that would overlap apart along the circle, symmetrically.
    Sorts `items` as it goes: pass a copy to keep an order. */
function relax(items: Placed[]) {
  for (let it = 0; it < 90 && items.length > 1; it++) {
    items.sort((x, y) => x.a - y.a);
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      const A = items[i];
      const B = items[(i + 1) % items.length];
      let d = B.a - A.a;
      if (i === items.length - 1) d += 360;
      const need = separation(A.body, B.body);
      if (d < need) {
        const push = (need - d) / 2 + 0.05;
        A.a -= push;
        B.a += push;
        moved = true;
      }
    }
    for (const x of items) x.a = ((x.a % 360) + 360) % 360;
    if (!moved) break;
  }
}

/** Each glyph's angle, by body: its true longitude, nudged clear of its neighbors. */
export function glyphAngles(bodies: readonly { body: string; longitude: number }[]): Record<string, number> {
  const items: Placed[] = BODY_ORDER.flatMap((body) => {
    const p = bodies.find((b) => b.body === body);
    return p ? [{ body, a: p.longitude, sz: glyphSize(body) }] : [];
  });
  relax([...items]);
  return Object.fromEntries(items.map((i) => [i.body, i.a]));
}
