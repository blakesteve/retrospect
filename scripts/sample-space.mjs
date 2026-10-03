/**
 * Fetches NASA's and JPL's data for the landing's sample listener, once, into
 * `scripts/sample-space.json`, which `scripts/sample-listener.ts` loads into
 * the sample's memory store so its nights show real photos (spec 8.1, 7.3):
 *
 * - EPIC's photos of Earth for every month the sample shows: the months of
 *   the committed nights, and the months of its wild nights. Each day keeps
 *   only the frame facing the sample's zone (Chicago, 90° west, as the
 *   routes pick it), so the file stays small.
 * - SDO's Sun at every X flare and Kp reading in those months, and the UTC
 *   day either side, as the fill reads it (`sdoMoments`): the routes match a
 *   picture to the night it was taken in.
 * - JPL's close approaches and fireballs for the whole history, a year per
 *   call, so the reveal's flyby count covers all of it.
 *
 *   node scripts/sample-space.mjs
 *
 * Run it after regenerating the samples if the months they show change (the
 * samples test fails when a shown month has no NASA data), then regenerate
 * the samples again. It writes nothing but that one file, and touches no
 * store. Like `npm run space`, it bundles the TypeScript fetchers with Vite.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/retrospect-sample-space");
const SAMPLES = path.join(root, "public/samples");
const OUT = path.join(root, "scripts/sample-space.json");
/** The sample's zone faces 90° west at its standard offset (spec 7.3). */
const LONGITUDE = -90;

const { build } = await import("vite");
await build({
  configFile: false,
  logLevel: "warn",
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        sources: path.join(root, "src/lib/space/sources.ts"),
        work: path.join(root, "src/lib/space/work.ts"),
        zone: path.join(root, "src/lib/zone.ts"),
      },
      output: { format: "es", entryFileNames: "[name].mjs" },
    },
  },
});
const sources = await import(pathToFileURL(path.join(outDir, "sources.mjs")).href);
const { sdoMoments } = await import(pathToFileURL(path.join(outDir, "work.mjs")).href);
const { zoneClock } = await import(pathToFileURL(path.join(outDir, "zone.mjs")).href);
const { FIRST_DATES, fetchEpicDates, fetchEpicDay, fetchSdoDay, fetchApproaches, fetchFireballs } = sources;

const json = (name) => JSON.parse(readFileSync(path.join(SAMPLES, name), "utf8"));
const status = json("status.json");
const monthOfUts = (uts) => new Date(uts * 1000).toISOString().slice(0, 7);
const shown = new Set(readdirSync(SAMPLES).flatMap((f) => (f.match(/^nights-(\d{4}-\d{2})\.json$/) ? [f.slice(7, 14)] : [])));
for (const w of json("highlights.json").wild) shown.add(w.date.slice(0, 7));
const months = [...shown].sort();

function monthsBetween(from, to) {
  const out = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? (y++, (m = 1)) : m++)
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
}
const history = monthsBetween(monthOfUts(status.oldestUts), monthOfUts(status.newestUts));
const readAt = new Date().toISOString();
const file = (source, month, records) => ({ source, month, firstDate: FIRST_DATES[source], refreshedAt: readAt, records });

/** Runs `fn` over `items`, four at a time, in order of results. */
async function each(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
const angle = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

console.log(`Months shown: ${months.join(", ")}. History: ${history[0]} to ${history.at(-1)}.`);
const files = [];

// EPIC: every day it lists in the shown months, the frame facing the zone.
const listed = (await fetchEpicDates()).filter((d) => months.includes(d.slice(0, 7)) && d >= FIRST_DATES.epic);
const days = await each(listed, async (date) => {
  const day = await fetchEpicDay(date);
  const best = day.images.reduce((a, b) => (!a || angle(b.lon, LONGITUDE) < angle(a.lon, LONGITUDE) ? b : a), null);
  return { date, images: best ? [best] : [] };
});
for (const m of months) files.push(file("epic", m, days.filter((d) => d.date.startsWith(m))));
console.log(`EPIC: ${listed.length} days.`);

// SDO: the Sun at every X flare and Kp reading in the shown months, and the
// UTC day either side: a night's picture can be filed under the next day's date.
const donki = JSON.parse(readFileSync(path.join(root, "src/lib/answers/testdata/donki-compact.json"), "utf8"));
const near = (d) => [-1, 0, 1].some((k) => months.includes(new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 7)));
const sunDays = [...sdoMoments({ kp: {}, xflares: {}, ...donki })].filter(([d]) => near(d) && d >= FIRST_DATES.sdo).sort();
const suns = (await each(sunDays, ([day, ats]) => fetchSdoDay(day, ats))).flat();
for (const m of [...new Set(suns.map((s) => s.date.slice(0, 7)))].sort()) files.push(file("sdo", m, suns.filter((s) => s.date.startsWith(m))));
console.log(`SDO: ${suns.length} moments over ${sunDays.length} days, ${suns.filter((s) => s.url).length} with a picture.`);

/** The sample's night for a moment, by the routes' own clock: 4 a.m. to
    4 a.m. in Chicago (7.1), daylight saving included. */
const clock = zoneClock("America/Chicago", status.oldestUts - 86_400 * 400, status.newestUts + 86_400 * 400);
const nightOf = (iso) => clock.nightOf(Date.parse(iso) / 1000);
/** As `src/lib/listener/spaceNights.ts` counts a flyby. */
const FLYBY_AU = 0.01;

// JPL: close approaches and fireballs, a year per call, every month of the
// history. Of the approaches, only what a night reads: every flyby within
// 0.01 AU (the reveal counts them) and each night's nearest (its sheet
// names it); the rest can't change a word the routes say.
for (const [source, fetch] of [
  ["jpl-cad", fetchApproaches],
  ["jpl-fireball", fetchFireballs],
]) {
  const years = [...new Set(history.map((m) => m.slice(0, 4)))];
  let rows = (await each(years, (y) => fetch(`${y}-01-01`, `${y}-12-31`))).flat();
  const fetched = rows.length;
  if (source === "jpl-cad") {
    const nearest = new Map();
    for (const r of rows) if (!nearest.has(nightOf(r.time)) || r.au < nearest.get(nightOf(r.time)).au) nearest.set(nightOf(r.time), r);
    const keep = new Set(nearest.values());
    rows = rows.filter((r) => r.au <= FLYBY_AU || keep.has(r));
  }
  for (const m of history) files.push(file(source, m, rows.filter((r) => r.time.slice(0, 7) === m)));
  console.log(`${source}: ${fetched} rows fetched, ${rows.length} kept, over ${history.length} months.`);
}

const lines = files.map((f) => `    ${JSON.stringify(f)}`);
writeFileSync(
  OUT,
  `{\n  "readAt": ${JSON.stringify(readAt)},\n  "longitude": ${LONGITUDE},\n  "epicListed": ${JSON.stringify(listed)},\n  "months": [\n${lines.join(",\n")}\n  ]\n}\n`,
);
console.log(`Wrote ${path.relative(root, OUT)}: ${files.length} month files, ${(readFileSync(OUT).length / 1024).toFixed(0)} KB.`);
