// Retrospect spike: compute Mercury retrograde windows from real ephemeris math.
// Method: sample Mercury's geocentric ecliptic longitude on a coarse daily grid,
// detect sign changes in apparent motion, then bisect to ~1-minute station times.
//
// Usage: node scripts/retrograde-windows.mjs [startYear] [endYear] [body]
// Output: data/<body>-retrogrades.json

import { GeoVector, Ecliptic, Body, MakeTime } from 'astronomy-engine';
import { writeFileSync, mkdirSync } from 'node:fs';

const startYear = Number(process.argv[2] ?? 2002); // Last.fm launched March 2002
const endYear = Number(process.argv[3] ?? 2026);
const bodyName = process.argv[4] ?? 'Mercury';
const body = Body[bodyName];
if (!body) throw new Error(`Unknown body: ${bodyName}`);

// Geocentric ecliptic longitude in degrees, with aberration correction.
function elon(date) {
  const vec = GeoVector(body, MakeTime(date), true);
  return Ecliptic(vec).elon;
}

// Apparent daily motion (deg/day) via symmetric difference over ±6h.
// Positive = direct (prograde), negative = retrograde.
const H6 = 6 * 3600 * 1000;
function motion(date) {
  const a = elon(new Date(date.getTime() - H6));
  const b = elon(new Date(date.getTime() + H6));
  let d = b - a;
  if (d > 180) d -= 360; // unwrap 360° rollover
  if (d < -180) d += 360;
  return d / 0.5; // per day
}

// Bisect a station (motion sign change) between two dates down to 1 minute.
function bisectStation(lo, hi) {
  const mLo = motion(lo);
  while (hi.getTime() - lo.getTime() > 60 * 1000) {
    const mid = new Date((lo.getTime() + hi.getTime()) / 2);
    if (Math.sign(motion(mid)) === Math.sign(mLo)) lo = mid;
    else hi = mid;
  }
  return new Date((lo.getTime() + hi.getTime()) / 2);
}

// Tropical zodiac sign for an ecliptic longitude (0° = Aries).
const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];
const signOf = (longitude) => SIGNS[Math.floor(((longitude % 360) + 360) % 360 / 30)];

console.error(`Scanning ${bodyName} ${startYear}–${endYear}...`);
const t0 = Date.now();

const DAY = 24 * 3600 * 1000;
const scanStart = Date.UTC(startYear, 0, 1);
const scanEnd = Date.UTC(endYear + 1, 0, 15); // overshoot to close windows spanning year end

const windows = [];
let open = null; // station-retrograde time of the currently open window
let prev = new Date(scanStart);
let prevMotion = motion(prev);

for (let t = scanStart + DAY; t <= scanEnd; t += DAY) {
  const cur = new Date(t);
  const curMotion = motion(cur);
  if (Math.sign(curMotion) !== Math.sign(prevMotion)) {
    const station = bisectStation(prev, cur);
    if (curMotion < 0) {
      open = station; // direct -> retrograde
    } else if (open) {
      windows.push({
        start: open.toISOString(),
        end: station.toISOString(),
        // Where in the zodiac it stationed — the astrologically quoted facts.
        sign: signOf(elon(open)),
        signAtDirect: signOf(elon(station)),
      });
      open = null; // retrograde -> direct
    }
  }
  prev = cur;
  prevMotion = curMotion;
}

// Keep only windows that overlap the requested range.
const rangeEnd = Date.UTC(endYear + 1, 0, 1);
const result = windows.filter(
  (w) => new Date(w.end).getTime() >= scanStart && new Date(w.start).getTime() < rangeEnd
);

mkdirSync('data', { recursive: true });
const outPath = `data/${bodyName.toLowerCase()}-retrogrades.json`;
writeFileSync(
  outPath,
  JSON.stringify({ body: bodyName, generatedBy: 'astronomy-engine', startYear, endYear, windows: result }, null, 2)
);

const days = result.reduce((s, w) => s + (new Date(w.end) - new Date(w.start)) / DAY, 0);
console.error(`Found ${result.length} windows in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outPath}`);
console.error(`Avg duration: ${(days / result.length).toFixed(1)} days; ${(result.length / (endYear - startYear + 1)).toFixed(2)} windows/year`);
for (const w of result.slice(-6)) {
  console.error(`  ${w.start.slice(0, 10)} -> ${w.end.slice(0, 10)}`);
}
