import type { Page } from "@playwright/test";
import { expect, returnVisit, test } from "./fixtures";

/* The sync screen's bar (`SyncScreen`, Roster's ProgressField): what a
   screen reader hears of it, how often, and that it's drawn as it was
   before it was Roster's. The status route is answered
   here, so the sync stands wherever a check needs it. */

/** A sync partway through: `pagesDone` pages of 200 plays read of `total`, back to March 2019. */
const syncing = (pagesDone: number, total: number) => ({
  status: "syncing",
  pagesDone,
  totalPages: Math.ceil(total / 200),
  totalScrobbles: total,
  newestUts: Date.UTC(2026, 9, 24) / 1000,
  oldestUts: Date.UTC(2019, 2, 1) / 1000,
  error: null,
  code: null,
});

/** Answers the status route, the nth call with `next(n)`. */
async function serveStatus(page: Page, next: (call: number) => object) {
  const served = { calls: 0 };
  await page.route("**/api/user/*/status?*", (route) => route.fulfill({ json: next(++served.calls) }));
  return served;
}

for (const width of [375, 1280]) {
  test(`says the sync in plain words, drawn as before, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await serveStatus(page, () => syncing(600, 499_871));
    await page.goto("/u/sample");
    const field = page.locator("[data-progress-field]");

    // Heard: the label and the figure together, from the page's one status
    // with words (the shell's own, for the sync's end, is there and empty).
    await expect(field.getByRole("status")).toHaveText("Listening history: 120,000 of 499,871 plays");
    await expect(page.getByRole("status").filter({ hasText: /\S/ })).toHaveCount(1);
    // Seen: the same pair, hidden from a screen reader so it isn't read twice, whole at 375px; then the line under it.
    await expect(field.locator("[aria-hidden=true] [data-progress-label]")).toHaveText("Listening history");
    await expect(field.locator("[aria-hidden=true] [data-progress-value]")).toHaveText("120,000 of 499,871 plays");
    await expect(field.locator("[data-progress-detail]")).toHaveText("Reaching back to 2019…");
    const cut = await field.evaluate((f) =>
      [...f.querySelectorAll("[data-progress-label], [data-progress-value]")].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
    );
    expect(cut).toEqual([]);

    // The bar: the old one's gold on surface-2, 6px tall, filled to the figure.
    const bar = () =>
      field.evaluate((f) => {
        const track = f.querySelector("[data-progress-track]")!;
        const fill = f.querySelector("[data-progress-fill]")!;
        return {
          fill: getComputedStyle(fill).backgroundColor,
          track: getComputedStyle(track).backgroundColor,
          height: track.getBoundingClientRect().height,
          filled: Math.round((fill.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100),
        };
      });
    await expect.poll(bar).toEqual({ fill: "rgb(212, 175, 55)", track: "rgb(23, 28, 61)", height: 6, filled: 24 });
  });
}

test("says the figure at most every 15 seconds, and the newest one then", async ({ page }) => {
  // Every change to what the status says, with what the bar showed then.
  await page.addInitScript(() => {
    const heard: { said: string; shown: string; at: number }[] = [];
    (window as unknown as { heard: typeof heard }).heard = heard;
    new MutationObserver(() => {
      const said = document.querySelector("[data-progress-field] [role=status]")?.textContent ?? "";
      const shown = document.querySelector("[data-progress-field] [data-progress-value]")?.textContent ?? "";
      if (said && heard.at(-1)?.said !== said) heard.push({ said, shown, at: performance.now() });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  // A page more at every call, about every 0.6 seconds: far faster than it's said.
  const served = await serveStatus(page, (n) => syncing(n, 100_000));
  await page.goto("/u/sample");

  const said = () => page.evaluate(() => (window as unknown as { heard: { said: string; shown: string; at: number }[] }).heard);
  await expect.poll(async () => (await said()).filter((h) => h.said.endsWith("plays")).length, { timeout: 25_000 }).toBeGreaterThanOrEqual(2);
  const heard = await said();
  const [first, second] = heard.filter((h) => h.said.endsWith("plays"));

  // Before a figure, "Loading"; the first figure at once, not held back.
  expect(heard[0].said).toBe("Listening history: Loading");
  expect(first.said).toBe("Listening history: 200 of 100,000 plays");
  expect(first.at - heard[0].at).toBeLessThan(5_000);
  // The next no sooner than 15 seconds on (less 100ms: the throttle's clock
  // and this one's stamp it a render apart), though the bar moved on 19
  // times or more in between, and then the figure the bar shows.
  expect(second.at - first.at).toBeGreaterThanOrEqual(14_900);
  expect(second.at - first.at).toBeLessThan(16_500);
  expect(Number(second.shown.split(" ")[0].replace(/,/g, ""))).toBeGreaterThanOrEqual(20 * 200);
  expect(second.said).toBe(`Listening history: ${second.shown}`);
  expect(served.calls).toBeGreaterThanOrEqual(20);
});

test("says when the history is read, from a status that was there, empty, while it was read", async ({ page }) => {
  await returnVisit(page);
  // Read over five calls, about 3 seconds, then ready, with the sample's answers stored.
  await serveStatus(page, (n) => (n < 6 ? syncing(n * 2, 1_900) : { ...syncing(10, 1_900), status: "ready", answersStored: true }));
  await page.goto("/u/sample");
  await expect(page.locator("[data-progress-field]")).toBeVisible();
  // While it's read: one status outside the sync screen, saying nothing yet.
  const quiet = await page.evaluate(() => {
    const statuses = [...document.querySelectorAll("[role=status]")].filter((s) => !s.closest("main") && s.textContent === "");
    for (const s of statuses) s.setAttribute("data-probe", "history-read");
    return statuses.length;
  });
  expect(quiet).toBe(1);
  // Then, as the sync screen goes, it says so, with the plays read.
  await expect(page.locator("[data-progress-field]")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("[data-probe=history-read]")).toHaveText("Listening history read: 1,900 plays.");
});
