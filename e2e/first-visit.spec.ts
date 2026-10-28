import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/* A first visit in a fresh browser (spec 8.2; ClickUp 86e3wjwy4). Each check
   gets a new context, so nothing is remembered and the reveal is due.
   "Checking 12 questions" is only for a listener with no stored answers for
   the zone; one with a record sees the view while the answers load, then the
   reveal. The seeded sample has a record for America/Chicago, and
   `firsttimer` has none anywhere (`global-setup.ts`). Production's long
   history read is stood in for by holding the data's responses. */

/** Each change in what the page shows, from its first paint: the checking
    step and what its status says, the view, or the reveal. */
const watch = (page: Page) =>
  page.addInitScript(() => {
    const seen: { what: string; said: string }[] = [];
    (window as unknown as { seen: typeof seen }).seen = seen;
    new MutationObserver(() => {
      const checking = [...document.querySelectorAll("main h1")].some((h) => h.textContent?.startsWith("Checking 12 questions"));
      const what = document.querySelector("[role=dialog][aria-label='Your sky']")
        ? "reveal"
        : checking
          ? "checking"
          : document.querySelector("main h1#view-heading")
            ? "view"
            : "other";
      const said = checking ? (document.querySelector("main [role=status]")?.textContent ?? "no status") : "";
      const last = seen.at(-1);
      if (last?.what !== what || last.said !== said) seen.push({ what, said });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
const seen = (page: Page) => page.evaluate(() => (window as unknown as { seen: { what: string; said: string }[] }).seen);

/** Holds a listener's answers, songs or highlights for `ms` each. */
async function hold(page: Page, name: string, routes: string[], ms: number) {
  for (const r of routes) {
    await page.route(`**/api/user/${name}/${r}?*`, async (route) => {
      await new Promise((done) => setTimeout(done, ms));
      await route.fallback();
    });
  }
}

/** What the status said when the history was ready: the zone it was asked for, and whether that zone's answers are stored. */
function readyStatus(page: Page, name: string) {
  return new Promise<{ tz: string | null; answersStored: unknown }>((resolve) => {
    page.on("response", async (res) => {
      if (!res.url().includes(`/api/user/${name}/status`)) return;
      const body = await res.json().catch(() => null);
      if (body?.status === "ready") resolve({ tz: new URL(res.url()).searchParams.get("tz"), answersStored: body.answersStored });
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
  await watch(page);
});

test("a listener with a record, first visit: the view while the answers load, then the reveal, never the checking step", async ({ page }) => {
  const status = readyStatus(page, "sample");
  await hold(page, "sample", ["answers", "songs", "highlights"], 2500);
  await page.goto("/u/sample");
  await expect(page.getByRole("dialog", { name: "Your sky" })).toBeVisible({ timeout: 30_000 });
  // The status was asked with the page's zone, and the record's is that zone.
  expect(await status).toEqual({ tz: "America/Chicago", answersStored: true });
  const shown = (await seen(page)).map((s) => s.what);
  expect(shown).not.toContain("checking");
  expect(shown.indexOf("view")).toBeGreaterThanOrEqual(0);
  expect(shown.indexOf("view")).toBeLessThan(shown.indexOf("reveal"));
  // No sync was watched, so the history's end isn't said either.
  await expect(page.getByRole("status").filter({ hasText: "Listening history read" })).toHaveCount(0);
});

test("a listener with no record for the zone, first visit: the checking step, then the reveal", async ({ page }) => {
  // A listener only this check visits, in a zone a different one each
  // repeat, so no record is there before this visit asks.
  const zones = Intl.supportedValuesOf("timeZone").filter((z) => /^(Pacific|Antarctica|Indian|Atlantic)\//.test(z));
  const zone = zones[test.info().repeatEachIndex % zones.length];
  const status = readyStatus(page, "firsttimer");
  // The songs held longer than the answers: the step lasts until the reveal.
  await hold(page, "firsttimer", ["answers"], 1500);
  await hold(page, "firsttimer", ["songs"], 3000);
  await page.goto(`/u/firsttimer?tz=${encodeURIComponent(zone)}`);
  await expect(page.getByRole("dialog", { name: "Your sky" })).toBeVisible({ timeout: 30_000 });
  expect(await status).toEqual({ tz: zone, answersStored: false });
  const shown = await seen(page);
  // The step shows, its status there empty before its words, which name what's counted.
  const checking = shown.filter((s) => s.what === "checking").map((s) => s.said);
  expect(checking).toEqual(["", "0 of 12 questions"]);
  expect(shown.map((s) => s.what).filter((w) => w !== "other")).toEqual(["checking", "checking", "reveal"]);
});

test("a sheet opened while a stored listener's answers load calls the reveal off, and leaves it unseen", async ({ page }) => {
  await hold(page, "sample", ["answers", "songs", "highlights"], 3000);
  const answered = page.waitForResponse((r) => r.url().includes("/api/user/sample/answers"));
  await page.goto("/u/sample");
  // The view is live while the data loads: a planet opens its sheet.
  const planet = page.locator("svg[aria-label='Sky wheel'] [data-body]").first();
  await planet.focus({ timeout: 30_000 });
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-testid=sheet-panel]")).toBeVisible();
  // The data lands under it, and the reveal doesn't come over the sheet.
  await answered;
  await page.waitForTimeout(1000);
  expect((await seen(page)).map((s) => s.what)).not.toContain("reveal");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid=sheet-panel]")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect((await seen(page)).map((s) => s.what)).not.toContain("reveal");
  expect(await page.evaluate(() => localStorage.getItem("retrospect:reveal-seen:sample"))).toBeNull();
});

test("a stored listener's answers failing on a first visit: the view says so, with no failure page and no reveal", async ({ page }) => {
  await page.route("**/api/user/sample/answers?*", (r) => r.fulfill({ status: 500, json: { error: "made to fail", code: "server" } }));
  await page.goto("/u/sample");
  await expect(page.getByText("The 12 questions didn’t load. Refresh to try again.").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await expect(page.getByText("Something went wrong on our side.")).toHaveCount(0);
  expect((await seen(page)).map((s) => s.what)).not.toContain("reveal");
});
