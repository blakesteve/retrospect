import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Guards on CI's workflows that a review can miss (ClickUp 86e3v3jtd). Every
   job runs on Ubuntu 24.04, because `ubuntu-latest` became 26.04 on 22 Oct
   2026 and Playwright 1.58.2 can't install its browsers there; and every job
   has a ceiling, so a stall fails inside a stated bound instead of at
   GitHub's six hours. The workflow files and their jobs are listed by name,
   so a new one fails here until it's added, and so checked. */

const root = path.resolve(__dirname, "../..");
const workflow = (file: string) => readFileSync(path.join(root, ".github/workflows", file), "utf8");

/** Each job under `jobs:`, by its key: its runner and its ceiling in minutes. */
function jobs(yaml: string) {
  const body = yaml.slice(yaml.indexOf("\njobs:\n") + 1);
  return body
    .split(/\n {2}(?=[A-Za-z_][\w-]*:\n)/)
    .slice(1)
    .map((job) => ({
      job: job.slice(0, job.indexOf(":")),
      runsOn: job.match(/\n {4}runs-on: (\S+)/)?.[1] ?? null,
      timeout: Number(job.match(/\n {4}timeout-minutes: (\d+)(?:\n|$)/)?.[1] ?? NaN),
    }));
}

const WORKFLOWS: [string, string[]][] = [
  ["ci.yml", ["test", "lint", "browser"]],
  ["null-test.yml", ["null-test"]],
];

describe("CI's workflows", () => {
  it("are these, every one of them", () => {
    expect(readdirSync(path.join(root, ".github/workflows")).sort()).toEqual(WORKFLOWS.map(([f]) => f).sort());
  });

  it.each(WORKFLOWS)("%s runs every job on Ubuntu 24.04, with a ceiling", (file, names) => {
    const found = jobs(workflow(file));
    expect(found.map((j) => j.job)).toEqual(names);
    for (const j of found) {
      expect(j.runsOn, j.job).toBe("ubuntu-24.04");
      expect(j.timeout, j.job).toBeGreaterThanOrEqual(10);
      expect(j.timeout, j.job).toBeLessThanOrEqual(30);
    }
  });

  it("reads a job left on ubuntu-latest, or with no ceiling, as such", () => {
    const loose =
      "on: push\n\njobs:\n  a:\n    name: A\n    runs-on: ubuntu-latest\n\n    steps:\n      - run: true\n  b:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 12\n  E2E:\n    runs-on: ubuntu-latest\n  _x:\n    runs-on: ubuntu-24.04\n";
    expect(jobs(loose)).toEqual([
      { job: "a", runsOn: "ubuntu-latest", timeout: NaN },
      { job: "b", runsOn: "ubuntu-24.04", timeout: 12 },
      { job: "E2E", runsOn: "ubuntu-latest", timeout: NaN },
      { job: "_x", runsOn: "ubuntu-24.04", timeout: NaN },
    ]);
  });
});
