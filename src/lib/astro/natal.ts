import { MakeTime, SiderealTime } from "astronomy-engine";
import { longitude, signOf, type Sign } from "@/lib/sky/sky";
import type { StoredBirth } from "@/lib/client/natalStore";

/**
 * Natal chart math. Runs happily in the browser — birth data never needs to
 * touch a server. Tropical zodiac throughout, matching the rest of the app.
 * Signs come from the one sky module (spec 7.2, 8.6), so a natal planet and
 * the wheel's agree at a boundary. The Sky view loads this with its sheet.
 */

/** The sign a longitude falls in: the sky module's own rule. */
export const signOfLongitude = (lon: number): Sign => signOf(lon);

export interface NatalPlacement {
  longitude: number; // ecliptic, degrees
  sign: Sign;
}

export interface NatalChart {
  sun: NatalPlacement;
  moon: NatalPlacement;
  mercury: NatalPlacement;
  venus: NatalPlacement;
  mars: NatalPlacement;
  /** Requires birth time AND coordinates; null without them. */
  rising: NatalPlacement | null;
}

const DEG = Math.PI / 180;
/** Mean obliquity of the ecliptic, J2000-ish — plenty for sign-level work. */
const OBLIQUITY = 23.4367 * DEG;

/**
 * Ecliptic longitude of the ascendant: the point of the ecliptic rising on
 * the eastern horizon. Standard formula from local sidereal time + latitude.
 */
export function ascendantLongitude(utc: Date, latitudeDeg: number, longitudeDeg: number): number {
  const time = MakeTime(utc);
  const gstHours = SiderealTime(time); // Greenwich apparent sidereal time
  const lstDeg = (gstHours * 15 + longitudeDeg) % 360; // local sidereal time → RAMC
  const ramc = lstDeg * DEG;
  const lat = latitudeDeg * DEG;

  const asc = Math.atan2(
    Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(OBLIQUITY) + Math.tan(lat) * Math.sin(OBLIQUITY))
  );
  return ((asc / DEG) % 360 + 360) % 360;
}


export function computeNatalChart(
  utc: Date,
  coords?: { latitude: number; longitude: number } | null
): NatalChart {
  const place = (lon: number): NatalPlacement => ({
    longitude: lon,
    sign: signOfLongitude(lon),
  });

  // Every longitude from the sky module, as the wheel's are.
  return {
    sun: place(longitude("Sun", utc)),
    moon: place(longitude("Moon", utc)),
    mercury: place(longitude("Mercury", utc)),
    venus: place(longitude("Venus", utc)),
    mars: place(longitude("Mars", utc)),
    rising: coords ? place(ascendantLongitude(utc, coords.latitude, coords.longitude)) : null,
  };
}

/** The chart for a saved birth: the date and time at its UTC offset, and
    the rising sign only with a place below the polar circles. Null when the
    date doesn't read. */
export function chartFromBirth(b: StoredBirth): NatalChart | null {
  if (!b.date) return null;
  const [y, m, d] = b.date.split("-").map(Number);
  const [hh, mm] = (b.time || "12:00").split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - b.offset * 3600 * 1000;
  if (!Number.isFinite(utcMs)) return null;
  const lat = parseFloat(b.lat);
  const lon = parseFloat(b.lon);
  const coords = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 66 ? { latitude: lat, longitude: lon } : null;
  return computeNatalChart(new Date(utcMs), coords);
}
