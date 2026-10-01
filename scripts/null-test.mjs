/**
 * The null-data test at full size (spec 6.3, ClickUp 86e3fycx8): 1,000
 * synthetic histories with no sky effect, the 12 questions run on each exactly
 * as the answers endpoint runs them. At most 13% of them may get any Yes (the
 * architect's bound, 30 Sept: Benjamini-Hochberg at 10% plus about three
 * standard deviations). Run it before any change to the engine or the answer
 * rule merges; the suite's quick version is 100 small histories.
 *
 *   npm run null-test              1,000 histories, every core
 *   NULL_N=200 npm run null-test   a quicker look (the 13% bound still applies)
 *
 * The engine is TypeScript with path aliases, which plain Node workers can't
 * load, so this first bundles `src/lib/answers/nullTrials.ts` with Vite (it
 * ships with Vitest) into node_modules/.cache, then splits the histories
 * across worker threads.
 */

import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const BOUND = 0.13;

if (isMainThread) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = path.join(root, "node_modules/.cache/retrospect-null");
  const n = Number(process.env.NULL_N?.trim() || 1_000);
  const started = Date.now();

  const { build } = await import("vite");
  await build({
    configFile: false,
    logLevel: "warn",
    root,
    resolve: { alias: { "@": path.join(root, "src") } },
    build: {
      ssr: path.join(root, "src/lib/answers/nullTrials.ts"),
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "es", entryFileNames: "nullTrials.mjs" } },
    },
  });
  const bundle = pathToFileURL(path.join(outDir, "nullTrials.mjs")).href;

  const threads = Math.max(1, Math.min(n, availableParallelism() - 1));
  const slices = Array.from({ length: threads }, (_, t) => ({ bundle, from: t, step: threads, n }));
  const results = (
    await Promise.all(
      slices.map(
        (slice) =>
          new Promise((resolve, reject) => {
            const w = new Worker(fileURLToPath(import.meta.url), { workerData: slice });
            w.once("message", resolve);
            w.once("error", reject);
          }),
      ),
    )
  ).flat();

  const { summarize } = await import(bundle);
  const s = summarize(results.sort((a, b) => a.k - b.k));
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`${s.histories} histories with no sky effect, ${threads} threads, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  console.log(`Any Yes:               ${s.anyYes} (${pct(s.anyYesShare)}), bound ${pct(BOUND)}`);
  console.log(`Any p < 0.05, uncorrected: ${s.anyLowP} (${pct(s.anyLowPShare)})`);
  console.log("\nPer question (tested, p < 0.05 among tested, Yes):");
  for (const [id, q] of Object.entries(s.perQuestion)) {
    const rate = q.tested ? pct(q.lowP / q.tested) : "n/a";
    console.log(`  ${id.padEnd(11)} ${String(q.tested).padStart(5)}  ${String(q.lowP).padStart(4)} (${rate.padStart(5)})  ${String(q.yes).padStart(4)}`);
  }
  if (s.anyYesShare > BOUND) {
    console.error(`\nFAILED: ${pct(s.anyYesShare)} of histories with no sky effect got a Yes; the bound is ${pct(BOUND)}.`);
    process.exit(1);
  }
  console.log(`\nPassed: ${pct(s.anyYesShare)} is within ${pct(BOUND)}.`);
} else {
  const { bundle, from, step, n } = workerData;
  const { nullTrial } = await import(bundle);
  const out = [];
  for (let k = from; k < n; k += step) out.push(nullTrial(k));
  parentPort.postMessage(out);
}
