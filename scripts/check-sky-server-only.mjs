/**
 * Fails the build if the generated sky (src/lib/sky/data/, about a megabyte)
 * reached any client chunk. Spec 7.2: server only, each view gets its slice
 * from an endpoint. `src/lib/sky/clientImports.test.ts` checks the import graph;
 * this checks what the build actually emitted.
 *
 * Markers are timestamps read from the data files at run time, so they move
 * when the data is regenerated. The new files write whole seconds
 * ("...:49Z") and the old client files write milliseconds ("...:49.156Z"),
 * so a new-data marker can't be matched by an old file's string.
 *
 * Positive control: the last night the client's planet links accept
 * (`SKY_LAST_NIGHT` in src/lib/client/planetSheet.ts), which ships to the
 * browser on purpose, MUST be found in the client chunks. A scan that finds
 * nothing there is looking in the wrong place, and its clean result means
 * nothing. (It was a timestamp from the old client ephemeris until the
 * redesign deleted that import.)
 *
 * Runs as `postbuild`, after the bundle-shape guard.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Found the way check-bundle-shape.mjs finds it, for the reasons written
   there: `resolve`, not `join`, so an absolute BUNDLE_GUARD_DIST_DIR is
   honored instead of concatenated onto the root and missed; and BUILD_ID, not
   a directory name, as the sign a build finished here. */
const dist = [process.env.BUNDLE_GUARD_DIST_DIR, ".next"]
  .filter(Boolean)
  .map((d) => resolve(root, d))
  .find((d) => existsSync(join(d, "BUILD_ID")) && existsSync(join(d, "static")));
if (!dist) {
  console.error("[check-sky-server-only] no finished build found (no BUILD_ID beside a static/ folder).");
  process.exit(1);
}

/* One marker from every data file, so a client import of any one of them,
   alone, is caught. */
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const signs = read("src/lib/sky/data/signs.json").windows;
const markers = [
  signs[Math.floor(signs.length / 2)].start,
  read("src/lib/sky/data/retrogrades.json").windows.filter((w) => w.body === "Saturn").at(-1).start,
  read("src/lib/sky/data/moons.json").events.filter((e) => e.phase === "new").at(-1).peak,
  read("src/lib/sky/data/eclipses.json").events.at(-1).start,
  read("src/lib/sky/data/harmony.json").windows.at(-1).start,
];
const control = /export const SKY_LAST_NIGHT = "(\d{4}-\d{2}-\d{2})";/.exec(readFileSync(join(root, "src/lib/client/planetSheet.ts"), "utf8"))?.[1];
if (!control) {
  console.error("[check-sky-server-only] no control: SKY_LAST_NIGHT isn't a date in src/lib/client/planetSheet.ts.");
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
const chunks = walk(join(dist, "static"));
const texts = chunks.map((f) => [f, readFileSync(f, "utf8")]);

if (!texts.some(([, t]) => t.includes(control))) {
  console.error(
    `[check-sky-server-only] positive control failed: the client's last sky night ${control} ` +
      `is in none of ${chunks.length} client chunks under ${relative(root, dist)}/static.\n` +
      `  Either the scan is looking in the wrong place, or the planet links stopped shipping it, in ` +
      `which case pick a new control.`,
  );
  process.exit(1);
}

const leaks = markers.flatMap((m) => texts.filter(([, t]) => t.includes(m)).map(([f]) => `${m} in ${relative(root, f)}`));
if (leaks.length > 0) {
  console.error(`[check-sky-server-only] the generated sky reached client code:\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}

const ageSeconds = Math.round((Date.now() - statSync(join(dist, "BUILD_ID")).mtimeMs) / 1000);
const age = ageSeconds < 120 ? `${ageSeconds}s old` : `${Math.round(ageSeconds / 60)}m old`;
console.log(
  `✓ sky data server-only: ${markers.length} markers in none of ${chunks.length} client chunks ` +
    `(control ${control} found), build at ${relative(root, dist) || dist} ${age}`,
);
