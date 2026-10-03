/**
 * The wheel's travel (spec 8.11 item 1), as plain math: where each planet is
 * at any moment along the path `GET /api/sky/path` sends, and how long the
 * trip takes. No data and no DOM, so Tonight and the Sky view (3c) share it.
 */

export interface SkyPath {
  from: number;
  to: number;
  step: { moon: number; others: number };
  /** Longitudes in degrees, sample `i` at `from + i * step`; the last sample is `to`. */
  bodies: Record<string, number[]>;
}

const norm = (d: number) => ((d % 360) + 360) % 360;

/** The path's key for a body: "Sun" is `sun`. */
export const pathKey = (body: string) => body.toLowerCase();

/**
 * A body's longitude at `t` (unix seconds), between its two nearest samples,
 * the short way round, so a planet that stations slows, stops and turns as
 * its samples do. Outside the path it holds at the nearer end. `null` when
 * the path doesn't carry the body.
 */
export function lonAt(path: SkyPath, body: string, t: number): number | null {
  const key = pathKey(body);
  const samples = path.bodies[key];
  if (!samples || samples.length === 0) return null;
  const n = samples.length;
  if (n === 1 || t <= path.from) return samples[0];
  if (t >= path.to) return samples[n - 1];
  const step = key === "moon" ? path.step.moon : path.step.others;
  // Every sample sits on the step but the last, which is `to` itself.
  const i = Math.min(n - 2, Math.floor((t - path.from) / step));
  const t0 = path.from + i * step;
  const t1 = i + 1 === n - 1 ? path.to : t0 + step;
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = samples[i];
  const d = ((samples[i + 1] - a + 540) % 360) - 180;
  return norm(a + d * k);
}

/** The Orrery's easing (cubic in and out), from its prototype. */
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export const TRAVEL_MIN_MS = 420;
export const TRAVEL_MAX_MS = 1500;
/** The farthest coming-up moment, 45 days out (7.4), travels the longest. */
export const TRAVEL_MAX_DAYS = 45;

/**
 * How long the trip takes, by distance in time: 420ms for a moment an hour
 * away, rising evenly to 1,500ms at 45 days (8.11). The Orrery's own rule,
 * 420ms plus 1.1ms a day, is sized for years: at Tonight's 45 days it never
 * passes 470ms, too quick to see a planet station.
 */
export function travelMs(fromUts: number, toUts: number): number {
  const days = Math.abs(toUts - fromUts) / 86_400;
  const ms = TRAVEL_MIN_MS + ((TRAVEL_MAX_MS - TRAVEL_MIN_MS) * days) / TRAVEL_MAX_DAYS;
  return Math.round(Math.min(TRAVEL_MAX_MS, Math.max(TRAVEL_MIN_MS, ms)));
}

/** The longest a frame may advance the trip, so a hidden tab (no frames)
    picks up where it stopped rather than jumping to the end (8.11). */
export const MAX_FRAME_MS = 50;

/** The trip's time after a frame at `ts`: the previous frame's `elapsed`
    plus the gap since it, at most `MAX_FRAME_MS`; nothing on the first. */
export const nextElapsed = (elapsed: number, lastTs: number | null, ts: number) =>
  elapsed + (lastTs === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, ts - lastTs)));

/**
 * The moment the wheel shows `elapsed` ms into a trip from `fromUts` to
 * `toUts`, eased; `done` once the trip is over.
 */
export function travelAt(fromUts: number, toUts: number, elapsed: number, durationMs = travelMs(fromUts, toUts)): { t: number; done: boolean } {
  const k = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / durationMs));
  return { t: fromUts + (toUts - fromUts) * easeInOut(k), done: k >= 1 };
}
