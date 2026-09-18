/**
 * Fails the build if Roster's barrel got pinned as a client reference, or if
 * emitted client JS or CSS crossed its ceiling.
 *
 * Ported from blakeb-dev, which took five defects to get right: three false
 * passes caught in review and two failed deploys. The comments below are kept
 * because each one is a bug somebody already paid for. Do not "simplify" them
 * back out.
 *
 * Roster 4.13.0 regressed a sibling app by 18.49% and nobody found out until
 * somebody measured by hand. Every gate this app has is blind to it: vitest is
 * scoped to the `lib` tree and never imports Roster or renders anything, eslint
 * reads source and never build output, and `tsc` cares about types. A build
 * that ships twice the JS is green four times over.
 *
 * Three assertions, because the failure has three shapes.
 *
 * SHAPE. If Roster's root barrel appears in a client reference manifest, its
 * whole namespace is a live root and every component ships whether the app
 * imports it or not. That is the 18.49%.
 *
 * Read the count in the success line before trusting that assertion here.
 * `clientModules` records server-to-client boundary crossings, and all nine of
 * this app's Roster importers are themselves `"use client"`, so Roster is
 * bundled INSIDE their chunks and never crosses a boundary. It appears in none
 * of the 13 manifests, and the healthy value for the component-pin count on
 * this app is therefore 0, not nine-ish.
 *
 * Two consequences, both worth knowing before reading a green line as proof:
 *
 *   - This assertion is a tripwire for a topology the app does not currently
 *     have. It fires the day a SERVER component imports Roster directly, which
 *     is the change that would cause the regression. Until then it can not fire
 *     whatever Roster does.
 *   - So in this app the size ceilings below are carrying the guard. A barrel
 *     regression arriving inside the client graph shows up as bytes, not shape.
 *
 * blakeb-dev, where this came from, does have Roster components pinned, so its
 * copy of this comment says the count is evidence the check is looking at
 * something. Here that evidence is absent by construction. Do not "fix" the 0.
 *
 * SIZE. Shape is the known mechanism, not the only one. The ceiling catches a
 * regression that arrives some other way, including from outside Roster.
 *
 * CSS. Added here, and not in blakeb-dev. Roster's stylesheet is 142,426 of
 * this app's 167,298 emitted CSS bytes, 85%, and none of it shakes: per-module
 * JS emission can not touch a single precompiled sheet. So the JS ceiling is
 * blind to the whole 85%, and the next queued Roster change is to that
 * stylesheet, across all six apps. A JS-only guard would watch the half that
 * already got fixed and miss the half that did not.
 *
 * Three things this gets right on purpose, each of which has been got wrong
 * once already:
 *
 * 1. The barrel path is DERIVED from the installed package, never hardcoded.
 *    It is `dist/roster.js` today and was `dist/roster.es.js` at 4.12.1. A
 *    check that hardcodes the current name fails OPEN against the old one:
 *    it reports zero pins and passes on a build full of them.
 *
 * 2. The manifests are PARSED, not grepped. Each one assigns an object to
 *    `globalThis.__RSC_MANIFEST`, so it is run in a vm context and walked as
 *    data. A regex over the text has already reported 0 on an app that had 99
 *    entries at the time.
 *
 * 3. A `name: "*"` entry against a COMPONENT module is correct and passes.
 *    It means that component is pinned whole, which is what a client component
 *    imported by a server component is supposed to be. Only the barrel matters.
 *
 * This reads build output, so it runs as `postbuild`, after `next build`.
 * `prebuild` would grade the previous build.
 */

import { readFileSync, existsSync, readdirSync, statSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "@blakesteve/roster";

/**
 * Ceilings on emitted client assets, in bytes: every .js and every .css
 * anywhere under the build's `static` directory, walked recursively.
 *
 * Recursive, and not the `static/chunks` subdirectory, because that name is not
 * guaranteed. Vercel's adapter relocates the client assets: a real deploy had a
 * `static` with no `chunks` in it, which failed this check twice on blakeb-dev.
 * Summing every emitted asset under `static` holds whatever the layout is, and
 * is also what the heading actually claims.
 *
 * It also matters locally, not only on Vercel. Summing `static/chunks` gives
 * 1,615,814 here and summing `static` gives 1,616,209: the 395-byte gap is the
 * build manifests, which sit in `static/<buildId>/` rather than in `chunks`.
 * Two methods that differ by a rounding error today will differ by more later.
 *
 * Measured 18 September 2026 on Roster 5.0.0, Next 16.2.10:
 *   JS  1,616,209 bytes across 22 files
 *   CSS   167,298 bytes across 1 file
 *
 * The JS ceiling allows 77,791 bytes of slack, 4.81%, matching blakeb-dev's
 * 4.8%. The CSS ceiling allows 7,702 bytes, 4.60%. Both are room for ordinary
 * drift between Roster bumps and far below the 18.49% class of regression this
 * exists to catch. Raise either in a commit that says what grew and why, rather
 * than to make a red build green.
 */
const CLIENT_JS_CEILING = 1_694_000;
const CLIENT_CSS_CEILING = 175_000;

const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fail(message) {
  console.error(`[check-bundle-shape] ${message}`);
  process.exit(1);
}

/**
 * One level deeper than the failing directory's own listing.
 *
 * blakeb-dev's first deploy failure said `.next not found` and taught nothing.
 * The second listed `.next` and showed a `static` with no `chunks`, which cost
 * a third build to see inside. A diagnostic that stops one level short of the
 * answer is a diagnostic that buys another red deploy.
 */
function subdirInventory(dir) {
  const lines = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (!lstatSync(full).isDirectory()) continue;
    lines.push(`    ${entry}/: ${readdirSync(full).sort().slice(0, 25).join(", ")}`);
  }
  return lines.length ? `\n  One level in:\n${lines.join("\n")}` : "";
}

/* Every unreadable input below is a hard exit rather than a skip. A guard that
   shrugs when it can not find its inputs is worse than no guard: it reports a
   pass nobody has any reason to doubt. */

/**
 * Find the build output, by marker rather than by name.
 *
 * `.next` is the default and is not a promise. An adapter can move it: Next
 * calls `modifyConfig` on any command that loads the config, the adapter
 * returns a whole `NextConfigComplete`, and `distDir` is one of the fields it
 * may change. Vercel supplies such an adapter through `config.adapterPath`,
 * and it ships in their build image rather than in `node_modules`, so what it
 * sets `distDir` to can not be read from here.
 *
 * Next exposes no environment variable naming the dist directory. There is no
 * `NEXT_DIST_DIR`, and `__NEXT_DIST_DIR` is a build-time DefinePlugin token
 * substituted into dev client bundles, never a variable in this process's
 * environment. An earlier version of this check read both and was inert for it.
 * So the override below is ours, and it is the lever to reach for once a deploy
 * log names the real path.
 *
 * Each candidate is confirmed by the `BUILD_ID` file Next writes into the dist
 * directory, rather than assumed from the directory name. That marker means
 * "a build finished here once", not "this build", so the success line reports
 * the build's age: a stale directory graded by accident should be visible
 * rather than silent.
 */
function resolveDistDir() {
  const candidates = [process.env.BUNDLE_GUARD_DIST_DIR, ".next"].filter(Boolean);

  for (const candidate of candidates) {
    /* resolve, not join. `join(root, "/abs/path")` concatenates rather than
       honoring the absolute path, so an absolute override would silently miss
       and fall through to a stale `.next`, which is a pass on the wrong build.
       A deploy log hands you an absolute path, so that is the likely input. */
    const dir = resolve(root, candidate);
    if (existsSync(join(dir, "BUILD_ID"))) return dir;
  }
  return null;
}

const distDir = resolveDistDir();

/* Name what was looked for and what is actually present. The first version of
   this check failed its first real deploy with "not found" and no inventory,
   which cost a whole build to learn nothing. */
if (!distDir) {
  const inventory = readdirSync(root)
    .filter((entry) => entry !== "node_modules" && entry !== ".git")
    .sort()
    .join(", ");
  const dotNextPath = join(root, ".next");
  /* lstat, and only list it if it really is a directory. A `.next` that is a
     file makes readdirSync throw ENOTDIR, which would replace the whole
     diagnostic with a stack trace in the one build you get to learn from. */
  let dotNext = "(absent)";
  if (existsSync(dotNextPath)) {
    dotNext = lstatSync(dotNextPath).isDirectory()
      ? readdirSync(dotNextPath).sort().join(", ")
      : `(not a directory)`;
  }
  fail(
    `no Next build found under ${root}.\n` +
      `  Confirmed by looking for a BUILD_ID in BUNDLE_GUARD_DIST_DIR and .next\n` +
      `  BUNDLE_GUARD_DIST_DIR=${process.env.BUNDLE_GUARD_DIST_DIR ?? "(unset)"}\n` +
      `  Repo root holds: ${inventory}\n` +
      `  .next holds: ${dotNext}\n` +
      `  On a deploy this means the adapter moved the output. Set ` +
      `BUNDLE_GUARD_DIST_DIR to the path it moved it to; absolute is fine.`,
  );
}

const serverDir = join(distDir, "server");
const staticDir = join(distDir, "static");
for (const [label, dir] of [
  ["server", serverDir],
  ["static", staticDir],
]) {
  if (!existsSync(dir)) {
    fail(
      `found a build at ${relative(root, distDir) || distDir} but no ${label} ` +
        `directory in it.\n  It holds: ${readdirSync(distDir).sort().join(", ")}` +
        subdirInventory(distDir),
    );
  }
}

/* ---- 1. Derive the barrel from the installed package ---------------------
   `exports` does not expose `package.json`, so this reads the file off disk
   rather than resolving the module. */

const pkgPath = join(root, "node_modules", PKG, "package.json");
if (!existsSync(pkgPath)) fail(`${PKG} is not installed, ${pkgPath} is missing.`);

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (error) {
  fail(`could not parse ${PKG}'s package.json: ${error.message}`);
}

/**
 * Every path the root entry point can resolve to.
 *
 * `exports["."]` is a string, or a condition map, or a condition map nested
 * inside a condition map, or an array of any of those. Rather than naming the
 * conditions, this walks the whole tree and takes every string it finds.
 *
 * Naming them is how this check failed its own review on blakeb-dev. An earlier
 * version read `import`, `require`, `default`, `node` and `browser` at one level
 * only. Given the ordinary modern shape:
 *
 *     "." : { "import": { "node": "...", "default": "./dist/roster.js" },
 *             "require": "./dist/roster.cjs" }
 *
 * it collected `dist/roster.cjs` alone, matched nothing against a real pin on
 * `dist/roster.js`, and reported that pin as a healthy component. The set was
 * not empty, so neither the fallback nor the exit below fired. That is the
 * hardcoded-filename bug moved up one level: still derived, derived wrongly,
 * and silent because a half-filled set looks exactly like a full one.
 *
 * `react-server` is the condition Next's server compiler actually resolves,
 * and it was not in that list either.
 *
 * So: collect everything, and take `module` and `main` as well rather than
 * only when nothing else turned up. Over-collecting costs nothing, because a
 * path the build never emits simply matches no manifest key. Under-collecting
 * is the whole failure mode. If the walk finds nothing at all, that is an exit
 * rather than an empty set to match against.
 */
function barrelPaths(manifest) {
  const found = new Set();

  const collect = (value) => {
    if (typeof value === "string") found.add(value.replace(/^\.\//, ""));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };

  /* The WHOLE exports map, not `exports["."]`. blakeb-dev reads the root entry
     only, which leaves Roster's other two namespace re-export barrels underived:
     `./data-table` and `./utils`. Pinning `./data-table` pulls TanStack the same
     way pinning the root pulls everything, and an underived path is not merely
     missed, it is counted as a healthy COMPONENT pin. Same failure direction as
     the trap this function's comment is about, one key over.

     This also collects the three stylesheet subpaths, which never appear as
     client module keys and so match nothing. That is the over-collection the
     comment above calls free. */
  collect(manifest.exports);
  collect(manifest.module);
  collect(manifest.main);
  return found;
}

const barrels = barrelPaths(pkg);
if (barrels.size === 0) {
  fail(
    `could not derive ${PKG}'s root entry point from its package.json.\n` +
      `  Checked exports["."], module and main. Without it this check would ` +
      `pass on every build, so it stops instead.`,
  );
}

/* What a manifest key looks like: "[project]/node_modules/<pkg>/<path>". Match
   on that suffix rather than the whole key, which carries a build-root prefix.
 *
 * DIVERGENCE FROM blakeb-dev, deliberate, and blakeb-dev needs the same fix.
 *
 * A manifest key is a resolved path that may carry a DECORATION after it, and
 * `endsWith` against the raw key can not match any decorated form. Next emits
 * every client module under two keys, the plain path and the same path plus
 * " <module evaluation>": 54 of this build's 108 client module entries are the
 * suffixed form. Turbopack also writes a bracketed layer form, " [postcss] (ecmascript)",
 * which appears elsewhere in this same build, and module ids can carry a "?"
 * query.
 *
 * blakeb-dev tests the raw key, so injecting a real two-key barrel pin there
 * reports "1 barrel pin(s)" for two pinned keys, and injecting only a decorated
 * form reports zero and PASSES. The miss is not neutral: it increments the
 * component-pin counter, so a missed barrel is reported as evidence of health.
 *
 * A real pin today emits the bare form too, so blakeb-dev is not currently
 * blind. It is one Next release away from being blind.
 *
 * Cutting at the first " [", " <" or "?" handles every decoration at once
 * rather than chasing them one release at a time. No path inside node_modules
 * contains any of those three, so nothing legitimate is truncated. */
const DECORATION = /[ ][[<]|\?/;
const normalizeKey = (key) => key.split(DECORATION)[0].trimEnd();
const barrelSuffixes = [...barrels].map((path) => `${PKG}/${path}`);
const isBarrel = (key) =>
  barrelSuffixes.some((suffix) => normalizeKey(key).endsWith(suffix));

/* ---- 2. Parse every client reference manifest ---------------------------- */

const manifestFiles = walk(serverDir).filter((file) =>
  file.includes("client-reference-manifest"),
);
if (manifestFiles.length === 0) {
  fail(
    `no client reference manifests found under ${relative(root, serverDir) || serverDir}.\n` +
      `  It holds: ${readdirSync(serverDir).sort().join(", ")}`,
  );
}

let routeCount = 0;
let entryCount = 0;
let componentPins = 0;
const barrelPins = [];

for (const file of manifestFiles) {
  /* One context per file so a parse failure names the file that caused it.
   *
   * `process.env` is in the sandbox because Vercel's manifests reference
   * `process` and an empty sandbox can not evaluate them. This failed a real
   * deploy with:
   *
   *     could not evaluate .next/server/app/_global-error/
   *     page_client-reference-manifest.js: process is not defined
   *
   * and it failed only there. None of the 13 manifests this app emits locally
   * touches `process`, so the guard was green on every local build and red on
   * the first deploy. Worth noting the guard behaved correctly: it hard-exited
   * rather than skipping the file, which is the whole point of every unreadable
   * input being an exit. It just exited for the wrong reason.
   *
   * Scoped to `env` rather than passing the whole `process`, deliberately. A
   * manifest needs environment values and nothing else. One that reaches for
   * `process.exit`, `process.cwd` or `process.argv` is doing something this
   * check has not accounted for, and it should fail loudly here rather than
   * work by accident and quietly grade something unexpected. */
  const context = createContext({ process: { env: process.env } });
  context.globalThis = context;
  try {
    runInContext(readFileSync(file, "utf8"), context);
  } catch (error) {
    fail(`could not evaluate ${relative(root, file)}: ${error.message}`);
  }

  const manifest = context.__RSC_MANIFEST;
  if (!manifest || typeof manifest !== "object") {
    fail(
      `${relative(root, file)} set no __RSC_MANIFEST.\n` +
        `  The manifest format changed and this check can no longer read it.`,
    );
  }

  for (const [route, entry] of Object.entries(manifest)) {
    routeCount += 1;
    /* Not `?? {}`. A route whose entry has no `clientModules` at all means the
       format moved, and defaulting to an empty object would walk nothing and
       call it clean. Every route in a real build has the key, empty or not. */
    if (!entry?.clientModules || typeof entry.clientModules !== "object") {
      fail(
        `${relative(root, file)} route ${route} has no clientModules object.\n` +
          `  The manifest format changed and this check can no longer read it.`,
      );
    }
    for (const [key, value] of Object.entries(entry.clientModules)) {
      entryCount += 1;
      if (!key.includes(`${PKG}/`)) continue;
      if (isBarrel(key)) {
        barrelPins.push({ route, key, name: value?.name, file });
      } else {
        /* A component module pinned whole. Correct, and counted so the success
           line can show the check was actually looking at something. */
        componentPins += 1;
      }
    }
  }
}

if (barrelPins.length > 0) {
  const lines = barrelPins.map(
    ({ route, key, name }) =>
      `  ${route}\n    ${key}\n    pinned as name: ${JSON.stringify(name)}`,
  );
  problems.push(
    `${barrelPins.length} barrel pin(s) in the client reference manifests.\n\n` +
      lines.join("\n\n") +
      `\n\n  The root barrel is a client reference, so its whole namespace is a ` +
      `live root\n  and every component ships whether the app imports it or not.\n` +
      `  This is the shape that cost a sibling app 18.49%.`,
  );
}

/* ---- 3. Size budgets ----------------------------------------------------- */

const emitted = walk(staticDir);

for (const [label, extension, ceiling] of [
  ["JS", ".js", CLIENT_JS_CEILING],
  ["CSS", ".css", CLIENT_CSS_CEILING],
]) {
  const files = emitted.filter((file) => file.endsWith(extension));
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);

  /* A ceiling with no floor under it is satisfied by an empty build.
     Not hypothetical, and not a fresh worry: the comment on the ceilings
     records that Vercel's adapter has already relocated this app family's
     client assets once. Make it relocate them OUT of `static` rather than
     into a differently named subdirectory, or turn on `experimental.inlineCss`,
     which moves the whole stylesheet into the HTML, and both sums go to zero
     and every ceiling passes forever. Verified: emptying `static` of .js and
     .css reports "client JS 0 of 1,694,000 bytes" and exits 0.

     Zero is the only floor worth asserting. This app can not emit a build with
     no client JS or no stylesheet, so any zero means the assets are somewhere
     this check is not looking, which is the one thing a size guard must never
     report as a pass. A PARTIAL relocation would still slip through; Next has
     no behavior that produces one, so there is nothing better to assert. */
  if (totalBytes === 0) {
    fail(
      `found no client ${label} at all under ${relative(root, staticDir) || staticDir}.\n` +
        `  A build with zero ${label} bytes is not possible for this app, so the ` +
        `assets are\n  somewhere this check is not looking and the ceiling below ` +
        `is meaningless.\n` +
        `  static holds: ${readdirSync(staticDir).sort().join(", ")}` +
        subdirInventory(staticDir),
    );
  }

  if (totalBytes > ceiling) {
    const over = totalBytes - ceiling;
    const percent = ((totalBytes / ceiling - 1) * 100).toFixed(2);
    problems.push(
      `client ${label} is ${totalBytes.toLocaleString("en-US")} bytes, over the ` +
        `${ceiling.toLocaleString("en-US")} ceiling by ` +
        `${over.toLocaleString("en-US")} (${percent}%).\n\n` +
        `  Find what grew before raising the ceiling. If the growth is real and ` +
        `wanted,\n  raise it in a commit that says what grew.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`[check-bundle-shape] ${problems.length} problem(s).\n`);
  console.error(problems.join("\n\n"));
  process.exit(1);
}

/* Age of the graded build. BUILD_ID says a build finished here, not that it is
   this one, so a stale directory graded by accident shows up as a large number
   here rather than passing quietly. */
const ageSeconds = Math.round(
  (Date.now() - statSync(join(distDir, "BUILD_ID")).mtimeMs) / 1000,
);
const age = ageSeconds < 120 ? `${ageSeconds}s old` : `${Math.round(ageSeconds / 60)}m old`;

const sum = (extension) =>
  emitted
    .filter((file) => file.endsWith(extension))
    .reduce((total, file) => total + statSync(file).size, 0);

console.log(
  `✓ bundle shape: ${PKG} barrel unpinned across ${routeCount} routes ` +
    `(${entryCount} client modules, ${componentPins} Roster components pinned ` +
    `individually), client JS ${sum(".js").toLocaleString("en-US")} of ` +
    `${CLIENT_JS_CEILING.toLocaleString("en-US")} bytes, CSS ` +
    `${sum(".css").toLocaleString("en-US")} of ` +
    `${CLIENT_CSS_CEILING.toLocaleString("en-US")} bytes, ` +
    `build at ${relative(root, distDir) || distDir} ${age}`,
);
