/**
 * The circular rotation test (spec 6.1), run by rotating the windows instead
 * of the plays.
 *
 * Today's test asks, 2,000 times: after shifting every play by `o` seconds
 * around the span, how many land inside the windows? Rotating the windows by
 * `-o` asks the same question of the same seconds, so the counts are equal,
 * not approximately equal. Write a play's place in the span as
 * `(t - S) mod L`; a window, as whole seconds of the span, is `[ceil(a) - S,
 * floor(b) - S]`, clipped to `[0, L - 1]`. The moved play is inside exactly
 * when its place lies in the window moved back by `o`: one interval, or two
 * when it wraps. With the places sorted once, each window costs two binary
 * searches, and a running count of tagged plays gives the tagged count.
 *
 * So a question costs rotations x windows x log(plays), not rotations x plays
 * x log(windows): 1.88 s for all 12 on a 499,969-play history, against 160 s
 * (step 0, local). `rotation.test.ts` holds the two to identical counts.
 */

/** Plays as places in the circular span, sorted, with a running tagged count. */
export interface Circle {
  /** Sorted places, `(t - S) mod L`. */
  pos: Float64Array;
  /** `tagPrefix[k]` is how many of the first `k` places are tagged. */
  tagPrefix: Int32Array;
  n: number;
  L: number;
}

/** `times` must lie in `[S, S + L]`. A play exactly at the span's end lands on
    0, as it does in today's per-play rotation. */
export function circle(times: number[], tags: boolean[] | null, S: number, L: number): Circle {
  const n = times.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const place = times.map((t) => (((t - S) % L) + L) % L);
  order.sort((a, b) => place[a] - place[b]);
  const pos = new Float64Array(n);
  const tagPrefix = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) {
    pos[k] = place[order[k]];
    tagPrefix[k + 1] = tagPrefix[k] + (tags && tags[order[k]] ? 1 : 0);
  }
  return { pos, tagPrefix, n, L };
}

/** A window as whole seconds of the span, or null when none of it is inside.
    Bounds are inclusive, as today's lookup is. */
export function place(start: number, end: number, S: number, L: number): [number, number] | null {
  const lo = Math.max(Math.ceil(start) - S, 0);
  const hi = Math.min(Math.floor(end) - S, L - 1);
  return lo <= hi ? [lo, hi] : null;
}

function lowerBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Plays, and tagged plays, whose place moved forward by `o` lands in the
    placed window `[lo, hi]`. Written into `out` to spare an allocation in the
    hot loop. */
export function countRotated(c: Circle, lo: number, hi: number, o: number, out: [number, number]): void {
  const L = c.L;
  const x = (((lo - o) % L) + L) % L;
  const y = (((hi - o) % L) + L) % L;
  if (x <= y) {
    const i = lowerBound(c.pos, x);
    const j = upperBound(c.pos, y);
    out[0] = j - i;
    out[1] = c.tagPrefix[j] - c.tagPrefix[i];
    return;
  }
  const i1 = lowerBound(c.pos, x);
  const j2 = upperBound(c.pos, y);
  out[0] = c.n - i1 + j2;
  out[1] = c.tagPrefix[c.n] - c.tagPrefix[i1] + c.tagPrefix[j2];
}

/** The rotations' offsets, as fractions of the span (spec 6.6), so a history
    that grows by a day reuses nearly the same shuffles. */
export const offsetOf = (u: number, L: number) => Math.floor(u * L);
