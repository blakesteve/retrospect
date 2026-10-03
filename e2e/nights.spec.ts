import type { Page } from "@playwright/test";
import { expect, returnVisit, selectedTabContrast, settle, smallTargets, test } from "./fixtures";

/* Every night (spec 8.5) in Chromium, on the seeded sample listener. The
   browser's clock is held at 8 p.m. on Wednesday, May 15, 2024, Central, so
   tonight is a night inside the sample's history whatever day the checks
   run: the calendar runs from its first night, Sept 28, 2023, to May 15,
   2024, and every date below is a literal. Each check asserts that it
   reached what it measures. */

const NOW = new Date("2024-05-15T20:00:00-05:00");
const NIGHTS = "/u/sample/nights";
const DOOR = "[data-door]";
const BAR = "[data-nights-bar]";
const DOCK = "[data-nights-dock]";

async function openNights(page: Page, query = "", now = NOW, ready = `${DOOR}[data-tonight]`) {
  await page.clock.setFixedTime(now);
  await returnVisit(page);
  // A night's picture of the day isn't in the seeded store: answered here,
  // so the server never asks NASA for it (global-teardown.ts).
  await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
  await page.goto(NIGHTS + query);
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
}

/** Scroll the whole calendar past, so every month renders its doors. */
async function renderAll(page: Page) {
  for (let y = 0; ; y += 500) {
    const end = await page.evaluate((yy) => {
      window.scrollTo(0, yy);
      return yy > document.documentElement.scrollHeight - window.innerHeight;
    }, y);
    await settle(page);
    if (end) break;
  }
  // Every month drawn: its doors, or under a filter its one line. None still waits.
  await expect(page.locator(".door-ph")).toHaveCount(0);
}

const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.door ?? null);

/** Where the focused door sits: below the sticky bar, above the dock (if any) and inside the window (11). */
const focusClear = (page: Page) =>
  page.evaluate(
    ({ bar, dock }) => {
      const r = document.activeElement!.getBoundingClientRect();
      const top = document.querySelector(bar)!.getBoundingClientRect().bottom;
      const bottom = document.querySelector(dock)?.getBoundingClientRect().top ?? window.innerHeight;
      return r.top >= top && r.bottom <= bottom;
    },
    { bar: BAR, dock: DOCK },
  );

/** How each layer of a door shows: its own opacity times every ancestor's.
    The fill is the door's ::before (globals.css). */
const layers = (page: Page, date: string) =>
  page.locator(`${DOOR}[data-door='${date}']`).evaluate((door) => {
    const shown = (el: Element | null, own = 1) => {
      if (!el) return null;
      let o = own;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return Math.round(o * 100) / 100;
    };
    return {
      date: shown(door.querySelector(".door-dn")),
      fill: shown(door, Number(getComputedStyle(door, "::before").opacity)),
      moon: shown(door.querySelector(".door-moon")),
      badges: shown(door.querySelector(".door-badges")),
    };
  });

/** The lowest contrast of a door's date on its own fill (1.4.3), over the
    doors `selector` finds, at every stop of the fill's gradient. Each layer
    as it shows: the fill's colors times its opacity, over the page's sky,
    and the date's ink times its own. */
const dateContrast = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    // One color over another, either of them translucent.
    const over = (top: number[], under: number[]) => {
      const a = top[3] + under[3] * (1 - top[3]);
      return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
    };
    const fade = (c: number[], k: number) => [c[0], c[1], c[2], c[3] * k];
    const shown = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (x: number[], y: number[]) => {
      const [a, b] = [lum(x), lum(y)].sort((m, n) => n - m);
      return (a + 0.05) / (b + 0.05);
    };
    const sky = rgba(getComputedStyle(document.body).backgroundColor);
    let worst = { ratio: 99, door: "" };
    let measured = 0;
    let painted = 0;
    for (const door of document.querySelectorAll<HTMLElement>(sel)) {
      // The fill is the ::before's alone: a door painting one of its own would go unmeasured.
      const own = getComputedStyle(door);
      if (own.backgroundColor !== "rgba(0, 0, 0, 0)" || own.backgroundImage !== "none") worst = { ratio: 0, door: `${door.dataset.door}'s own fill` };
      const fill = getComputedStyle(door, "::before");
      if (rgba(fill.backgroundColor)[3] > 0 || fill.backgroundImage !== "none") painted++;
      const k = shown(door) * Number(fill.opacity);
      const color = rgba(fill.backgroundColor);
      const stops = [...fill.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map((m) => over(rgba(m[0]), color));
      const date = door.querySelector(".door-dn")!;
      const ink = fade(rgba(getComputedStyle(date).color), shown(date));
      for (const layer of [color, ...stops]) {
        const bg = over(fade(layer, k), sky);
        const r = ratio(over(ink, bg), bg);
        if (r < worst.ratio) worst = { ratio: Math.round(r * 100) / 100, door: door.dataset.door! };
      }
      measured++;
    }
    return { worst, measured, painted };
  }, selector);

for (const width of [375, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    test("the first screen asks for the year in view, and only that", async ({ page }) => {
      const asked: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/user/sample/nights?")) asked.push(new URL(r.url()).search);
      });
      await openNights(page);
      await settle(page);
      await settle(page);
      // With the whole history's counts, asked for once (8.5).
      expect(asked).toEqual(["?tz=America%2FChicago&from=2024-01&to=2024-05&counts=1"]);
      // And the months far below draw no doors yet (8.5 item 3).
      await expect(page.locator(`[data-month='2023-10'] ${DOOR}`)).toHaveCount(0);
      // The years below ask without the counts.
      await renderAll(page);
      expect(asked).toEqual(["?tz=America%2FChicago&from=2024-01&to=2024-05&counts=1", "?tz=America%2FChicago&from=2023-01&to=2023-12"]);
    });

    test("one door per night, every door at least 44 by 44px", async ({ page }) => {
      await openNights(page);
      await renderAll(page);
      const doors = await page.locator(DOOR).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height]));
      // Sept 28, 2023 to May 15, 2024: 3 + 213 + 15 nights.
      expect(doors).toHaveLength(231);
      expect(Math.min(...doors.flat())).toBeGreaterThanOrEqual(44);
      // Every open door's date reads at 4.5:1 or more on its own fill (1.4.3),
      // at the brightest stop of its gradient. A night with no plays is
      // inactive (aria-disabled) and exempt.
      const dates = await dateContrast(page, `${DOOR}:not([aria-disabled])`);
      expect(dates.measured).toBeGreaterThan(200);
      expect(dates.painted).toBe(dates.measured);
      expect(dates.worst.ratio, dates.worst.door).toBeGreaterThanOrEqual(4.5);
      test.info().annotations.push({ type: "measured", description: `the lowest date contrast at ${width}px: ${dates.worst.ratio}:1 (${dates.worst.door})` });
      // The rest of May is drawn dashed, and isn't a door (8.5).
      await expect(page.locator("[data-month='2024-05'] .door-future")).toHaveCount(16);
    });

    test("the filter chips are a row a mouse can page, to the last genre (10, 12)", async ({ page }) => {
      // Instant scrolling: a smooth page could hide the arrow at the end mid-click.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openNights(page);
      // A Roster Carousel: "All nights", 12 sky filters, the "Your genres" label and 12 genres.
      const row = page.getByRole("list", { name: "Light up nights" });
      await expect(row.getByRole("listitem")).toHaveCount(26);
      // Overlaid on the row's ends; one with nowhere to go hides (out of the tree too).
      const prev = page.locator("button[aria-label='Previous filters']");
      const next = page.locator("button[aria-label='Next filters']");
      await expect(next).toBeVisible();
      await expect(prev).toBeHidden();
      const inView = () =>
        page.evaluate(() => {
          const list = document.querySelector("ul[aria-label='Light up nights']")!.getBoundingClientRect();
          const last = [...document.querySelectorAll("ul[aria-label='Light up nights'] button")].at(-1)!.getBoundingClientRect();
          return last.left >= list.left && last.right <= list.right + 1;
        });
      expect(await inView()).toBe(false);
      for (let i = 0; i < 30 && (await next.isVisible()); i++) {
        await next.click();
        await settle(page);
      }
      await expect(next).toBeHidden();
      await expect.poll(inView).toBe(true);
      await expect(page.getByRole("button", { name: "punk, 62" })).toBeVisible();
      await expect(prev).toBeVisible();
    });

    test("the sticky top: the whole header at rest, at most 168px once scrolled, the bar at most 112px", async ({ page }) => {
      await openNights(page);
      const at = async () => page.locator(BAR).evaluate((b) => [b.getBoundingClientRect().top, b.getBoundingClientRect().height]);
      const head = async () => page.locator("[data-listener-head]").evaluate((h) => [h.getBoundingClientRect().top, h.getBoundingClientRect().bottom]);
      const wordmark = page.locator("[data-listener-head]").getByRole("link", { name: "Retrospect" });
      const views = page.getByRole("navigation", { name: "Views" });
      // At rest, the whole header: the wordmark's row and the switcher.
      const [restTop, rest] = await head();
      expect(restTop).toBe(0);
      await expect(wordmark).toBeInViewport({ ratio: 1 });
      const [, first] = await at();
      expect(first).toBeLessThanOrEqual(112);
      expect(first).toBeGreaterThan(88); // its two rows of 44px: it reached the chips and the strip
      await page.evaluate(() => window.scrollTo(0, 3000));
      await settle(page);
      // Scrolled, the top stays (Blake, 3 Oct 2026) but compacts (8.5): the
      // wordmark's row has gone up and away, the switcher whole under the
      // window's edge, the bar right under it, the two at most 168px.
      const [top, bottom] = await head();
      expect(top).toBeLessThan(0);
      await expect(wordmark).not.toBeInViewport();
      await expect(views).toBeInViewport({ ratio: 1 });
      const [barTop, height] = await at();
      expect(Math.abs(barTop - bottom)).toBeLessThan(1);
      expect(height).toBeLessThanOrEqual(112);
      expect(barTop + height).toBeLessThanOrEqual(168);
      expect(barTop + height).toBeLessThan(rest + first);
      test.info().annotations.push({
        type: "measured",
        description: `the sticky top at ${width}px: ${Math.round(rest)} + ${Math.round(first)} at rest, ${Math.round(bottom)} + ${Math.round(height)} = ${Math.round(barTop + height)}px stuck`,
      });
      // Its own controls take focus where they are (11): no Tab onto them
      // scrolls the page, and the wordmark, gone up and away, brings the
      // whole header back while it has focus.
      const y = await page.evaluate(() => window.scrollY);
      await page.getByRole("button", { name: "All nights" }).focus();
      for (let i = 0; i < 6 && !(await wordmark.evaluate((e) => e === document.activeElement)); i++) {
        expect(await page.evaluate(() => window.scrollY), `before Shift+Tab ${i + 1}`).toBe(y);
        await page.keyboard.press("Shift+Tab");
        await settle(page);
      }
      await expect(wordmark).toBeFocused();
      await expect(wordmark).toBeInViewport({ ratio: 1 });
      expect((await head())[0]).toBe(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(y);
      await page.keyboard.press("Tab");
      await settle(page);
      expect((await head())[0]).toBeLessThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(y);
      // Back at the top, the whole header again.
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      expect((await head())[0]).toBe(0);
      await expect(wordmark).toBeInViewport({ ratio: 1 });
      await page.evaluate(() => window.scrollTo(0, 3000));
      await settle(page);
      // With a filter on, the strip's label gains its lit count: every month's, still one line each.
      await page.getByRole("button", { name: "Storm nights, 84" }).click();
      const strip = page.getByRole("slider", { name: "Month" });
      await strip.focus();
      await page.keyboard.press("Home");
      const heights: number[] = [];
      for (let i = 0; i < 9; i++) {
        if (i) await page.keyboard.press("ArrowRight");
        heights.push((await at())[1]);
      }
      await expect(strip).toHaveAttribute("aria-valuetext", "May 2024");
      // It measured the two-line label: the month and its lit count.
      await expect(page.locator(BAR).getByText(/^\d+ lit$/)).toBeVisible();
      expect(Math.max(...heights)).toBeLessThanOrEqual(112);
    });

    test("a filter lights its nights, dims the rest's fill, Moon and badges to 35%, and the dock ties it to its question", async ({ page }) => {
      await openNights(page);
      const chip = page.getByRole("button", { name: "Storm nights, 84" });
      await expect(chip).toHaveAttribute("aria-pressed", "false");
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/[?&]filter=storm(&|$)/);
      const lit = await page.locator(`[data-month='2024-05'] ${DOOR}[data-lit]`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.door));
      expect(lit).toEqual(["2024-05-02", "2024-05-10", "2024-05-11", "2024-05-12", "2024-05-15"]);
      // Once the fade has run: a dark night's fill and Moon at 35%, its date whole; a lit night whole.
      await expect.poll(() => layers(page, "2024-05-09")).toMatchObject({ date: 1, fill: 0.35, moon: 0.35 });
      expect(await layers(page, "2024-05-10")).toEqual({ date: 1, fill: 1, moon: 1, badges: 1 });
      // A dark night with badges dims them too.
      const badged = await page
        .locator(`${DOOR}:not([data-lit]):not([aria-disabled]):has(.door-badges)`)
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.door!));
      expect(badged.length).toBeGreaterThan(0);
      await expect.poll(async () => (await layers(page, badged[0])).badges).toBe(0.35);
      // And every dimmed door's date still reads at 4.5:1 or more on its dimmed fill (1.4.3).
      const dimmed = await dateContrast(page, `${DOOR}:not([data-lit]):not([aria-disabled])`);
      expect(dimmed.measured).toBeGreaterThan(20);
      expect(dimmed.painted).toBe(dimmed.measured);
      expect(dimmed.worst.ratio, dimmed.worst.door).toBeGreaterThanOrEqual(4.5);
      test.info().annotations.push({ type: "measured", description: `the lowest dimmed date contrast at ${width}px: ${dimmed.worst.ratio}:1 (${dimmed.worst.door}), ${dimmed.measured} doors` });
      // A storm night's door says its storm and its flare by name (11).
      expect(await page.locator(`${DOOR}[data-door='2024-05-10']`).getAttribute("aria-label")).toBe(
        "Friday, May 10, 2024. 39 plays, 7 fewer than a usual Friday. Waxing crescent Moon. Solar storm, Kp 9. X5.8 flare. First heard Good Luck, Babe! by Chappell Roan. First heard May Ninth by Khruangbin. A wild night: The strongest geomagnetic storm in about 20 years. Lit by the filter.",
      );
      const dock = page.locator(DOCK);
      await expect(dock).toContainText("84 storm nights you listened on");
      await expect(dock).toContainText("stretches of storm nights for the question");
      await expect(dock.getByRole("link", { name: "Coincidence or pattern? Question 7, on solar storms, has the answer." })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "84 storm nights you listened on" })).toHaveCount(1);
      // Every target on the page, dock and strip included, at least 44px.
      await page.evaluate(() => window.scrollTo(0, 0));
      const { small, reached } = await smallTargets(page);
      expect(small).toEqual([]);
      expect(reached).toBeGreaterThan(40);
      // Clear: the dock goes, every door at full strength.
      await dock.getByRole("button", { name: "Clear" }).click();
      await expect(page.locator(DOCK)).toHaveCount(0);
      // Focus goes to "All nights", not the page, as the dock leaves.
      await expect(page.getByRole("button", { name: "All nights" })).toBeFocused();
      await expect.poll(() => layers(page, "2024-05-09")).toMatchObject({ date: 1, fill: 1, moon: 1 });
    });

    test("the dock covers no door that can't scroll clear of it", async ({ page }) => {
      // The tallest dock (a sky filter and a genre), and none of the rows
      // below the months to scroll into, so the room has to come from the page.
      await openNights(page, "?filter=storm&genre=dream+pop");
      await expect(page.locator(DOCK)).toContainText("Facts, not proof.");
      await page.locator("[data-nights-below]").evaluate((e) => ((e as HTMLElement).style.display = "none"));
      await renderAll(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle(page);
      const { lastDoor, dockTop, doors } = await page.evaluate(
        ({ door, dock }) => {
          const all = [...document.querySelectorAll(door)].map((d) => d.getBoundingClientRect());
          return { lastDoor: Math.max(...all.map((r) => r.bottom)), dockTop: document.querySelector(dock)!.getBoundingClientRect().top, doors: all.length };
        },
        { door: DOOR, dock: DOCK },
      );
      // Under the filters, the months with no lit night are a line each, with no doors: 231 nights less their 3 + 31 + 31 + 29.
      expect(await page.locator("[data-month]:not(:has(section))").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.month))).toEqual([
        "2024-02",
        "2024-01",
        "2023-10",
        "2023-09",
      ]);
      expect(doors).toBe(137);
      // Scrolled as far as the page goes, the lowest door sits above the dock: every door above it can too.
      expect(lastDoor).toBeLessThanOrEqual(dockTop);
    });

    test("the selected tab's contrast on the real switcher (11; ClickUp 86e3h9mca)", async ({ page }) => {
      await openNights(page);
      const tab = await selectedTabContrast(page);
      expect(tab).not.toBeNull();
      expect(tab!.label).toBe("Every night");
      expect(tab!.links).toBe(2);
      expect(tab!.bg[3]).toBe(1);
      expect(tab!.fg[3]).toBe(1);
      expect(tab!.fg.slice(0, 3)).not.toEqual(tab!.bg.slice(0, 3));
      test.info().annotations.push({
        type: "measured",
        description: `at ${width}px, Every night selected: ${tab!.ratio}:1; ${tab!.other.label} unselected: ${tab!.other.ratio}:1`,
      });
      expect(tab!.ratio).toBeGreaterThanOrEqual(4.5);
      expect(tab!.other.label).toBe("Tonight");
      expect(tab!.other.ratio).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test.describe("the calendar by keyboard, by date (11)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("arrows move a night and a week, pages a month, Home and End the week; focus follows into months not yet drawn; Enter opens", async ({ page }) => {
    await openNights(page);
    // A grid per month (11): May 2024's has 5 weeks of 7 cells.
    const may = page.getByRole("grid", { name: "May 2024" });
    await expect(may.getByRole("row")).toHaveCount(5);
    await expect(may.getByRole("gridcell")).toHaveCount(35);
    // One tab stop for the whole calendar, on tonight.
    await expect(page.locator(`${DOOR}[tabindex='0']`)).toHaveCount(1);
    await page.locator(`${DOOR}[tabindex='0']`).focus();
    expect(await focused(page)).toBe("2024-05-15");
    expect(await page.locator(`${DOOR}[data-door='2024-05-15']`).getAttribute("aria-label")).toMatch(/^Tonight, Wednesday, May 15, 2024\. /);
    for (const [key, date] of [
      ["ArrowRight", "2024-05-15"], // never past tonight
      ["ArrowLeft", "2024-05-14"],
      ["ArrowUp", "2024-05-07"],
      ["Home", "2024-05-05"],
      ["End", "2024-05-11"],
      ["ArrowDown", "2024-05-15"],
      ["ArrowUp", "2024-05-08"],
      ["PageUp", "2024-04-08"],
      ["PageDown", "2024-05-08"],
      ["PageUp", "2024-04-08"],
    ]) {
      await page.keyboard.press(key);
      expect(await focused(page), key).toBe(date);
      expect(await focusClear(page), `${key} to ${date}`).toBe(true);
    }
    expect(await page.locator(`${DOOR}[data-door='2024-04-08']`).getAttribute("aria-label")).toBe(
      "Monday, Apr 8, 2024. 28 plays, 5 fewer than a usual Monday. Total solar eclipse. An asteroid passed closer than the Moon. First heard Aquarius by Boards of Canada. First heard Roygbiv by Boards of Canada. A wild night: A total solar eclipse across North America.",
    );
    // Seven months down, into a month not drawn and a year not fetched: it stops at the first night.
    await expect(page.locator(`[data-month='2023-09'] ${DOOR}`)).toHaveCount(0);
    for (let i = 0; i < 8; i++) await page.keyboard.press("PageUp");
    await expect.poll(() => focused(page)).toBe("2023-09-28");
    expect(await focusClear(page)).toBe(true);
    await expect(page.locator(`${DOOR}[tabindex='0']`)).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]night=2023-09-28(&|$)/);
    // Roster's dialog element has no box of its own (its panel is fixed inside it): its heading is what shows.
    await expect(page.getByRole("dialog", { name: "Thursday, Sept 28, 2023" }).getByRole("heading", { name: "Thursday, Sept 28, 2023" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("2023-09-28");
    // A month later sits above, out of view under the sticky top: focus scrolls it clear of the header and bar.
    await page.evaluate(() => {
      const d = document.querySelector("[data-door='2023-09-28']")!;
      window.scrollBy(0, d.getBoundingClientRect().top - 260);
    });
    await page.keyboard.press("PageDown");
    await expect.poll(() => focused(page)).toBe("2023-10-28");
    expect(await focusClear(page)).toBe(true);
    await page.keyboard.press("PageUp");
    await expect.poll(() => focused(page)).toBe("2023-09-28");
    // Space opens a night too.
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/[?&]night=2023-09-28(&|$)/);
  });

  test("with a filter folding tonight's month, the calendar keeps one tab stop, and keys pass the folded months", async ({ page }) => {
    // No eclipse in May 2024: its month is one line, and tonight's door isn't drawn.
    await openNights(page, "?filter=eclipse", NOW, "[data-month='2024-04'] [data-door]");
    await expect(page.locator("[data-month='2024-05']")).toHaveText("Nothing in May 2024");
    await expect(page.locator(`${DOOR}[tabindex='0']`)).toHaveCount(1);
    // Tab from the year strip reaches it: the nearest night that's a door.
    await page.getByRole("slider", { name: "Month" }).focus();
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("2024-04-30");
    for (const [key, date] of [
      ["PageUp", "2024-03-30"],
      ["PageUp", "2023-10-30"], // past February, January, December and November, folded
      ["PageDown", "2024-03-30"],
      ["PageDown", "2024-04-30"],
      ["PageDown", "2024-04-30"], // nothing to draw after April: it stays, and keeps its ring
    ]) {
      await page.keyboard.press(key);
      // Focus lands once the night's year is in.
      await expect.poll(() => focused(page), { message: key }).toBe(date);
      await expect(page.locator(`${DOOR}[data-door='${date}']`)).toHaveAttribute("tabindex", "0");
    }
  });

  test("with a filter on, focus stays clear of the dock, and the night sheet steps between lit nights", async ({ page }) => {
    await openNights(page, "?filter=storm");
    await expect(page.locator(DOCK)).toBeVisible();
    await page.locator(`${DOOR}[tabindex='0']`).focus();
    for (const [key, date] of [
      ["PageUp", "2024-04-15"],
      ["PageUp", "2024-03-15"],
      ["ArrowDown", "2024-03-22"],
      ["ArrowDown", "2024-03-29"],
    ]) {
      await page.keyboard.press(key);
      expect(await focused(page), key).toBe(date);
      expect(await focusClear(page), `${key} to ${date}`).toBe(true);
    }
    await page.locator(`${DOOR}[data-door='2024-05-02']`).click();
    await expect(page).toHaveURL(/[?&]night=2024-05-02(&|$)/);
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Next night" }).click();
    await expect(page).toHaveURL(/[?&]night=2024-05-10(&|$)/);
    await expect(page).toHaveURL(/[?&]filter=storm(&|$)/);
    await sheet.getByRole("button", { name: "Previous night" }).click();
    await expect(page).toHaveURL(/[?&]night=2024-05-02(&|$)/);
    // Back across a month to the lit night before: none in April after the 19th.
    await sheet.getByRole("button", { name: "Previous night" }).click();
    await expect(page).toHaveURL(/[?&]night=2024-04-19(&|$)/);
  });
});

test.describe("the states (8.5)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("a year that didn't load says so once, and Try again loads it", async ({ page }) => {
    let fail = true;
    await page.route("**/api/user/sample/nights?*from=2023-01*", (r) => (fail ? r.fulfill({ status: 503, json: { error: "unavailable" } }) : r.fallback()));
    await openNights(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const line = page.getByText("2023 didn’t load.", { exact: true });
    await expect(line).toBeVisible();
    // One line for the year, at its newest month; its other months show nothing.
    await expect(line).toHaveCount(1);
    expect(await page.locator("[data-month='2023-12']").textContent()).toContain("2023 didn’t load.");
    expect(await page.locator("[data-month='2023-11']").textContent()).toBe("");
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(`[data-month='2023-09'] ${DOOR}`)).toHaveCount(3);
    await expect(line).toHaveCount(0);
  });

  test("a first year that didn't load leaves the whole history's counts to the next year that does (8.5)", async ({ page }) => {
    let fail = true;
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/user/sample/nights?")) asked.push(new URL(r.url()).search);
    });
    await page.route("**/api/user/sample/nights?*from=2024-01*", (r) => (fail ? r.fulfill({ status: 503, json: { error: "unavailable" } }) : r.fallback()));
    await openNights(page, "", NOW, "text=2024 didn’t load.");
    // 2024's months fold to its one line, so 2023 comes near: it asks for the counts too, and brings them.
    await expect(page.getByRole("button", { name: "Storm nights, 84" })).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(`${DOOR}[data-tonight]`)).toBeVisible();
    // The chips stay: 2024, newest now, came without the counts, which the page keeps from 2023.
    await expect(page.getByRole("button", { name: "Storm nights, 84" })).toBeVisible();
    // Once they're here, Try again asks for its year alone.
    expect(asked).toEqual([
      "?tz=America%2FChicago&from=2024-01&to=2024-05&counts=1",
      "?tz=America%2FChicago&from=2023-01&to=2023-12&counts=1",
      "?tz=America%2FChicago&from=2024-01&to=2024-05",
    ]);
  });

  test("a visit that runs past the month's end keeps its years (8.5)", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/user/sample/nights?")) asked.push(new URL(r.url()).search);
    });
    await openNights(page);
    await expect(page.locator(`[data-month='2024-05'] ${DOOR}`)).toHaveCount(15);
    // 4:30 a.m. on June 1, Central: June's first night has begun. The visit
    // goes on, the years below load, and back at the top May's doors are
    // there, with 2024 never asked for again.
    await page.clock.setFixedTime(new Date("2024-06-01T04:30:00-05:00"));
    await renderAll(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await expect(page.locator(`[data-month='2024-05'] ${DOOR}`)).toHaveCount(15);
    expect(asked).toEqual(["?tz=America%2FChicago&from=2024-01&to=2024-05&counts=1", "?tz=America%2FChicago&from=2023-01&to=2023-12"]);
  });

  test("under a filter, a year that didn't load still says so, at its newest month", async ({ page }) => {
    await page.route("**/api/user/sample/nights?*from=2023-01*", (r) => r.fulfill({ status: 503, json: { error: "unavailable" } }));
    // No eclipse in December 2023: its month would fold, and the line with it.
    await openNights(page, "?filter=eclipse", NOW, "[data-month='2024-04'] [data-door]");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator("[data-month='2023-12']")).toContainText("2023 didn’t load.");
    await expect(page.getByText("2023 didn’t load.", { exact: true })).toHaveCount(1);
  });

  test("a filter or genre the page doesn't know lights nothing, in the calendar and in a night's sheet", async ({ page }) => {
    await openNights(page, "?filter=bogus&genre=constructor");
    await expect(page.getByRole("button", { name: "All nights" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(DOCK)).toHaveCount(0);
    await expect(page.locator("[data-filtering]")).toHaveCount(0);
    // A night of 2023, a year that came after the counts and so without them:
    // its sheet knows the genre isn't the history's from the counts the page
    // kept, and steps to the next night you listened on.
    await renderAll(page);
    const october = await page
      .locator(`[data-month='2023-10'] ${DOOR}:not([aria-disabled])`)
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.door!).filter((d) => d > "2023-10-14"));
    expect(october.length).toBeGreaterThan(0);
    await page.locator(`${DOOR}[data-door='2023-10-14']`).click();
    await expect(page).toHaveURL(/[?&]night=2023-10-14(&|$)/);
    await page.getByRole("dialog").getByRole("button", { name: "Next night" }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]night=${october[0]}(&|$)`));
  });

  test("a door before the sync's oldest scrobble still opens its night", async ({ page }) => {
    // A sync state whose oldestUts is later than the history's first play
    // (one saved before the field existed takes it from a later sync).
    await page.route("**/api/user/sample/status", async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, json: { ...(await res.json()), oldestUts: Date.parse("2024-03-01T12:00:00Z") / 1000 } });
    });
    await openNights(page, "?filter=eclipse", NOW, "[data-month='2024-04'] [data-door]");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const door = page.locator(`[data-month='2023-10'] ${DOOR}[data-lit]`).first();
    const date = await door.getAttribute("data-door");
    expect(date! < "2024-03-01").toBe(true);
    await door.click();
    await expect(page).toHaveURL(new RegExp(`[?&]night=${date}(&|$)`));
    await settle(page);
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`[?&]night=${date}(&|$)`));
    await expect(page.getByText("That link points to something that isn't in this history.")).toHaveCount(0);
  });

  test("a link to a night the history doesn't have says so in a toast, and a night that opens clears it", async ({ page }) => {
    await openNights(page, "?night=2030-01-01");
    const toast = page.getByRole("status").filter({ hasText: "That link points to something that isn't in this history." });
    await expect(toast).toBeVisible();
    await expect(page).not.toHaveURL(/night=/);
    await page.locator(`${DOOR}[data-door='2024-05-10']`).click();
    await expect(page).toHaveURL(/[?&]night=2024-05-10(&|$)/);
    await expect(toast).toHaveCount(0);
  });

  test("NASA's data unavailable: its filters and badges hide, with one line under the bar", async ({ page }) => {
    await page.route("**/api/user/sample/nights?*", async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, json: { ...(await res.json()), nasa: "unavailable" } });
    });
    await openNights(page, "?filter=storm");
    await expect(page.getByText("NASA's data didn't load. The Moon and planets are still here.")).toBeVisible();
    for (const name of [/^Storm nights/, /^X-flare nights/, /^Asteroids closer than the Moon/, /^Fireballs/])
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    // The Moon's filters stay; a storm filter in the URL lights nothing, and no dock shows.
    await expect(page.getByRole("button", { name: /^Full moons, \d+/ })).toBeVisible();
    await expect(page.locator(DOCK)).toHaveCount(0);
    // May 10, 2024's door: no storm or flare in its name.
    expect(await page.locator(`${DOOR}[data-door='2024-05-10']`).getAttribute("aria-label")).not.toMatch(/Solar storm|flare/);
  });

  test("tonight's door opens tonight's sheet, so far", async ({ page }) => {
    await openNights(page);
    await page.locator(`${DOOR}[data-tonight]`).click();
    await expect(page).toHaveURL(/[?&]night=2024-05-15(&|$)/);
    // As it reads: the term's explanation, hidden until asked for, sits inside the line.
    const line = page.getByRole("dialog").locator("p", { hasText: "so far · a usual Wednesday is" });
    await expect.poll(() => line.innerText()).toMatch(/^\d+ plays tonight so far · a usual Wednesday is \d+$/);
  });

  test("tonight's door opens before its first play (8.5)", async ({ page }) => {
    // Oct 3, 2026: after the sample's last scrobble (Sept 28), so tonight has no plays.
    await openNights(page, "", new Date("2026-10-03T20:00:00-05:00"));
    const door = page.locator(`${DOOR}[data-tonight]`);
    expect(await door.getAttribute("aria-label")).toMatch(/^Tonight, Saturday, Oct 3, 2026\. No listening yet\. /);
    expect(await door.getAttribute("aria-disabled")).toBeNull();
    // A past night with none is dimmed and opens nothing.
    expect(await page.locator(`${DOOR}[data-door='2026-10-02']`).getAttribute("aria-disabled")).toBe("true");
    await door.click();
    await expect(page).toHaveURL(/[?&]night=2026-10-03(&|$)/);
    const line = page.getByRole("dialog").locator("p", { hasText: "so far · a usual Saturday is" });
    await expect.poll(() => line.innerText()).toMatch(/^0 plays tonight so far · a usual Saturday is \d+$/);
    // And it stays: a sheet that refused the night would drop it from the URL and say so (8.7).
    await settle(page);
    await settle(page);
    await expect(page).toHaveURL(/[?&]night=2026-10-03(&|$)/);
    await expect(page.getByText("That link points to something that isn't in this history.")).toHaveCount(0);
  });
});

test.describe("the bar's controls (8.5, 7.6, 11)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Back to top shows once a screen has gone by, clear of the dock, and goes back with focus on the view", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openNights(page, "?filter=storm");
    const wrap = page.locator("[data-back-to-top]");
    const button = page.getByRole("button", { name: "Back to top" });
    const opacity = () => wrap.evaluate((e) => getComputedStyle(e).opacity);
    // At the top it's out of sight and out of reach (inert).
    await expect(wrap).toHaveAttribute("inert", "");
    expect(await opacity()).toBe("0");
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(wrap).not.toHaveAttribute("inert");
    await expect.poll(opacity).toBe("1");
    // Over the dock, never on it.
    const [b, d] = await Promise.all([wrap.boundingBox(), page.locator(DOCK).boundingBox()]);
    expect(b!.y + b!.height).toBeLessThanOrEqual(d!.y);
    expect([Math.round(b!.width), Math.round(b!.height)]).toEqual([56, 56]);
    await button.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator("#view-heading")).toBeFocused();
    await expect(wrap).toHaveAttribute("inert", "");
  });

  test("the year strip seeks by key and by tap, and settles on the month's first night", async ({ page }) => {
    await openNights(page);
    const strip = page.getByRole("slider", { name: "Month" });
    // Sept 2023 to May 2024: nine months, by index.
    await expect(strip).toHaveAttribute("aria-valuetext", "May 2024");
    await expect(strip).toHaveAttribute("aria-valuenow", "8");
    await expect(strip).toHaveAttribute("aria-valuemax", "8");
    await strip.focus();
    await page.keyboard.press("Home");
    await expect(strip).toHaveAttribute("aria-valuetext", "September 2023");
    await expect(strip).toHaveAttribute("aria-valuenow", "0");
    // The list went there, its heading just under the bar, and the calendar's tab stop is its first night.
    await expect(page.locator(`${DOOR}[tabindex='0']`)).toHaveAttribute("data-door", "2023-09-28");
    const gap = await page.evaluate(
      () => document.getElementById("month-2023-09")!.getBoundingClientRect().top - document.querySelector("[data-nights-bar]")!.getBoundingClientRect().bottom,
    );
    expect(Math.abs(gap)).toBeLessThan(12);
    // A tap on the track's fifth month, January 2024 (2.5.7: no drag needed).
    const box = (await strip.boundingBox())!;
    await page.mouse.click(box.x + box.width * (4.5 / 9), box.y + box.height / 2);
    await expect(strip).toHaveAttribute("aria-valuetext", "January 2024");
    await expect(page.locator(`${DOOR}[tabindex='0']`)).toHaveAttribute("data-door", "2024-01-01");
  });

  test("dragging the year strip loads nothing until it's let go", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/user/sample/nights?")) asked.push(new URL(r.url()).searchParams.get("from")!);
    });
    await openNights(page);
    await settle(page);
    expect(asked).toEqual(["2024-01"]);
    const box = (await page.getByRole("slider", { name: "Month" }).boundingBox())!;
    const y = box.y + box.height / 2;
    // Down on May 2024, across to September 2023, held there.
    await page.mouse.move(box.x + box.width - 4, y);
    await page.mouse.down();
    for (let x = box.x + box.width - 4; x > box.x + 4; x -= 20) await page.mouse.move(x, y);
    await page.mouse.move(box.x + 4, y);
    await settle(page);
    await settle(page);
    await expect(page.getByRole("slider", { name: "Month" })).toHaveAttribute("aria-valuetext", "September 2023");
    expect(asked).toEqual(["2024-01"]);
    // Let go: what's near loads.
    await page.mouse.up();
    await expect.poll(() => asked).toEqual(["2024-01", "2023-01"]);
    await expect(page.locator(`[data-month='2023-09'] ${DOOR}`)).toHaveCount(3);
  });

  test("a combined count that didn't load says so, and Try again counts", async ({ page }) => {
    let fail = true;
    await page.route("**/api/user/sample/nights?*genre=*", (r) => (fail ? r.fulfill({ status: 503, json: { error: "unavailable" } }) : r.fallback()));
    await openNights(page, "?filter=storm&genre=dream+pop");
    const dock = page.locator(DOCK);
    await expect(dock).toContainText("The count didn’t load.");
    fail = false;
    await dock.getByRole("button", { name: "Try again" }).click();
    await expect(dock).toContainText("55 storm nights with at least 3 dream pop plays");
  });

  test("a focused wild door shows the two-tone ring, not its glow (11)", async ({ page }) => {
    await openNights(page);
    await page.locator(`${DOOR}[tabindex='0']`).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    expect(await focused(page)).toBe("2024-05-10");
    const door = page.locator(`${DOOR}[data-door='2024-05-10']`);
    await expect(door).toHaveAttribute("data-wild", "true");
    const ring = () =>
      door.evaluate((e) => {
        const cs = getComputedStyle(e);
        return { outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow, glow: getComputedStyle(e, "::before").boxShadow };
      });
    expect(await ring()).toEqual({ outline: "solid 2px rgb(212, 175, 55)", shadow: "rgb(11, 16, 38) 0px 0px 0px 2px", glow: "none" });
    // Its glow is back once focus moves on.
    await page.keyboard.press("ArrowLeft");
    expect((await ring()).glow).toContain("rgba(212, 175, 55, 0.75)");
  });

  test("a focused door a filter dimmed comes back to full strength, ring and all (11, 1.4.11)", async ({ page }) => {
    await openNights(page, "?filter=storm");
    await page.locator(`${DOOR}[tabindex='0']`).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect(await focused(page)).toBe("2024-05-13");
    const door = page.locator(`${DOOR}[data-door='2024-05-13']`);
    await expect(door).not.toHaveAttribute("data-lit");
    await expect.poll(() => layers(page, "2024-05-13")).toEqual({ date: 1, fill: 1, moon: 1, badges: 1 });
    expect(await door.evaluate((e) => `${getComputedStyle(e).outlineStyle} ${getComputedStyle(e).outlineColor}`)).toBe("solid rgb(212, 175, 55)");
    // And its fill and Moon back to 35% once focus moves on, the date whole.
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => layers(page, "2024-05-13")).toEqual({ date: 1, fill: 0.35, moon: 0.35, badges: 0.35 });
  });

  test("a sky filter and a genre together light the nights both hold; the dock says genres aren't tested", async ({ page }) => {
    await openNights(page, "?filter=storm");
    const storm = page.getByRole("button", { name: "Storm nights, 84" });
    const dreamPop = page.getByRole("button", { name: "dream pop, 754" });
    await dreamPop.click();
    await expect(page).toHaveURL(/[?&]genre=dream(\+|%20)pop(&|$)/);
    await expect(storm).toHaveAttribute("aria-pressed", "true");
    await expect(dreamPop).toHaveAttribute("aria-pressed", "true");
    const lit = () => page.locator(`[data-month='2024-05'] ${DOOR}[data-lit]`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.door));
    await expect.poll(lit).toEqual(["2024-05-02", "2024-05-10", "2024-05-15"]);
    const dock = page.locator(DOCK);
    // Over the whole history, from the route's own count of the pair.
    await expect(dock).toContainText("55 storm nights with at least 3 dream pop plays");
    await expect(dock).toContainText(
      "Facts, not proof. Retrospect doesn't test genres against the sky: with a dozen genres and a dozen skies, chance alone would hand you several 'patterns'.",
    );
    await expect(dock).not.toContainText("stretches");
    await expect(dock.getByRole("link", { name: "Coincidence or pattern? Question 7, on solar storms, has the answer." })).toBeVisible();
    // One sky filter at a time: another replaces it, the genre stays.
    await page.getByRole("button", { name: /^Full moons, \d+$/ }).click();
    await expect(storm).toHaveAttribute("aria-pressed", "false");
    await expect(dreamPop).toHaveAttribute("aria-pressed", "true");
  });
});
