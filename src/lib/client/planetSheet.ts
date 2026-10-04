/**
 * The planet sheet's URL value (spec 8.7.4, 4): "venus" for tonight, or
 * "venus-2024-05-10" for the planet on a past night, as the Sky view's dial
 * opens it. One value, so a sheet stays one search parameter.
 */

export const PLANET_IDS = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"] as const;
export type PlanetId = (typeof PLANET_IDS)[number];

// Parsed before it's printed: an impossible month or day doesn't parse, and printing it would throw.
const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

/** The planet and its night (null for tonight), or null for a value no sheet takes: an unknown planet, a date that isn't one, or a night after `today`. */
export function planetSheetValue(value: string, today: string): { body: PlanetId; night: string | null } | null {
  const m = /^([a-z]+)(?:-(.+))?$/.exec(value);
  if (!m || !(PLANET_IDS as readonly string[]).includes(m[1])) return null;
  const night = m[2] ?? null;
  if (night !== null && (!isDate(night) || night > today)) return null;
  return { body: m[1] as PlanetId, night };
}

/** The value for a planet, on a night, or tonight when the night is tonight or unknown. */
export const planetSheetRef = (body: string, night: string | null, today: string): string =>
  night === null || night >= today ? body.toLowerCase() : `${body.toLowerCase()}-${night}`;
