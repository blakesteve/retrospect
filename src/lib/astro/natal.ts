import {
  Body,
  Ecliptic,
  EclipticGeoMoon,
  GeoVector,
  MakeTime,
  SiderealTime,
  SunPosition,
} from "astronomy-engine";
import type { ZodiacSign } from "@/lib/ephemeris/retrogrades";

/**
 * Natal chart math. Runs happily in the browser — birth data never needs to
 * touch a server. Tropical zodiac throughout, matching the rest of the app.
 */

const SIGNS: ZodiacSign[] = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

export function signOfLongitude(lon: number): ZodiacSign {
  return SIGNS[Math.floor((((lon % 360) + 360) % 360) / 30)];
}

export interface NatalPlacement {
  longitude: number; // ecliptic, degrees
  sign: ZodiacSign;
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

function planetLongitude(body: Body, utc: Date): number {
  const vec = GeoVector(body, MakeTime(utc), true);
  return Ecliptic(vec).elon;
}

export function computeNatalChart(
  utc: Date,
  coords?: { latitude: number; longitude: number } | null
): NatalChart {
  const time = MakeTime(utc);
  const place = (lon: number): NatalPlacement => ({
    longitude: lon,
    sign: signOfLongitude(lon),
  });

  return {
    sun: place(SunPosition(time).elon),
    moon: place(EclipticGeoMoon(time).lon),
    mercury: place(planetLongitude(Body.Mercury, utc)),
    venus: place(planetLongitude(Body.Venus, utc)),
    mars: place(planetLongitude(Body.Mars, utc)),
    rising: coords ? place(ascendantLongitude(utc, coords.latitude, coords.longitude)) : null,
  };
}
