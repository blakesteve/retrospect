import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Guards on CI's workflows that a review can miss (ClickUp 86e3v3jtd). Every
   job runs on Ubuntu 24.04, because `ubuntu-latest` became 26.04 on 22 Oct
   2026 and Playwright 1.58.2 can't install its browsers there; and every job
   has a ceiling, under 15 minutes, so a stall fails inside a stated bound
   instead of at GitHub's six hours. The browser checks run in Playwright's
   own image, so nothing comes from Ubuntu's mirrors (one sat 15 minutes on
   25 Oct), and the browsers in an image launch only from the same version of
   the playwright package: a lockfile bump without the image, or the reverse,
   would fail at launch, and only in CI. Each of their steps has a ceiling
   inside the job's, because a step that times out fails and keeps its
   failures, and a job that times out is cancelled and keeps nothing. The
   workflow files and their jobs are listed by name, so a new one fails here
   until it's added, and so checked. */

const root = path.resolve(__dirname, "../..");
const workflow = (file: string) => readFileSync(path.join(root, ".github/workflows", file), "utf8");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));

/**
 * Each job under `jobs:`, by its key: its runner, its ceiling in minutes, the
 * image it runs in, and its steps, each with whether it runs a command and
 * its own ceiling.
 */
function jobs(yaml: string) {
  const body = yaml.slice(yaml.indexOf("\njobs:\n") + 1);
  return body
    .split(/\n {2}(?=[A-Za-z_][\w-]*:\n)/)
    .slice(1)
    .map((job) => ({
      job: job.slice(0, job.indexOf(":")),
      runsOn: job.match(/\n {4}runs-on: (\S+)/)?.[1] ?? null,
      timeout: Number(job.match(/\n {4}timeout-minutes: (\d+)(?:\n|$)/)?.[1] ?? NaN),
      image: job.match(/\n {4}container:\n((?: {6}.*(?:\n|$))*)/)?.[1].match(/^ {6}image: (\S+)/m)?.[1] ?? null,
      steps: job
        .split(/\n {6}- /)
        .slice(1)
        .map((step) => ({
          runs: /^run:|\n {8}run:/.test(step),
          timeout: Number(step.match(/(?:^|\n {8})timeout-minutes: (\d+)(?:\n|$)/)?.[1] ?? NaN),
        })),
    }));
}

/** A workflow's lines that aren't comments. */
const commands = (yaml: string) =>
  yaml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
/** A browser or a system library installed: `npx playwright install` or `install-deps`, any version; apt or apt-get. */
const INSTALLS = /\bplaywright(?:@\S+)?\s+install\b|\bapt(?:-get)?\s+(?:-\S+\s+)*install\b/;

const WORKFLOWS: [string, string[]][] = [
  ["ci.yml", ["test", "lint", "browser"]],
  ["null-test.yml", ["null-test"]],
];

describe("CI's workflows", () => {
  it("are these, every one of them", () => {
    expect(readdirSync(path.join(root, ".github/workflows")).sort()).toEqual(WORKFLOWS.map(([f]) => f).sort());
  });

  it.each(WORKFLOWS)("%s runs every job on Ubuntu 24.04, with a ceiling under 15 minutes", (file, names) => {
    const found = jobs(workflow(file));
    expect(found.map((j) => j.job)).toEqual(names);
    for (const j of found) {
      expect(j.runsOn, j.job).toBe("ubuntu-24.04");
      expect(j.timeout, j.job).toBeGreaterThanOrEqual(10);
      expect(j.timeout, j.job).toBeLessThan(15);
    }
  });

  it("run the browser checks in Playwright's image for the locked version, and install nothing", () => {
    const locked = ["playwright", "playwright-core", "@playwright/test"].map((p) => lock.packages[`node_modules/${p}`].version);
    expect(new Set(locked).size).toBe(1);
    const images = WORKFLOWS.flatMap(([file]) => jobs(workflow(file)).map((j) => [j.job, j.image]));
    expect(images.filter(([, image]) => image !== null)).toEqual([["browser", `mcr.microsoft.com/playwright:v${locked[0]}-noble`]]);
    for (const [file] of WORKFLOWS) expect(commands(workflow(file)), file).not.toMatch(INSTALLS);
  });

  it("give each step of the browser checks that runs something a ceiling, together inside the job's", () => {
    const browser = jobs(workflow("ci.yml")).find((j) => j.job === "browser")!;
    const run = browser.steps.filter((s) => s.runs);
    expect(run.length).toBeGreaterThanOrEqual(3);
    for (const s of run) expect(s.timeout).toBeGreaterThan(0);
    expect(run.reduce((n, s) => n + s.timeout, 0)).toBeLessThan(browser.timeout);
  });

  it("reads a job left on ubuntu-latest, or with no ceiling, as such", () => {
    const loose =
      "on: push\n\njobs:\n  a:\n    name: A\n    runs-on: ubuntu-latest\n\n    steps:\n      - run: true\n  b:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 12\n  E2E:\n    runs-on: ubuntu-latest\n    container:\n      # the browsers\n      options: --ipc=host\n      image: mcr.microsoft.com/playwright:v1.57.0-noble\n    env:\n      image: not-this\n  _x:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v4\n\n      - name: Step\n        timeout-minutes: 3\n        run: true\n";
    expect(jobs(loose)).toEqual([
      { job: "a", runsOn: "ubuntu-latest", timeout: NaN, image: null, steps: [{ runs: true, timeout: NaN }] },
      { job: "b", runsOn: "ubuntu-24.04", timeout: 12, image: null, steps: [] },
      { job: "E2E", runsOn: "ubuntu-latest", timeout: NaN, image: "mcr.microsoft.com/playwright:v1.57.0-noble", steps: [] },
      // A step's ceiling is the step's, never the job's.
      { job: "_x", runsOn: "ubuntu-24.04", timeout: NaN, image: null, steps: [{ runs: false, timeout: NaN }, { runs: true, timeout: 3 }] },
    ]);
    // What counts as an install, and that a comment naming one doesn't.
    for (const install of ["npx playwright install --with-deps chromium", "npx playwright@1.58.2 install webkit", "npx playwright install-deps webkit", "sudo apt -y install libflite1", "apt-get install -y x"]) {
      expect(install).toMatch(INSTALLS);
    }
    expect(commands("    # once installed the old way: npx playwright install, then apt-get install\n        run: npm ci\n")).not.toMatch(INSTALLS);
    expect("adapt installs, and npx playwright test").not.toMatch(INSTALLS);
  });
});
