/**
 * The null-data test at full size (spec 6.3, ClickUp 86e3fycx8): 1,000
 * synthetic histories with no sky effect, the 12 questions run on each exactly
 * as the answers endpoint runs them. At most 13% of them may get any Yes (the
 * architect's bound, 30 Sept: Benjamini-Hochberg at 10% plus about three
 * standard deviations). Run it before any change to the engine or the answer
 * rule merges; the suite's quick version is 100 small histories.
 *
 *   npm run null-test              all of it, every core
 *   NULL_SET=full npm run null-test     the 1,000, about four years or more
 *   NULL_SET=young npm run null-test    the young bands and the floor's edges
 *   NULL_SET=full NULL_N=200 npm run null-test   a quicker look at the 1,000's first 200
 *
 * Young histories (28 Oct 2026, ClickUp 86e3m6dgn): 500 in each of four
 * length bands under the 1,000's youngest (`BANDS` in nullTrials.ts says why
 * those), and at the 6-event floor, 100 histories built to hold 6 events of
 * each seam question and 100 built to hold 5. Each band is held to the 13%
 * among its histories with anything tested, since a young one often has
 * nothing to test; so is each half of the floor's. The run also fails if the
 * engine counts more of a seam question's events than a floor history was
 * built to hold, if one built for 5 gets that question tested, or if any
 * question couldn't be computed. NULL_BAND_N and NULL_FLOOR_N change those
 * counts. CI runs the two sets as two jobs side by side.
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
  const set = process.env.NULL_SET?.trim() || "all";
  if (!["all", "full", "young"].includes(set)) throw new Error(`NULL_SET is full, young or unset, not ${set}`);
  const count = (name, fallback) => {
    const v = Number(process.env[name]?.trim() || fallback);
    if (!Number.isInteger(v) || v < 1) throw new Error(`${name} is a whole number of histories, not ${process.env[name]}`);
    return v;
  };
  const n = set === "young" ? 0 : count("NULL_N", 1_000);
  const bandN = set === "full" ? 0 : count("NULL_BAND_N", 500);
  const floorN = set === "full" ? 0 : count("NULL_FLOOR_N", 100);
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
  const { summarize, BANDS, FLOOR_QUESTIONS } = await import(bundle);

  // Every history, by kind, dealt round the threads.
  const tasks = [];
  for (let k = 0; k < n; k++) tasks.push(["full", k]);
  for (let b = 0; b < BANDS.length; b++) for (let k = 0; k < bandN; k++) tasks.push(["band", b, k]);
  for (const id of FLOOR_QUESTIONS) for (const events of [6, 5]) for (let k = 0; k < floorN; k++) tasks.push(["floor", id, events, k]);
  const threads = Math.max(1, Math.min(tasks.length, availableParallelism() - 1));
  const results = (
    await Promise.all(
      Array.from(
        { length: threads },
        (_, t) =>
          new Promise((resolve, reject) => {
            const w = new Worker(fileURLToPath(import.meta.url), { workerData: { bundle, tasks: tasks.filter((_, i) => i % threads === t) } });
            w.once("message", resolve);
            w.once("error", reject);
          }),
      ),
    )
  ).flat();

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const failures = [];
  const held = (label, s) => {
    if (s.anyYesShare > BOUND) failures.push(`${label}: ${pct(s.anyYesShare)} got a Yes; the bound is ${pct(BOUND)}`);
  };
  /** A set's figures among its histories with anything tested: what a young set is held to. */
  const amongTested = (trials) => summarize(trials.filter((r) => r.tested.length));
  const errored = results.filter((r) => r.errored.length);
  if (errored.length) failures.push(`${errored.length} histories had a question that couldn't be computed (${errored.slice(0, 5).map((r) => `${r.kind} ${r.k}: ${r.errored.join(", ")}`).join("; ")})`);
  console.log(`${results.length} histories with no sky effect, ${threads} threads, ${((Date.now() - started) / 1000).toFixed(0)} s.`);

  const full = results.filter((r) => r.kind === "full").sort((a, b) => a.k - b.k);
  if (full.length) {
    const s = summarize(full);
    console.log(`\nAbout four years or more: ${s.histories} histories`);
    console.log(`Any Yes:               ${s.anyYes} (${pct(s.anyYesShare)}), bound ${pct(BOUND)}`);
    console.log(`Any p < 0.05, uncorrected: ${s.anyLowP} (${pct(s.anyLowPShare)})`);
    console.log("\nPer question (tested, p < 0.05 among tested, Yes):");
    for (const [id, q] of Object.entries(s.perQuestion)) {
      const rate = q.tested ? pct(q.lowP / q.tested) : "n/a";
      console.log(`  ${id.padEnd(11)} ${String(q.tested).padStart(5)}  ${String(q.lowP).padStart(4)} (${rate.padStart(5)})  ${String(q.yes).padStart(4)}`);
    }
    held("About four years or more", s);
  }

  const bands = BANDS.map((band) => {
    const trials = results.filter((r) => r.kind === "band" && r.band === band.id);
    return { band, s: summarize(trials), t: amongTested(trials) };
  }).filter((x) => x.s.histories);
  if (bands.length) {
    console.log("\nYounger, by length (histories; any Yes among all; with anything tested, questions tested each, any p < 0.05, any Yes, bound 13%):");
    for (const { band, s, t } of bands) {
      const each = t.histories ? (Object.values(t.perQuestion).reduce((x, q) => x + q.tested, 0) / t.histories).toFixed(2) : "0";
      console.log(
        `  ${band.label.padEnd(15)} ${String(s.histories).padStart(4)}  ${pct(s.anyYesShare).padStart(6)}  |  ${String(t.histories).padStart(4)}  ${each.padStart(5)}  ${pct(t.anyLowPShare).padStart(6)}  ${String(t.anyYes).padStart(3)} (${pct(t.anyYesShare)})`,
      );
      held(`${band.label}, with anything tested`, t);
    }
    console.log("\nPer question, by length (tested, p < 0.05 among tested, Yes):");
    console.log(`  ${"".padEnd(11)} ${bands.map(({ band }) => band.label.padStart(22)).join("")}`);
    for (const id of Object.keys(bands[0].s.perQuestion)) {
      const cell = (q) => (q.tested ? `${q.tested} ${pct(q.lowP / q.tested)} ${q.yes}` : "-");
      console.log(`  ${id.padEnd(11)} ${bands.map(({ s }) => cell(s.perQuestion[id]).padStart(22)).join("")}`);
    }
  }

  const floor = results.filter((r) => r.kind === "floor");
  if (floor.length) {
    console.log("\nAt the 6-event floor (built to hold, histories, the engine's count of its events, it tested, its Yes, any Yes):");
    for (const id of FLOOR_QUESTIONS) {
      for (const target of [6, 5]) {
        const g = floor.filter((r) => r.question === id && r.target === target);
        const counts = Object.entries(g.reduce((m, r) => ({ ...m, [r.events]: (m[r.events] ?? 0) + 1 }), {})).map(([e, c]) => `${e}: ${c}`).join(", ");
        const tested = g.filter((r) => r.status === "tested").length;
        const yes = g.filter((r) => r.word === "Yes").length;
        const anyYes = g.filter((r) => r.yes.length).length;
        console.log(`  ${id.padEnd(11)} ${target}  ${String(g.length).padStart(4)}  {${counts}}  ${String(tested).padStart(4)}  ${String(yes).padStart(3)}  ${anyYes} (${pct(anyYes / g.length)})`);
      }
    }
    // What the edges can catch: an engine that counts events a history doesn't hold, or tests a question below the floor.
    const over = floor.filter((r) => r.events > r.target);
    if (over.length) failures.push(`${over.length} at the floor had more events counted than they were built to hold (${over.slice(0, 5).map((r) => `${r.question} ${r.target}: ${r.events}`).join(", ")})`);
    const short = floor.filter((r) => r.target === 5 && r.status === "tested");
    if (short.length) failures.push(`${short.length} of ${floor.filter((r) => r.target === 5).length} built for 5 events got their question tested (${short.slice(0, 5).map((r) => `${r.question} ${r.k}`).join(", ")})`);
    for (const target of [6, 5]) {
      const t = amongTested(floor.filter((r) => r.target === target));
      console.log(`  Built for ${target}, with anything tested: ${t.histories}, any Yes ${t.anyYes} (${pct(t.anyYesShare)}), bound ${pct(BOUND)}`);
      held(`At the floor, built for ${target}`, t);
    }
  }

  if (failures.length) {
    console.error(`\nFAILED:\n${failures.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\nPassed: every set within ${pct(BOUND)}; at the floor, no event counted that wasn't built in and nothing tested below it; every question computed.`);
} else {
  const { bundle, tasks } = workerData;
  const { nullTrial, bandTrial, floorTrial } = await import(bundle);
  const out = tasks.map(([kind, a, b, c]) =>
    kind === "full" ? { kind, ...nullTrial(a) } : kind === "band" ? { kind, ...bandTrial(a, b) } : { kind, ...floorTrial(a, b, c) },
  );
  parentPort.postMessage(out);
}
