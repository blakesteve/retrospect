// Retrospect: lunar + solar eclipse windows (peak ±60h) with the Moon's
// tropical sign at peak. Same output shape as the other ephemeris scripts.
//
// Usage: node scripts/eclipses.mjs [startYear] [endYear]
// Output: data/eclipses.json

import {
  SearchLunarEclipse,
  NextLunarEclipse,
  SearchGlobalSolarEclipse,
  NextGlobalSolarEclipse,
  EclipticGeoMoon,
} from 'astronomy-engine';
import { writeFileSync, mkdirSync } from 'node:fs';

const startYear = Number(process.argv[2] ?? 2002);
const endYear = Number(process.argv[3] ?? 2026);

const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];
const signOf = (lon) => SIGNS[Math.floor(((lon % 360) + 360) % 360 / 30)];

const HOURS_60 = 60 * 3600 * 1000;
const startDate = new Date(Date.UTC(startYear, 0, 1));
const limit = Date.UTC(endYear + 1, 0, 1);

console.error(`Scanning eclipses ${startYear}–${endYear}...`);
const t0 = Date.now();
const windows = [];

let lunar = SearchLunarEclipse(startDate);
while (lunar.peak.date.getTime() < limit) {
  windows.push({
    start: new Date(lunar.peak.date.getTime() - HOURS_60).toISOString(),
    end: new Date(lunar.peak.date.getTime() + HOURS_60).toISOString(),
    peak: lunar.peak.date.toISOString(),
    kind: `${lunar.kind} lunar`,
    sign: signOf(EclipticGeoMoon(lunar.peak).lon),
    signAtDirect: signOf(EclipticGeoMoon(lunar.peak).lon),
  });
  lunar = NextLunarEclipse(lunar.peak);
}

let solar = SearchGlobalSolarEclipse(startDate);
while (solar.peak.date.getTime() < limit) {
  const sign = signOf(EclipticGeoMoon(solar.peak).lon); // new moon: Moon conjunct Sun
  windows.push({
    start: new Date(solar.peak.date.getTime() - HOURS_60).toISOString(),
    end: new Date(solar.peak.date.getTime() + HOURS_60).toISOString(),
    peak: solar.peak.date.toISOString(),
    kind: `${solar.kind} solar`,
    sign,
    signAtDirect: sign,
  });
  solar = NextGlobalSolarEclipse(solar.peak);
}

windows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

mkdirSync('data', { recursive: true });
writeFileSync(
  'data/eclipses.json',
  JSON.stringify({ body: 'Eclipses', generatedBy: 'astronomy-engine', startYear, endYear, windows }, null, 2)
);
console.error(`Found ${windows.length} eclipses in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const w of windows.slice(-4)) console.error(`  ${w.peak.slice(0, 10)} ${w.kind} in ${w.sign}`);
