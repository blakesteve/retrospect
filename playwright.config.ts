import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Retrospect's browser checks (`npm run test:browser`): what jsdom can't see,
 * measured in Chromium on the built app, served from a fresh folder holding
 * only made-up listeners: the landing's sample, and compare's newcomer
 * (`e2e/global-setup.ts`). Run `npm run build` first.
 *
 * Never real data. `next start` reads any `.env*` file beside it, and the
 * store turns to R2 when R2's variables are set, so the checks refuse to run
 * with either: in CI there are none, and locally they run in a copy of the
 * repo without its env files.
 */

const root = __dirname;
const envFiles = readdirSync(root).filter((f) => f.startsWith(".env"));
if (envFiles.length > 0) {
  throw new Error(`The browser checks never run beside env files (${envFiles.join(", ")}): run them in a copy of the repo without them.`);
}
const r2 = Object.keys(process.env).filter((k) => k.startsWith("R2_"));
if (r2.length > 0) throw new Error(`The browser checks never run with R2's variables set (${r2.join(", ")}).`);
if (!existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("Build the app first: npm run build.");

/** The seeded store: deleted and written again by every run. */
export const DATA_DIR = path.join(root, "e2e", ".data");
// One run id, set where the run starts and inherited by its workers.
process.env.BROWSER_CHECKS_RUN ??= String(Date.now());
/** Every request the server tried off this machine (`e2e/offline.mjs`), a
    file per run, outside the seeded folder so seeding can't erase it. */
export const BLOCKED_LOG = path.join(root, "e2e", ".offline", `blocked-${process.env.BROWSER_CHECKS_RUN}.log`);
const PORT = 4317;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "dark",
    timezoneId: "America/Chicago",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/`,
    // Never someone's own server on that port: Playwright stops if it's taken.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATA_DIR,
      // No network from the server: offline.mjs refuses and logs any request off this machine.
      NODE_OPTIONS: `--import ${JSON.stringify(path.join(root, "e2e", "offline.mjs"))}`,
      BLOCKED_LOG,
      // A key in the shell would send album art and genres to Last.fm.
      LASTFM_API_KEY: "",
      // The seeded history is complete: it never asks Last.fm for more.
      SYNC_REFRESH_SECONDS: String(10 * 365 * 86_400),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
