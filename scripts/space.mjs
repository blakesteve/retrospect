/**
 * Fills and refreshes NASA's data (spec 7.3) from a terminal, with the same
 * passes production runs (`src/lib/space/work.ts`), against whichever store
 * the environment names: R2 when the four R2_ variables are set, otherwise
 * the local folder (DATA_DIR, default .data). It says which before it starts.
 *
 *   npm run space                                 one pass of 60 s
 *   npm run space -- --all                        passes until nothing's left
 *   npm run space -- --all --only=donki-gst,donki-flr
 *
 * Production doesn't need it: the daily cron (`/api/cron/space`) and the
 * answers route fill it. This is for a local store, and for measuring a whole
 * fill (spec 17 asks for EPIC's call volume).
 *
 * The planner is TypeScript with path aliases, so this bundles it with Vite
 * first, as `npm run null-test` does.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "node_modules/.cache/retrospect-space");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const all = process.argv.includes("--all");
const only = arg("only")?.split(",").filter(Boolean);
const budgetMs = Number(arg("budget") ?? 60) * 1000;

const { build } = await import("vite");
await build({
  configFile: false,
  logLevel: "warn",
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  build: {
    ssr: path.join(root, "src/lib/space/work.ts"),
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: "es", entryFileNames: "work.mjs" } },
  },
});
const { runSpaceWork } = await import(pathToFileURL(path.join(outDir, "work.mjs")).href);

const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].every((k) => process.env[k]?.trim());
console.log(
  r2
    ? `Writing to the R2 bucket ${process.env.R2_BUCKET.trim()}.`
    : `Writing to the local folder ${process.env.DATA_DIR?.trim() || ".data"}.`,
);
if (only) console.log(`Only: ${only.join(", ")}.`);

const started = Date.now();
const total = { passes: 0, fetches: 0, wrote: 0, failed: [] };
let stuck = 0;
for (;;) {
  const s = await runSpaceWork({ budgetMs, only });
  total.passes++;
  total.fetches += s.fetches;
  total.wrote += s.wrote.length;
  total.failed.push(...s.failed);
  const bySource = {};
  for (const w of s.wrote) bySource[w.split("/")[0]] = (bySource[w.split("/")[0]] ?? 0) + 1;
  console.log(
    `Pass ${total.passes}: ${s.fetches} fetches, ${(s.ms / 1000).toFixed(1)} s, wrote ${JSON.stringify(bySource)}` +
      `${s.failed.length ? `, ${s.failed.length} failed (${s.failed[0]})` : ""}${s.done ? ", all done" : ""}`,
  );
  if (s.done || !all) break;
  // DONKI's allowance refills at about 1.4 calls a second: give it a minute.
  if (s.failed.some((f) => f.includes("rate limit") || f.includes("429"))) {
    await new Promise((resolve) => setTimeout(resolve, 70_000));
    continue;
  }
  // A pass that fetched nothing and isn't done is failing: stop after three.
  stuck = s.fetches === 0 ? stuck + 1 : 0;
  if (stuck >= 3) {
    console.error("Three passes in a row made no progress; stopping.");
    process.exitCode = 1;
    break;
  }
}
const mins = ((Date.now() - started) / 60_000).toFixed(1);
console.log(`\n${total.passes} passes, ${total.fetches} fetches, ${total.wrote} months written, ${total.failed.length} failures, ${mins} min.`);
for (const f of total.failed.slice(0, 10)) console.log(`  failed: ${f}`);
