import { Body, Equator, Horizon, Observer, SearchLocalSolarEclipse, SearchLunarEclipse } from "astronomy-engine";
import tz from "@/data/tz/cities.json";

/**
 * Whether an eclipse could be seen from a listener's zone (spec 7.5,
 * changed 2 Oct 2026): a ranking rule for the wild nights only. No copy ever
 * names the city, which isn't the listener's. SERVER ONLY.
 *
 * The zone's principal city is IANA's (tzdata 2026b, github.com/eggert/tz
 * at tag 2026b): from `zone.tab` first, one zone per country with its own
 * city, then `zone1970.tab`, which merges zones that have kept the same clocks
 * since 1970 (so Atlantic/Reykjavik there is Abidjan's; ruling, 3 Oct 2026).
 * Each is looked up under the zone's own name and through `backward`'s links
 * both ways: V8 reports old names (Asia/Calcutta, Europe/Kiev, Asia/Saigon)
 * that the tables list under their new ones. `scripts/zone-cities.mjs` turns
 * the three committed files into `src/data/tz/cities.json`. A zone with no
 * city (UTC, Etc/*) sees every eclipse.
 *
 * Visible means a solar eclipse covering at least 10% of the Sun at its
 * local peak with the Sun up there, or the Moon up at a lunar eclipse's
 * greatest moment. Both are pure functions of the zone and the eclipse, so
 * they're kept in memory.
 */

const BY_COUNTRY = tz.byCountry as unknown as Record<string, [number, number]>;
const CITIES = tz.cities as unknown as Record<string, [number, number]>;
const LINKS = tz.links as Record<string, string>;

/** At least this share of the Sun's disc covered, at the local peak. */
export const MIN_OBSCURATION = 0.1;

/** The decision for a solar eclipse (7.5): at least 10% of the Sun covered,
    with the Sun above the horizon, both at the local peak. Degrees,
    refraction included. */
export const solarSeen = (obscuration: number, altitude: number) => obscuration >= MIN_OBSCURATION && altitude > 0;

/** The decision for a lunar eclipse (7.5): the Moon above the horizon at
    greatest eclipse. */
export const lunarSeen = (altitude: number) => altitude > 0;
const DAY = 86_400;

const cities = new Map<string, { lat: number; lon: number } | null>();

/** A zone's city in these tables: under its own name, the zone its link
    names (Asia/Calcutta to Asia/Kolkata), or any old name linked to it, for
    a table that lists the zone under one. Null for a zone with none. */
export function findCity(
  zone: string,
  table: Record<string, [number, number]> = CITIES,
  links: Record<string, string> = LINKS,
): { lat: number; lon: number } | null {
  const old = Object.keys(links).filter((name) => links[name] === zone);
  const hit = [zone, links[zone], ...old].filter((z): z is string => !!z).map((z) => table[z]).find(Boolean);
  return hit ? { lat: hit[0], lon: hit[1] } : null;
}

/** The zone's principal city, from zone.tab, else zone1970.tab, or null for
    a zone with none (UTC, Etc/*). */
export function cityOf(zone: string): { lat: number; lon: number } | null {
  if (!cities.has(zone)) cities.set(zone, findCity(zone, BY_COUNTRY) ?? findCity(zone, CITIES));
  return cities.get(zone)!;
}

export interface EclipseView {
  /** Solar: the share of the Sun's disc covered at the local peak, 0 to 1,
      or 0 when the local search finds a different eclipse (none here).
      Lunar: null. */
  obscuration: number | null;
  /** Degrees above the horizon at the local peak: the Sun's for a solar
      eclipse, the Moon's for a lunar one. Null for a solar eclipse that
      doesn't reach the city. */
  altitude: number | null;
  visible: boolean;
}

const views = new Map<string, EclipseView>();

/**
 * An eclipse as the zone's principal city saw it. `kind` is the sky data's
 * ("total solar", "total lunar"), `peak` its greatest eclipse in Unix
 * seconds. A zone with no city reads as visible.
 */
export function eclipseView(zone: string, kind: string, peak: number): EclipseView {
  const key = `${zone}|${kind}|${peak}`;
  const known = views.get(key);
  if (known) return known;
  const city = cityOf(zone);
  let view: EclipseView;
  if (!city) view = { obscuration: null, altitude: null, visible: true };
  else {
    const observer = new Observer(city.lat, city.lon, 0);
    const from = new Date((peak - DAY) * 1000);
    if (kind.endsWith("solar")) {
      // From a day before: a search that finds a later eclipse means none reached the city.
      const e = SearchLocalSolarEclipse(from, observer);
      const same = Math.abs(e.peak.time.date.getTime() / 1000 - peak) < DAY;
      view = same
        ? { obscuration: e.obscuration, altitude: e.peak.altitude, visible: solarSeen(e.obscuration, e.peak.altitude) }
        : { obscuration: 0, altitude: null, visible: false };
    } else {
      const e = SearchLunarEclipse(from);
      const eq = Equator(Body.Moon, e.peak, observer, true, true);
      const altitude = Horizon(e.peak, observer, eq.ra, eq.dec, "normal").altitude;
      view = { obscuration: null, altitude, visible: lunarSeen(altitude) };
    }
  }
  views.set(key, view);
  return view;
}

/** Whether the zone's principal city saw it (7.5). */
export const eclipseVisible = (zone: string, kind: string, peak: number): boolean => eclipseView(zone, kind, peak).visible;
