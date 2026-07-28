// Retrospect: compute full moon windows (±36h around the exact instant) with
// the Moon's tropical zodiac sign at peak. Same output shape as the
// retrograde scripts so the analysis machinery is reusable.
//
// Usage: node scripts/full-moons.mjs [startYear] [endYear]
// Output: data/full-moons.json

import { SearchMoonPhase, EclipticGeoMoon, MakeTime } from 'astronomy-engine';
import { writeFileSync, mkdirSync } from 'node:fs';

const startYear = Number(process.argv[2] ?? 2002);
const endYear = Number(process.argv[3] ?? 2026);

const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];
const signOf = (lon) => SIGNS[Math.floor(((lon % 360) + 360) % 360 / 30)];

const HOURS_36 = 36 * 3600 * 1000;
const limit = Date.UTC(endYear + 1, 0, 1);

console.error(`Scanning full moons ${startYear}–${endYear}...`);
const t0 = Date.now();

const windows = [];
let cursor = MakeTime(new Date(Date.UTC(startYear, 0, 1)));
for (;;) {
  const fm = SearchMoonPhase(180, cursor, 40); // 180° = full
  if (!fm || fm.date.getTime() > limit) break;
  const sign = signOf(EclipticGeoMoon(fm).lon);
  windows.push({
    start: new Date(fm.date.getTime() - HOURS_36).toISOString(),
    end: new Date(fm.date.getTime() + HOURS_36).toISOString(),
    peak: fm.date.toISOString(),
    sign,
    signAtDirect: sign,
  });
  cursor = MakeTime(new Date(fm.date.getTime() + 20 * 86400 * 1000));
}

mkdirSync('data', { recursive: true });
writeFileSync(
  'data/full-moons.json',
  JSON.stringify({ body: 'Moon', generatedBy: 'astronomy-engine', startYear, endYear, windows }, null, 2)
);
console.error(`Found ${windows.length} full moons in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(windows.length / (endYear - startYear + 1)).toFixed(1)}/yr)`);
console.error(`Last: ${windows.at(-1).peak.slice(0, 10)} in ${windows.at(-1).sign}`);
