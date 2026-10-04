import type { Page } from "@playwright/test";
import { expect, returnVisit, selectedTabContrast, settle, smallTargets, test } from "./fixtures";

/* Sky (spec 8.6) in Chromium, on the seeded sample listener. The dial runs
   from the sample's first night, Thursday, Sept 28, 2023, to the server's
   tonight, so its length grows by a night a day: every check counts from
   the first night, or reads the dial's own ends. */

const SKY = "/u/sample/sky";
const slider = (page: Page) => page.getByRole("slider", { name: "Move through your nights" });

async function openSky(page: Page, query = "") {
  await returnVisit(page);
  // A picture of the day isn't in the seeded store (global-teardown.ts).
  await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
  await page.goto(SKY + query);
  await expect(page.locator("[data-sky-wheel] [data-body='Sun']")).toBeVisible({ timeout: 30_000 });
  // The sky module and the dial have come: the stars are placed and the dial moves.
  await expect(page.locator("[data-star]").first()).toBeVisible({ timeout: 15_000 });
  await expect(slider(page)).not.toHaveAttribute("aria-disabled", "true");
  // The wheel has opened (8.11): nothing is winding into place.
  await expect(page.locator("[data-sky-wheel]")).not.toHaveAttribute("data-opening", /./);
}

/** Saturn's angle every frame the wheel opens, from the page's first script. */
const recordOpening = (page: Page) =>
  page.addInitScript(() => {
    const rec = { angles: [] as number[], startedAt: -1, endedAt: -1, ever: false, opens: 0 };
    let was = false;
    (window as unknown as { __opening: typeof rec }).__opening = rec;
    const frame = () => {
      const state = document.querySelector("[data-sky-wheel]")?.getAttribute("data-opening");
      if (state) rec.ever = true;
      // Each time the wheel starts to open, from not opening.
      if (state && !was) rec.opens++;
      was = Boolean(state);
      const sat = document.querySelector<SVGGElement>("[data-sky-wheel] [data-body='Saturn']");
      if (state === "run" && sat) {
        if (rec.startedAt < 0) rec.startedAt = performance.now();
        const m = sat.transform.baseVal.consolidate()!.matrix;
        rec.angles.push((Math.atan2(m.f, -m.e) * 180) / Math.PI);
      }
      if (rec.startedAt >= 0 && state !== "run" && rec.endedAt < 0) rec.endedAt = performance.now();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
type Opening = { angles: number[]; startedAt: number; endedAt: number; ever: boolean; opens: number };
const opening = (page: Page) => page.evaluate(() => (window as unknown as { __opening: Opening }).__opening);
/** The wheel's animations still running. */
const wheelAnimations = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest("[data-sky-wheel]")).length,
  );

/** Each planet's and star's center on screen, by its item key ("planet:Venus", "star:{songId}"). */
const centers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGGElement>("[data-sky-wheel] [data-item]")].map((g) => {
      const m = g.getScreenCTM()!;
      return { key: g.dataset.item!, x: m.e, y: m.f };
    }),
  );

/** A point 21px from an item's center that no other item's center is as near to, or null. */
function freeSpot(items: { key: string; x: number; y: number }[], key: string) {
  const p = items.find((i) => i.key === key)!;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    const x = p.x + 21 * Math.cos(a);
    const y = p.y + 21 * Math.sin(a);
    if (items.every((o) => o === p || Math.hypot(x - o.x, y - o.y) > 22)) return { x, y };
  }
  return null;
}

for (const width of [375, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    test("the dial: a handle of 54 by 46px or more, and keys by night, week, month and the ends, spoken as dates (11)", async ({ page }) => {
      await openSky(page);
      const handle = await page.locator("[data-dial-handle]").boundingBox();
      expect(handle!.width).toBeGreaterThanOrEqual(54);
      expect(handle!.height).toBeGreaterThanOrEqual(46);
      const dial = slider(page);
      // At rest, tonight.
      await expect(dial).toHaveAttribute("aria-valuetext", /, tonight: /);
      const max = await dial.getAttribute("aria-valuemax");
      await expect(dial).toHaveAttribute("aria-valuenow", max!);
      await dial.focus();
      for (const [key, said, now] of [
        ["Home", "Thursday, Sept 28, 2023: ", "0"],
        ["ArrowRight", "Friday, Sept 29, 2023: ", "1"],
        ["PageUp", "Sunday, Oct 29, 2023: ", "31"],
        ["Shift+ArrowRight", "Sunday, Nov 5, 2023: ", "38"],
        ["PageDown", "Thursday, Oct 5, 2023: ", "7"],
        ["ArrowLeft", "Wednesday, Oct 4, 2023: ", "6"],
      ]) {
        await page.keyboard.press(key);
        await expect(dial, key).toHaveAttribute("aria-valuenow", now);
        expect(await dial.getAttribute("aria-valuetext"), key).toMatch(new RegExp(`^${said}(no plays|1 play|[\\d,]+ plays)`));
      }
      // The readout and the wheel's center say the night too.
      await expect(page.getByText("Wednesday, Oct 4, 2023", { exact: true })).toBeVisible();
      await expect(page.locator("[data-sky-wheel]")).toContainText("WEDOct 4");
      await page.keyboard.press("End");
      await expect(dial).toHaveAttribute("aria-valuenow", max!);
      await expect(dial).toHaveAttribute("aria-valuetext", /, tonight: /);
    });

    test("every planet and star a 44px target: a tap 21px from one, nearer it than any other, picks it (10, 11)", async ({ page }) => {
      await openSky(page);
      const items = await centers(page);
      expect(items.filter((i) => i.key.startsWith("planet:"))).toHaveLength(7);
      expect(items.filter((i) => i.key.startsWith("star:")).length).toBeGreaterThan(5);
      // Planets: the ones with a clear spot 21px out (orbits are 11px apart at 375).
      const planets = items.filter((i) => i.key.startsWith("planet:")).flatMap((i) => (freeSpot(items, i.key) ? [i.key] : []));
      expect(planets.length).toBeGreaterThanOrEqual(3);
      for (const key of planets.slice(0, 3)) {
        const body = key.slice("planet:".length);
        const spot = freeSpot(await centers(page), key)!;
        await page.mouse.click(spot.x, spot.y);
        await expect(page, key).toHaveURL(new RegExp(`[?&]planet=${body.toLowerCase()}(&|$)`));
        // Its sheet, and selected: its standing tints the signs, with a legend.
        const title = page.getByRole("heading", { name: `${body === "Sun" || body === "Moon" ? "The " : ""}${body} tonight` });
        await expect(title).toBeVisible();
        await expect(page.locator(`[data-body='${body}']`)).toHaveAttribute("data-selected", "true");
        await expect(page.locator("[data-legend]")).toContainText(`${body === "Sun" || body === "Moon" ? "The " : ""}${body}'s standing in each sign`);
        await page.keyboard.press("Escape");
        // The sheet gone, so the next tap meets the wheel, not the sheet leaving.
        await expect(title).toBeHidden();
        await expect(page).not.toHaveURL(/[?&]planet=/);
        // Clear takes the tints and the legend, and gives focus back to the planet.
        await page.locator("[data-legend]").getByRole("button", { name: "Clear" }).click();
        await expect(page.locator("[data-legend]")).toHaveCount(0);
        expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.body ?? null)).toBe(body);
      }
      // A tap more than 22px from every center picks nothing.
      const p = items.find((i) => i.key.startsWith("planet:") && freeSpot(items, i.key))!;
      const far = (() => {
        for (let k = 0; k < 48; k++) {
          const a = (k / 48) * 2 * Math.PI;
          const x = p.x + 23.5 * Math.cos(a);
          const y = p.y + 23.5 * Math.sin(a);
          if (items.every((o) => Math.hypot(x - o.x, y - o.y) > 23)) return { x, y };
        }
        return null;
      })();
      expect(far).not.toBeNull();
      await page.mouse.click(far!.x, far!.y);
      await page.waitForTimeout(300);
      await expect(page).not.toHaveURL(/[?&](planet|song)=/);
      // Two items whose 44px circles overlap: a tap between them goes to the nearer.
      const pair = (() => {
        for (const a of items)
          for (const b of items) {
            const dd = Math.hypot(a.x - b.x, a.y - b.y);
            if (a !== b && a.key.startsWith("planet:") && dd > 12 && dd < 40) return { a, b, dd };
          }
        return null;
      })();
      if (pair) {
        const x = pair.a.x + (pair.b.x - pair.a.x) * 0.35;
        const y = pair.a.y + (pair.b.y - pair.a.y) * 0.35;
        // Nearer a than b, and within 22px of both when they're under 44px apart.
        if (items.every((o) => o === pair.a || Math.hypot(x - o.x, y - o.y) > Math.hypot(x - pair.a.x, y - pair.a.y))) {
          await page.mouse.click(x, y);
          await expect(page).toHaveURL(new RegExp(`[?&]planet=${pair.a.key.slice("planet:".length).toLowerCase()}(&|$)`));
          const sheet = page.getByRole("heading", { name: /^(The )?\w+ tonight$/ });
          await expect(sheet).toBeVisible();
          await page.keyboard.press("Escape");
          // Gone, so the next tap meets the wheel.
          await expect(sheet).toBeHidden();
          await expect(page).not.toHaveURL(/[?&]planet=/);
          test.info().annotations.push({ type: "measured", description: `overlap: ${pair.a.key} and ${pair.b.key}, ${Math.round(pair.dd)}px apart` });
        }
      }
      const star = items.find((i) => i.key.startsWith("star:") && freeSpot(items, i.key))!;
      const spot = freeSpot(items, star.key)!;
      await page.mouse.click(spot.x, spot.y);
      await expect(page).toHaveURL(new RegExp(`[?&]song=${star.key.slice("star:".length)}(&|$)`));
      await page.keyboard.press("Escape");
      // The sheet gone before the page is measured.
      await expect(page.locator("[role=dialog]")).toHaveCount(0);
      // Every other target on the page, the dial and its buttons included, at least 44px.
      await page.evaluate(() => window.scrollTo(0, 0));
      const { small, reached } = await smallTargets(page);
      expect(small).toEqual([]);
      expect(reached).toBeGreaterThan(15);
    });

    test("a focused planet or star shows its own two-tone ring, and no square box (11)", async ({ page }) => {
      await openSky(page);
      const ring = () =>
        page.evaluate(() => {
          const el = document.activeElement as SVGGElement;
          const cs = getComputedStyle(el);
          const rings = [...el.querySelectorAll(".pl-sel")].map((r) => getComputedStyle(r).opacity);
          const other = document.querySelector(`[data-sky-wheel] [data-item]:not([data-item="${el.dataset.item}"]) .pl-sel`)!;
          return { item: el.dataset.item ?? "", outline: cs.outlineStyle, shadow: cs.boxShadow, rings, other: getComputedStyle(other).opacity };
        });
      // Into the wheel by keys, then on until a planet has focus, and on until a star does.
      await page.locator("[data-sky-wheel] [data-item][tabindex='0']").focus();
      // By a key, so focus is the keyboard's (:focus-visible).
      await page.keyboard.press("ArrowRight");
      for (const kind of ["planet", "star"]) {
        let r = await ring();
        for (let i = 0; i < 25 && !r.item.startsWith(`${kind}:`); i++) {
          await page.keyboard.press("ArrowRight");
          r = await ring();
        }
        expect(r.item, kind).toMatch(new RegExp(`^${kind}:`));
        expect(r, kind).toMatchObject({ outline: "none", shadow: "none", rings: ["1", "1"], other: "0" });
      }
    });

    test("the selected tab's contrast on the real switcher, with Sky the third link (11; ClickUp 86e3h9mca)", async ({ page }) => {
      await openSky(page);
      const tab = await selectedTabContrast(page);
      expect(tab).toMatchObject({ label: "Sky", links: 3 });
      expect(tab!.ratio).toBeGreaterThanOrEqual(4.5);
      expect(tab!.other.ratio).toBeGreaterThanOrEqual(4.5);
      test.info().annotations.push({
        type: "measured",
        description: `at ${width}px, Sky selected: ${tab!.ratio}:1; ${tab!.other.label} unselected: ${tab!.other.ratio}:1`,
      });
    });
  });
}

test.describe("moving the sky (8.6, 8.11)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Play your years runs, and stops on a key press and on a pointer down anywhere (2.2.2)", async ({ page }) => {
    await openSky(page);
    const dial = slider(page);
    const now = async () => Number(await dial.getAttribute("aria-valuenow"));
    for (const how of ["key", "pointer"] as const) {
      await page.getByRole("button", { name: "Play your years" }).click();
      // A toggle by its words (11): "Pause" while it plays.
      await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
      // It plays: the dial moves on by itself.
      const a = await now();
      await expect.poll(now).toBeGreaterThan(a + 5);
      if (how === "key") {
        // Its flashes and pulses come at most two a second each (8.11), not
        // a frame at a time as it crosses a night most frames.
        const flashes = await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let n = 0;
              const mo = new MutationObserver((list) => {
                for (const m of list) for (const node of m.addedNodes) if (node instanceof Element && node.matches(".sky-flash, .sky-beat, .sky-lit")) n++;
              });
              mo.observe(document.querySelector("[data-sky-wheel]")!, { childList: true, subtree: true });
              setTimeout(() => {
                mo.disconnect();
                resolve(n);
              }, 1000);
            }),
        );
        expect(flashes).toBeGreaterThan(0);
        expect(flashes).toBeLessThan(12);
      }
      if (how === "key") await page.keyboard.press("Shift");
      else {
        await page.mouse.move(8, 400);
        await page.mouse.down();
        await page.mouse.up();
      }
      await expect(page.getByRole("button", { name: "Play your years" }), how).toBeVisible();
      await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
      const stopped = await now();
      await page.waitForTimeout(400);
      expect(await now(), how).toBe(stopped);
    }
  });

  test("keys pressed fast step from where the dial is going, not from where a trip has got to (11)", async ({ page }) => {
    await openSky(page);
    const dial = slider(page);
    await dial.focus();
    await page.keyboard.press("Home");
    await expect(dial).toHaveAttribute("aria-valuenow", "0");
    // Three nights on, pressed as fast as keys go.
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect(dial).toHaveAttribute("aria-valuenow", "3");
    await expect(dial).toHaveAttribute("aria-valuetext", /^Sunday, Oct 1, 2023: /);
    // Two months on, keeping the day: Dec 1.
    await page.keyboard.press("PageUp");
    await page.keyboard.press("PageUp");
    await expect(dial).toHaveAttribute("aria-valuetext", /^Friday, Dec 1, 2023: /);
  });

  test("letting go within 6 nights of a wild night snaps to it, and its card opens the night", async ({ page }) => {
    await openSky(page);
    const dial = slider(page);
    const box = (await dial.boundingBox())!;
    const max = Number(await dial.getAttribute("aria-valuemax"));
    // May 10, 2024 is night 225 from Sept 28, 2023. Let go about 4 nights before it.
    const xOf = (i: number) => box.x + 27 + (i / max) * (box.width - 54);
    const handle = (await page.locator("[data-dial-handle]").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(xOf(260), handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.move(xOf(221), handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(dial).toHaveAttribute("aria-valuetext", /^Friday, May 10, 2024: \d+ plays, solar storm Kp 9/);
    const card = page.locator("[data-snap]");
    await expect(card).toContainText("The strongest geomagnetic storm in about 20 years");
    await card.getByRole("button", { name: "Open this night" }).click();
    await expect(page).toHaveURL(/[?&]night=2024-05-10(&|$)/);
  });

  test("Jump to a wild night goes to the first of the history's, and Back to tonight comes home", async ({ page }) => {
    await openSky(page);
    const dial = slider(page);
    await page.getByRole("button", { name: "Jump to a wild night" }).click();
    // From tonight it cycles round to the first: Oct 14, 2023, the annular eclipse.
    await expect(dial).toHaveAttribute("aria-valuetext", /^Saturday, Oct 14, 2023: /);
    await expect(page.locator("[data-snap]")).toContainText("An annular eclipse across the US");
    await page.getByRole("button", { name: "Back to tonight" }).click();
    await expect(dial).toHaveAttribute("aria-valuetext", /, tonight: /);
    await expect(page.locator("[data-snap]")).toHaveCount(0);
  });

  test("the wheel opens once a visit: the planets wind into place in 2s, and all that moved by itself is still within 5s (8.11, 2.2.2)", async ({ page }) => {
    await recordOpening(page);
    await openSky(page);
    const o = await opening(page);
    // Saturn, the farthest out, winds back 294° and comes round to its place.
    let travel = 0;
    for (let i = 1; i < o.angles.length; i++) travel += Math.abs(((o.angles[i] - o.angles[i - 1] + 540) % 360) - 180);
    expect(o.angles.length).toBeGreaterThan(10);
    expect(travel).toBeGreaterThan(250);
    // 1.9s, with room for a slow runner's frames.
    expect(o.endedAt - o.startedAt).toBeLessThan(2400);
    // The stars still twinkle a moment after (the check can see them)...
    await page.waitForFunction((t) => performance.now() >= t, o.startedAt + 2600);
    expect(await wheelAnimations(page)).toBeGreaterThan(0);
    // ...and by 5 seconds nothing moves (2.2.2): checked at 4.9, before the
    // opening's own cleanup at 5, so it's the twinkle's own end that's seen.
    await page.waitForFunction((t) => performance.now() >= t, o.startedAt + 4900);
    expect(await wheelAnimations(page)).toBe(0);
    expect(o.opens).toBe(1);
    // Not again on a return from another view, given time to.
    await page.getByRole("link", { name: "Tonight" }).click();
    await expect(page).toHaveURL(/\/u\/sample$/);
    await page.getByRole("link", { name: "Sky" }).click();
    await expect(page.locator("[data-star]").first()).toBeVisible();
    await page.waitForTimeout(2500);
    expect((await opening(page)).opens).toBe(1);
  });

  test("any input ends the opening at once, every planet in its place (2.2.2)", async ({ page }) => {
    await recordOpening(page);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    await expect(wheel).toHaveAttribute("data-opening", "run", { timeout: 30_000 });
    // The stars are on their way in...
    expect(await wheelAnimations(page)).toBeGreaterThan(0);
    await page.keyboard.press("Shift");
    await expect(wheel).not.toHaveAttribute("data-opening", /./, { timeout: 300 });
    // ...and stop with the planets.
    await expect.poll(() => wheelAnimations(page), { timeout: 300 }).toBe(0);
    const saturn = wheel.locator("[data-body='Saturn']");
    const at = await saturn.getAttribute("transform");
    await page.waitForTimeout(600);
    expect(await saturn.getAttribute("transform")).toBe(at);
    // The control: left alone, it was still on its way when the key came.
    const o = await opening(page);
    expect(o.angles.length).toBeGreaterThan(0);
    expect(o.endedAt - o.startedAt).toBeLessThan(1500);
  });

  test("a press that stops the opening only stops it: it opens nothing where a planet was going (11)", async ({ page }) => {
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    const saturn = wheel.locator("[data-body='Saturn']");
    await expect(wheel).not.toHaveAttribute("data-opening", /./, { timeout: 30_000 });
    const box = (await saturn.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // A new visit opens again; press where Saturn is going while it winds.
    await page.reload();
    await expect(wheel).toHaveAttribute("data-opening", "run", { timeout: 30_000 });
    await page.mouse.click(at.x, at.y);
    await expect(wheel).not.toHaveAttribute("data-opening", /./);
    await page.waitForTimeout(600);
    await expect(page.getByRole("heading", { name: /^Saturn/ })).toHaveCount(0);
    // The control: the same press now, with Saturn there, opens it.
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole("heading", { name: /^Saturn/ }).first()).toBeVisible();
  });

  test("the reveal's keys don't use up the opening: it runs once the reveal is done", async ({ page }) => {
    await recordOpening(page);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("retrospect:guide-done", "1");
        localStorage.removeItem("retrospect:reveal-seen:sample");
      } catch {}
    });
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    const reveal = page.getByRole("dialog", { name: "Your sky" });
    await expect(reveal).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(reveal).toBeHidden();
    await expect(page.locator("[data-sky-wheel]")).not.toHaveAttribute("data-opening", /./, { timeout: 10_000 });
    const o = await opening(page);
    expect(o.startedAt).toBeGreaterThan(0);
    expect(o.angles.length).toBeGreaterThan(10);
  });

  test("the opening waits until the wheel is on screen, then runs (8.11)", async ({ page }) => {
    await recordOpening(page);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    // A window too short to show the wheel at all.
    await page.setViewportSize({ width: 375, height: 120 });
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    await expect(wheel.locator("[data-body='Sun']")).toBeAttached({ timeout: 30_000 });
    await expect(page.locator("[data-star]").first()).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    expect((await opening(page)).startedAt).toBe(-1);
    await expect(wheel).toHaveAttribute("data-opening", "hold");
    // On screen, it runs, and ends.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(wheel).not.toHaveAttribute("data-opening", /./, { timeout: 5000 });
    expect((await opening(page)).angles.length).toBeGreaterThan(10);
  });

  test("under reduced motion the wheel doesn't open and nothing in it moves by itself (8.11, 11)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordOpening(page);
    await openSky(page);
    await page.waitForTimeout(500);
    expect((await opening(page)).ever).toBe(false);
    expect(await wheelAnimations(page)).toBe(0);
  });

  test("under reduced motion nothing tweens: a planet is at its final place on the next frame (8.11, 11)", async ({ page }) => {
    const marsAfterHome = async (reduce: boolean) => {
      await page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
      await openSky(page);
      const mars = page.locator("[data-sky-wheel] [data-body='Mars']");
      const before = await mars.getAttribute("transform");
      await slider(page).focus();
      await page.keyboard.press("Home");
      await settle(page);
      const next = await mars.getAttribute("transform");
      await expect(slider(page)).toHaveAttribute("aria-valuenow", "0");
      await page.waitForTimeout(1700);
      return { before, next, last: await mars.getAttribute("transform") };
    };
    // Reduced: the next frame is the end.
    const still = await marsAfterHome(true);
    expect(still.next).not.toBe(still.before);
    expect(still.next).toBe(still.last);
    // The control: with motion, the next frame is on the way, not there yet.
    const moving = await marsAfterHome(false);
    expect(moving.next).not.toBe(moving.last);
    expect(moving.last).toBe(still.last);
  });
});

test.describe("the states (8.6)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("a link with a zone the server won't take still opens: the dial runs in the zone the nights were cut in", async ({ page }) => {
    await openSky(page, "?tz=%2B05%3A00");
    await expect(slider(page)).toHaveAttribute("aria-valuetext", /, tonight: /);
    await page.getByRole("button", { name: "Jump to a wild night" }).click();
    await expect(page.locator("[data-snap]")).toBeVisible();
  });

  test("songs that didn't load say so with Try again, and the stars come back", async ({ page }) => {
    let fail = true;
    await page.route("**/api/user/sample/songs?*", (r) => (fail ? r.fulfill({ status: 503, json: { error: "unavailable" } }) : r.fallback()));
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    await expect(page.getByText("Your songs didn’t load.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-star]")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(page.locator("[data-star]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("the birth chart opens only on Sky: on Tonight its link is refused", async ({ page }) => {
    await returnVisit(page);
    await page.goto("/u/sample?chart=you");
    await expect(page).not.toHaveURL(/[?&]chart=/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Your birth chart" })).toHaveCount(0);
  });

  test("nights that didn't load say so with Try again, while the wheel keeps tonight's planets", async ({ page }) => {
    let fail = true;
    await page.route("**/api/user/sample/dial?*", (r) => (fail ? r.fulfill({ status: 503, json: { error: "unavailable" } }) : r.fallback()));
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    await expect(page.getByText("Your nights didn’t load.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-sky-wheel] [data-body]")).toHaveCount(7);
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(slider(page)).toHaveAttribute("aria-valuetext", /, tonight: /);
  });

  test("a birth chart stays in the browser: saved, it draws the natal planets and the link reads Your chart (8.6 item 5)", async ({ page }) => {
    const sent: string[] = [];
    page.on("request", (r) => sent.push(`${r.url()} ${r.postData() ?? ""}`));
    await openSky(page);
    await page.getByRole("link", { name: "Add your birth chart" }).click();
    await expect(page).toHaveURL(/[?&]chart=you(&|$)/);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Your birth chart" })).toBeVisible();
    await sheet.getByLabel("Birth date").fill("1990-06-15");
    await sheet.getByRole("button", { name: /save/i }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Your chart" })).toBeVisible();
    // Five natal glyphs just inside the signs.
    await expect(page.locator("[data-sky-wheel] [data-natal]")).toHaveCount(5);
    expect(sent.filter((s) => s.includes("1990"))).toEqual([]);
  });
});
