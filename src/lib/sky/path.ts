import { BODIES, longitude, type SkyBody } from "./sky";

/**
 * The wheel's path (spec 7.4, 8.11, and 18's "Build order after 3a"): each
 * body's longitude from now to a coming-up moment, so Tonight's wheel can
 * travel there and a planet that stations visibly slows and turns. The Moon
 * hourly, the rest daily, both ends included. The same longitude the wheel
 * draws (`sky.ts`: geocentric, tropical, apparent), to 0.01°.
 *
 * A pure function of the two rounded times, so the route caches it for good.
 * No sky data is read: this module may sit beside `sky.ts` in any bundle.
 */

export const HOUR = 3_600;
export const DAY = 86_400;
/** `to` at most this far past now (8.11: a coming-up moment, 45 days out). */
export const PATH_MAX_SECONDS = 45 * DAY;
export const PATH_STEP = { moon: HOUR, others: DAY } as const;

export type PathBodyId = "sun" | "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn";

export interface SkyPath {
  from: number;
  to: number;
  step: { moon: number; others: number };
  /** Sample i at `from + i * step`, the last exactly at `to`: for the daily
      series that last step is shorter when `to` isn't a whole day on. */
  bodies: Record<PathBodyId, number[]>;
}

/** Down to the hour. */
export const floorHour = (uts: number) => Math.floor(uts / HOUR) * HOUR;
/** To the nearest hour, half up. */
export const roundHour = (uts: number) => Math.round(uts / HOUR) * HOUR;

/** The instants a series samples: `from`, then each step, then `to` itself. */
export function sampleTimes(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  out.push(to);
  return out;
}

const lon = (body: SkyBody, t: number) => Math.round(longitude(body, new Date(t * 1000)) * 100) / 100;

/** Every body's longitudes from `from` to `to`, both already on the hour. */
export function skyPath(from: number, to: number): SkyPath {
  const bodies = {} as Record<PathBodyId, number[]>;
  for (const body of BODIES) {
    const times = sampleTimes(from, to, body === "Moon" ? PATH_STEP.moon : PATH_STEP.others);
    bodies[body.toLowerCase() as PathBodyId] = times.map((t) => lon(body, t));
  }
  return { from, to, step: { moon: PATH_STEP.moon, others: PATH_STEP.others }, bodies };
}

/**
 * `to` from the query, against `now`: a whole number of Unix seconds at most
 * 45 days after now, as given, so every coming-up moment (which is at most 45
 * days out) can be traveled to. Then `from` is now rounded down to the hour
 * and `to` rounded to the hour, which can put the two up to 45 days and an
 * hour and a half apart; `to` must not round to before `from`.
 */
export function parsePathQuery(raw: string | null, now: number): { from: number; to: number } | { error: string } {
  if (raw === null || !/^\d+$/.test(raw)) return { error: "to must be Unix seconds" };
  if (Number(raw) - now > PATH_MAX_SECONDS) return { error: "to must be at most 45 days from now" };
  const from = floorHour(now);
  const to = roundHour(Number(raw));
  if (to < from) return { error: "to must not be before now" };
  return { from, to };
}
