import { bodiesAt, longitude, moonPhaseAngle, type BodyAtWithWords } from "@/lib/sky/sky";
import { pathKey, type SkyPath } from "@/lib/motion/wheelPath";

/**
 * The Sky view's sky (spec 8.6), computed in the browser by the one sky
 * module the routes serve from (7.2), so the wheel and the server can't
 * disagree at a sign boundary. astronomy-engine comes with it, about 47 KB,
 * so the view loads this after its first paint (13): the wheel's first frame
 * is tonight's sky from the server.
 */

/** A planet's standing in a sign, the halo's word: the selected planet's
    tint for each sector, and a traveling planet's halo (8.6); and the sign
    a longitude falls in. */
export { haloDignity, signOf } from "@/lib/sky/sky";

/** The seven bodies at an instant (unix seconds), as the routes send them. */
export const skyBodies = (uts: number): BodyAtWithWords[] => bodiesAt(new Date(uts * 1000));

/** The Sun's longitude at an instant: where a song's star sits on the rim. */
export const sunLongitude = (uts: number): number => longitude("Sun", new Date(uts * 1000));

/** The Moon's phase angle at an instant: 0 new, 180 full. */
export const moonPhase = (uts: number): number => moonPhaseAngle(new Date(uts * 1000));

/** The Moon's lit fraction at an instant, 0 to 1, from its phase angle. */
export const moonLight = (uts: number): number => (1 - Math.cos((moonPhase(uts) * Math.PI) / 180)) / 2;

const HOUR = 3600;
const DAY = 86_400;
/** About the most samples a trip asks for, for each planet. */
export const MAX_SAMPLES = 200;
/** The Moon's samples are at most 8 days apart: it moves about 13° a day,
    and the path is read the short way round between samples, so past about
    12 days a step would turn it backward. A step shorter than that over a
    long trip costs time for nothing. */
export const MOON_STEP_MAX = 8 * 86_400;
const MOON_SAMPLES = 1000;

/**
 * The planets' path between two moments, either way round, in the shape
 * `GET /api/sky/path` sends (7.4): sample `i` at `from + i * step`, the last
 * at `to` itself. Daily for the planets and hourly for the Moon, as the
 * server's, until a trip is long enough to pass about 200 samples a planet
 * or 1,000 for the Moon; then the step grows, the Moon's to at most 8 days,
 * so a trip across 25 years costs about 2,400 positions, computed on the
 * press. Past about 41 days the Moon's samples spread out, where its turns
 * blur at a trip's 1.5 seconds anyway.
 */
export function skyPath(fromUts: number, toUts: number): SkyPath {
  const from = Math.min(fromUts, toUts);
  const to = Math.max(fromUts, toUts);
  const span = Math.max(1, to - from);
  const others = Math.max(DAY, Math.ceil(span / MAX_SAMPLES / DAY) * DAY);
  const moon = Math.min(MOON_STEP_MAX, Math.max(HOUR, Math.ceil(span / MOON_SAMPLES / HOUR) * HOUR));
  const series = (body: "Sun" | "Moon" | "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn", step: number) => {
    const out: number[] = [];
    for (let t = from; t < to; t += step) out.push(longitude(body, new Date(t * 1000)));
    out.push(longitude(body, new Date(to * 1000)));
    return out;
  };
  const bodies: Record<string, number[]> = {};
  for (const body of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const) {
    bodies[pathKey(body)] = series(body, body === "Moon" ? moon : others);
  }
  return { from, to, step: { moon, others }, bodies };
}
