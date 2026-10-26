import type { Page } from "@playwright/test";
import { escapeSheet, expect, returnVisit, settle, test } from "./fixtures";

/* The wheels' focus rings after a click (ClickUp 86e3rwyff), in Chromium and
   WebKit, with the real mouse and keys. Both wheels draw their own ring and
   move focus by script when an arrow key is pressed. WebKit doesn't match
   :focus-visible on an element a script focuses in answer to a key once the
   page has been clicked, so after a planet was clicked its ring stayed off
   in Safari, through Escape and the arrows. Roster's tracker marks what a
   key moved focus to, and the rings show for the mark too (globals.css).
   Chromium's own :focus-visible already showed them; it's checked as it was. */

/** The focused element's name, its ring's opacity ("1" shown, "0" not), and
    how many of the wheel's ring circles show: a planet's ring is two, so
    any more is a second planet ringed (a mark left behind). */
const focused = (page: Page, wheel: string) =>
  page.evaluate((w) => {
    const el = document.activeElement;
    const ring = el?.querySelector(".pl-sel");
    const shown = [...document.querySelectorAll(`${w} .pl-sel`)].filter((c) => getComputedStyle(c).opacity === "1").length;
    return { item: el?.getAttribute("data-item") ?? el?.getAttribute("data-body") ?? null, ring: ring ? getComputedStyle(ring).opacity : null, shown };
  }, wheel);

/** Roster's sheet panel: its dialog role sits on a wrapper with no size. */
const SHEET = "[data-testid=sheet-panel]";

/** A real click at a planet's place: the screen point its group is
    translated to, where the wheel measures a tap from. (A glyph's box is the
    font's, and with a ℞ beside it, its middle lies off the planet, nearer a
    neighbor on some nights.) */
async function clickAt(page: Page, group: string) {
  const at = await page.locator(group).first().evaluate((g) => {
    const m = (g as SVGGElement).getScreenCTM()!;
    return { x: m.e, y: m.f };
  });
  await page.mouse.click(at.x, at.y);
}

/** Nothing finite still running (the wheel's arrival or opening), at most
    5 seconds, then two frames. */
async function still(page: Page) {
  await page.evaluate(() => {
    const running = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
    return Promise.race([Promise.all(running.map((a) => a.finished.catch(() => undefined))), new Promise((done) => setTimeout(done, 5000))]);
  });
  await settle(page);
}

test.describe("a wheel's ring after a click, then the keys (11)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await returnVisit(page);
    // A picture of the day isn't in the seeded store (global-teardown.ts).
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
  });

  test("Tonight: a planet clicked, its sheet closed with Escape, then an arrow, rings the planet each time", async ({ page }) => {
    await page.goto("/u/sample");
    const WHEEL = "svg[aria-label='Sky wheel']";
    const wheel = page.locator(WHEEL);
    await expect(wheel.locator("[data-body]").first()).toBeVisible({ timeout: 30_000 });
    await still(page);
    const body = (await wheel.locator("[data-body]").nth(2).getAttribute("data-body"))!;
    // The planet's place: the group its halo and rings are drawn around.
    await clickAt(page, `${WHEEL} [data-body="${body}"] > g`);
    await expect(page.locator(SHEET)).toBeVisible();
    await escapeSheet(page);
    await expect(page.locator(SHEET)).toHaveCount(0);
    // Focus is back on the planet the click opened, by a key: its ring shows, and no other.
    await expect.poll(() => focused(page, WHEEL)).toEqual({ item: body, ring: "1", shown: 2 });
    await page.keyboard.press("ArrowRight");
    const next = await focused(page, WHEEL);
    expect(next.item).not.toBe(body);
    expect(next, `${next.item}'s ring`).toMatchObject({ ring: "1", shown: 2 });
  });

  test("Sky: a planet clicked, its legend cleared with the mouse, then an arrow, rings what the arrow moves to", async ({ page }) => {
    await page.goto("/u/sample/sky");
    const WHEEL = "[data-sky-wheel]";
    const wheel = page.locator(WHEEL);
    await expect(wheel.locator('[data-glyph="Mars"]')).toBeVisible({ timeout: 30_000 });
    await expect(wheel).not.toHaveAttribute("data-opening", /.+/, { timeout: 30_000 });
    await still(page);
    await clickAt(page, `${WHEEL} [data-item="planet:Mars"]`);
    await expect(page.locator(SHEET)).toBeVisible();
    await escapeSheet(page);
    await expect(page.locator(SHEET)).toHaveCount(0);
    // "Clear", clicked, puts focus back on Mars by script: no ring for a pointer.
    await page.locator("[data-legend]").getByRole("button", { name: "Clear" }).click();
    await expect.poll(() => focused(page, WHEEL)).toEqual({ item: "planet:Mars", ring: "0", shown: 0 });
    await page.keyboard.press("ArrowRight");
    const next = await focused(page, WHEEL);
    expect(next.item).not.toBe("planet:Mars");
    expect(next, `${next.item}'s ring`).toMatchObject({ ring: "1", shown: 2 });
  });
});
