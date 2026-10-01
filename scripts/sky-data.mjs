// Retrospect: the redesign's sky data, 2002 through 2035 (spec 7.2).
//
// Every window comes from lib/sky/sky.ts, the same module the server and the
// Sky view use, so the data and the live math can't disagree at a boundary.
// Events are bisected to the second (well inside the spec's "to the minute").
// Windows at the range's edges keep their true start and end: the scan runs
// three years either side, then keeps what overlaps the range.
//
// Output (server-only; read through lib/sky/windows.ts, never by client code):
//   lib/sky/data/retrogrades.json  Mercury, Venus, Mars, Jupiter, Saturn
//   lib/sky/data/signs.json        sign windows for the seven bodies
//   lib/sky/data/moons.json        full and new moons, +/- 36 h
//   lib/sky/data/eclipses.json     lunar and solar, +/- 60 h, with the kind
//   lib/sky/data/harmony.json      Venus and Mars trine or sextile within 3 deg
//
// Usage: node scripts/sky-data.mjs [startYear] [endYear]   (Node 23.6 or later:
// it imports the .ts module directly)

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  MakeTime,
  NextGlobalSolarEclipse,
  NextLunarEclipse,
  SearchGlobalSolarEclipse,
  SearchLunarEclipse,
  SearchMoonPhase,
} from 'astronomy-engine';
import {
  BODIES,
  HARMONY_TARGETS,
  MOON_WINDOW_MS,
  RETROGRADE_BODIES,
  ASPECT_ORB,
  SIGNS,
  harmonyRate,
  harmonySeparation,
  longitude,
  motion,
  offFrom,
  signIndexOf,
  signOf,
} from '../lib/sky/sky.ts';

const startYear = Number(process.argv[2] ?? 2002);
const endYear = Number(process.argv[3] ?? 2035);
const RANGE_FROM = Date.UTC(startYear, 0, 1);
const RANGE_TO = Date.UTC(endYear + 1, 0, 1); // exclusive
const SCAN_FROM = Date.UTC(startYear - 3, 0, 1);
const SCAN_TO = Date.UTC(endYear + 4, 0, 1);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OUT = 'lib/sky/data';

/** An instant as ISO, rounded to the whole second. */
const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const overlapsRange = (start, end) => end >= RANGE_FROM && start < RANGE_TO;
const range = { from: iso(RANGE_FROM), to: iso(RANGE_TO) };

/** Bisect [lo, hi], where pred(lo) !== pred(hi), to one second. Returns the
    first instant at which pred has its `hi` value. */
function bisect(lo, hi, pred) {
  const atLo = pred(lo);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(mid) === atLo) lo = mid;
    else hi = mid;
  }
  return hi;
}

const t0 = Date.now();
const log = (msg) => console.error(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${msg}`);

/* ---- Retrogrades: the old scripts' method exactly --------------------------
   A daily grid at 00:00 UTC, the sign of the +/- 6 h motion, each change
   bisected to a minute and the midpoint taken. Same grid, same test, same
   stopping rule as scripts/retrograde-windows.mjs, so Mercury, Venus and Mars
   match the old files to the second (data.test.ts checks it). */
function stationBisect(body, lo, hi) {
  const mLo = Math.sign(motion(body, new Date(lo)));
  while (hi - lo > 60 * 1000) {
    const mid = (lo + hi) / 2;
    if (Math.sign(motion(body, new Date(mid))) === mLo) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const retrogrades = [];
/* Every window found, in or out of the range. A sign window at the range's
   edge keeps its true start or end outside the range, and its retrograde
   flags must be judged against retrogrades out there too. */
const allRetrogrades = [];
for (const body of RETROGRADE_BODIES) {
  let open = null;
  let prev = SCAN_FROM;
  let prevM = motion(body, new Date(prev));
  for (let t = SCAN_FROM + DAY; t <= SCAN_TO; t += DAY) {
    const m = motion(body, new Date(t));
    if (Math.sign(m) !== Math.sign(prevM)) {
      const station = stationBisect(body, prev, t);
      if (m < 0) open = station;
      else if (open !== null) {
        allRetrogrades.push({ body, start: open, end: station });
        if (overlapsRange(open, station)) {
          retrogrades.push({
            body,
            start: iso(open),
            end: iso(station),
            sign: signOf(longitude(body, new Date(open))),
            signAtDirect: signOf(longitude(body, new Date(station))),
          });
        }
        open = null;
      }
    }
    prev = t;
    prevM = m;
  }
  log(`${body}: ${retrogrades.filter((w) => w.body === body).length} retrograde windows`);
}

const retrogradeAt = (body, ms) =>
  allRetrogrades.some((w) => w.body === body && ms >= Math.round(w.start / 1000) * 1000 && ms <= Math.round(w.end / 1000) * 1000);

/* ---- Sign windows ----------------------------------------------------------
   A grid fine enough never to skip a sign (2 h for the Moon, 6 h for the
   rest), each change of sign bisected to the second. */
const signs = [];
for (const body of BODIES) {
  const step = body === 'Moon' ? 2 * HOUR : 6 * HOUR;
  const signAt = (ms) => signIndexOf(longitude(body, new Date(ms)));
  const boundaries = [];
  let prev = SCAN_FROM;
  let prevSign = signAt(prev);
  for (let t = SCAN_FROM + step; t <= SCAN_TO; t += step) {
    const cur = signAt(t);
    if (cur !== prevSign) {
      const jump = (cur - prevSign + 12) % 12;
      if (jump !== 1 && jump !== 11) throw new Error(`${body} skipped a sign between ${iso(prev)} and ${iso(t)}`);
      boundaries.push({ at: bisect(prev, t, signAt), sign: cur });
    }
    prev = t;
    prevSign = cur;
  }
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const start = boundaries[i].at;
    const end = boundaries[i + 1].at;
    if (!overlapsRange(start, end)) continue;
    const rx = RETROGRADE_BODIES.includes(body);
    signs.push({
      body,
      sign: SIGNS[boundaries[i].sign],
      start: iso(start),
      end: iso(end),
      retrogradeAtStart: rx && retrogradeAt(body, start),
      retrogradeAtEnd: rx && retrogradeAt(body, end),
    });
  }
  log(`${body}: ${signs.filter((w) => w.body === body).length} sign windows`);
}

/* ---- Full and new moons ---------------------------------------------------- */
const moons = [];
for (const [phase, target] of [['full', 180], ['new', 0]]) {
  let cursor = MakeTime(new Date(RANGE_FROM - MOON_WINDOW_MS));
  for (;;) {
    const found = SearchMoonPhase(target, cursor, 40);
    if (!found) break;
    const peak = found.date.getTime();
    if (peak >= RANGE_TO + MOON_WINDOW_MS) break;
    if (overlapsRange(peak - MOON_WINDOW_MS, peak + MOON_WINDOW_MS)) {
      moons.push({
        phase,
        peak: iso(peak),
        start: iso(peak - MOON_WINDOW_MS),
        end: iso(peak + MOON_WINDOW_MS),
        sign: signOf(longitude('Moon', found.date)),
      });
    }
    cursor = MakeTime(new Date(peak + 20 * DAY));
  }
}
moons.sort((a, b) => Date.parse(a.peak) - Date.parse(b.peak));
log(`moons: ${moons.filter((m) => m.phase === 'full').length} full, ${moons.filter((m) => m.phase === 'new').length} new`);

/* ---- Eclipses: the old script's method, +/- 60 h, with the kind ------------- */
const H60 = 60 * HOUR;
const eclipses = [];
const pushEclipse = (peakDate, kind) => {
  const peak = peakDate.getTime();
  if (!overlapsRange(peak - H60, peak + H60)) return;
  eclipses.push({ kind, peak: iso(peak), start: iso(peak - H60), end: iso(peak + H60), sign: signOf(longitude('Moon', peakDate)) });
};
for (let e = SearchLunarEclipse(new Date(RANGE_FROM - H60)); e.peak.date.getTime() < RANGE_TO + H60; e = NextLunarEclipse(e.peak)) {
  pushEclipse(e.peak.date, `${e.kind} lunar`);
}
for (let e = SearchGlobalSolarEclipse(new Date(RANGE_FROM - H60)); e.peak.date.getTime() < RANGE_TO + H60; e = NextGlobalSolarEclipse(e.peak)) {
  pushEclipse(e.peak.date, `${e.kind} solar`);
}
eclipses.sort((a, b) => Date.parse(a.peak) - Date.parse(b.peak));
log(`eclipses: ${eclipses.length}`);

/* ---- Venus and Mars harmony --------------------------------------------------
   For each target (60, 120, 240, 300 degrees of Mars-minus-Venus), the stretches
   within 3 degrees, entry and exit bisected to the second, with the
   separation's rate at both ends for 6.2's merge rule. */
const harmony = [];
{
  const step = 6 * HOUR;
  const inside = (target) => (ms) => Math.abs(offFrom(harmonySeparation(new Date(ms)), target)) <= ASPECT_ORB;
  for (const { target, aspect, side } of HARMONY_TARGETS) {
    const within = inside(target);
    let prev = SCAN_FROM;
    let prevIn = within(prev);
    // A window already open at the scan's start is dropped: it ends years
    // before the range.
    let open = null;
    for (let t = SCAN_FROM + step; t <= SCAN_TO; t += step) {
      const cur = within(t);
      if (cur !== prevIn) {
        const at = bisect(prev, t, within);
        if (cur) open = at;
        else if (open !== null) {
          if (overlapsRange(open, at)) {
            harmony.push({
              aspect,
              side,
              start: iso(open),
              end: iso(at),
              rateAtStart: Number(harmonyRate(new Date(open)).toFixed(4)),
              rateAtEnd: Number(harmonyRate(new Date(at)).toFixed(4)),
            });
          }
          open = null;
        }
      }
      prev = t;
      prevIn = cur;
    }
  }
  harmony.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  log(`harmony: ${harmony.length} windows`);
}

mkdirSync(OUT, { recursive: true });
const meta = { generatedBy: 'astronomy-engine via lib/sky/sky.ts', frame: 'geocentric, tropical, apparent', range };
/* One record per line: compact, and a regenerated file diffs line by line. */
const write = (name, key, rows) => {
  const head = JSON.stringify({ ...meta, [key]: [] }).slice(0, -3);
  const body = rows.map((r) => JSON.stringify(r)).join(',\n');
  writeFileSync(`${OUT}/${name}.json`, `${head}[\n${body}\n]}\n`);
};
write('retrogrades', 'windows', retrogrades);
write('signs', 'windows', signs);
write('moons', 'events', moons);
write('eclipses', 'events', eclipses);
write('harmony', 'windows', harmony);
log(`wrote ${OUT}/ (${startYear} through ${endYear})`);
