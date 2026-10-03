import type { Page } from "@playwright/test";
import { expect, returnVisit, selectedTabContrast, settle, smallTargets, test } from "./fixtures";

/* Tonight in Chromium, on the seeded sample listener (`global-setup.ts`):
   the checks jsdom can't make, because they need layout and color. Each
   asserts that it reached what it measures, so none can pass on an empty
   page. */

const TONIGHT = "/u/sample";
const ROWS = "section[aria-labelledby=foryou-h] li";

async function openTonight(page: Page) {
  await returnVisit(page);
  await page.goto(TONIGHT);
  await expect(page.locator(ROWS).first()).toBeVisible({ timeout: 30_000 });
  // The answers are in: no row still says "Checking…".
  await expect(page.locator("section[aria-labelledby=foryou-h]")).not.toContainText("Checking…", { timeout: 30_000 });
}

test.describe("the first screen on a phone (spec 8.4 item 3, the fold test)", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });

  test("starts the first 'for you' row above 720px, in the spec's worst case too, with nothing fixed over the rows", async ({ page }) => {
    await openTonight(page);
    const first = await page.locator(ROWS).first().boundingBox();
    expect(first!.y).toBeLessThan(720);

    // Nothing fixed (or sticky) on the screen covers a row.
    const covered = await page.evaluate((rows) => {
      const boxes = [...document.querySelectorAll(rows)].map((r) => r.getBoundingClientRect());
      return [...document.querySelectorAll("body *")]
        .filter((e) => {
          const cs = getComputedStyle(e);
          return (cs.position === "fixed" || cs.position === "sticky") && !e.closest("[inert]") && parseFloat(cs.opacity) > 0;
        })
        .flatMap((e) => {
          const f = e.getBoundingClientRect();
          return boxes.some((b) => f.left < b.right && f.right > b.left && f.top < b.bottom && f.bottom > b.top && f.height > 0)
            ? [e.outerHTML.slice(0, 80)]
            : [];
        });
    }, ROWS);
    expect(covered).toEqual([]);

    // The page measured has the real switcher (3b: Tonight and Every night),
    // and so no eyebrow over the heading (8.4).
    await expect(page.locator("nav[aria-label=Views] a")).toHaveCount(2);
    expect(
      await page
        .locator("section[aria-labelledby=view-heading]")
        .first()
        .evaluate((s) => s.firstElementChild!.tagName),
    ).toBe("H1");

    // The spec's worst case: "Wednesday night, Sept 30" (two lines) and a
    // four-entry halo key, under the real switcher.
    const worst = await page.evaluate((rows) => {
      document.querySelector("h1")!.textContent = "Wednesday night, Sept 30";
      const key = document.querySelector("#tonight-wheel p")!;
      key.innerHTML =
        "<span>Tap any planet.</span>" +
        ["At home", "Exalted", "In detriment", "In fall"]
          .map((w) => `<span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full"></span>${w}</span>`)
          .join("");
      return {
        heading: document.querySelector("h1")!.getBoundingClientRect().height,
        first: document.querySelector(rows)!.getBoundingClientRect().top,
      };
    }, ROWS);
    expect(worst.heading).toBeGreaterThan(60); // it did wrap to two lines
    expect(worst.first).toBeLessThan(720);
  });
});

test.describe("'Surprise me' never covers a 'for you' row (ruling, 3 Oct 2026)", () => {
  for (const width of [375, 639, 640, 800, 1123, 1124, 1280]) {
    test.describe(`at ${width}px`, () => {
      // Reduced motion: the button appears and leaves at once, so a step needs no wait for its fade.
      test.use({
        viewport: { width, height: 800 },
        contextOptions: { reducedMotion: "reduce" },
      });

      test("shows only where it covers none, and does show", async ({ page }) => {
        await openTonight(page);
        // Not by role: while it waits, it's inert, and out of the accessibility tree.
        const button = page.locator("div.fixed button", { hasText: "Surprise me" }).or(page.locator("div.fixed button[aria-label='Surprise me']"));
        await expect(button).toHaveCount(1);
        // Every 120px, and every 4px where the button's band (the bottom
        // 100px of the window) passes the list's last rows, where an overlap
        // can be a few pixels wide.
        const { listEnd, height } = await page.evaluate((rows) => {
          const list = document.querySelector(rows)!.closest("section")!;
          return {
            listEnd: Math.round(list.getBoundingClientRect().bottom + window.scrollY),
            height: window.innerHeight,
          };
        }, ROWS);
        const crossing = Math.max(0, listEnd - height);
        const ys = new Set<number>();
        for (let y = 0; y <= listEnd + 600; y += 120) ys.add(y);
        for (let y = Math.max(0, crossing - 40); y <= crossing + 200; y += 4) ys.add(y);
        const steps: { y: number; shown: boolean; covers: number }[] = [];
        for (const y of [...ys].sort((a, b) => a - b)) {
          await page.evaluate((yy) => window.scrollTo(0, yy), y);
          await settle(page);
          steps.push({
            y,
            ...(await page.evaluate((rows) => {
              const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === "Surprise me")!;
              const wrap = btn.closest("div.fixed")!;
              const shown = !wrap.hasAttribute("inert") && parseFloat(getComputedStyle(wrap).opacity) > 0;
              const box = btn.getBoundingClientRect();
              const covers = [...document.querySelectorAll(rows)]
                .map((r) => r.getBoundingClientRect())
                .filter((r) => box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top).length;
              return { shown, covers };
            }, ROWS)),
          });
        }
        expect(steps.filter((s) => s.shown && s.covers > 0)).toEqual([]);
        // It reached what it measures: the button showed somewhere on the way down.
        expect(steps.some((s) => s.shown)).toBe(true);
        // Over the column (to 1123px) it waits for the list; beside it (from 1124px) it's there from the start.
        expect(steps[0].shown).toBe(width >= 1124);
        expect(steps.length).toBeGreaterThan(55); // the dense band was scanned
        const box = await button.boundingBox();
        if (width < 640) expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([56, 56]);
        else expect(await button.textContent()).toContain("Surprise me");
      });
    });
  }
});

test.describe("targets of at least 44px (spec 10, 11)", () => {
  test("at 1280px, every link, button and field", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTonight(page);
    const { small, reached } = await smallTargets(page);
    expect(small).toEqual([]);
    expect(reached).toBeGreaterThan(30);
  });

  test.describe("on a phone", () => {
    test.use({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });

    test("every link, button and field, and a planet tapped 22px from its center", async ({ page }) => {
      await openTonight(page);
      const { small, reached } = await smallTargets(page);
      expect(small).toEqual([]);
      expect(reached).toBeGreaterThan(30);

      // A planet tapped 22px out from its glyph's center, where no other glyph
      // is nearer: inside a 44px target, it opens that planet's sheet. On a
      // phone the wheel is its smallest (280px), so the target has no slack.
      // Any night's sky has such a planet; the most isolated is tried first.
      const target = await page.evaluate(() => {
        const svg = document.querySelector("#tonight-wheel svg")!.getBoundingClientRect();
        const center = {
          x: svg.left + svg.width / 2,
          y: svg.top + svg.height / 2,
        };
        // A glyph's center is its halo's: the group's box also holds the ℞ mark.
        const planets = [...document.querySelectorAll("#tonight-wheel g[data-body]")].map((g) => {
          const b = g.querySelector("circle")!.getBoundingClientRect();
          return {
            body: g.getAttribute("data-body")!,
            x: b.left + b.width / 2,
            y: b.top + b.height / 2,
          };
        });
        const gap = (p: (typeof planets)[number]) => Math.min(...planets.filter((q) => q !== p).map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
        for (const p of [...planets].sort((a, b) => gap(b) - gap(a))) {
          const d = Math.hypot(p.x - center.x, p.y - center.y);
          const tap = {
            x: p.x + ((p.x - center.x) / d) * 22,
            y: p.y + ((p.y - center.y) / d) * 22,
          };
          if (planets.every((q) => q === p || Math.hypot(q.x - tap.x, q.y - tap.y) > 22))
            return {
              body: p.body,
              ...tap,
              planets: planets.length,
              wheel: Math.round(svg.width),
            };
        }
        return null;
      });
      expect(target).not.toBeNull();
      expect(target!.planets).toBe(7);
      expect(target!.wheel).toBe(280);
      await page.touchscreen.tap(target!.x, target!.y);
      await expect(page).toHaveURL(new RegExp(`planet=${target!.body.toLowerCase()}`));
    });
  });
});

test.describe("the selected tab's contrast on the rendered page (11; ClickUp 86e3h9mca)", () => {
  test("Tonight's label reads at 4.5:1 or more on its pill, and the other on the track, on the real switcher", async ({ page }) => {
    await openTonight(page);
    const tab = await selectedTabContrast(page);
    // It reached the real switcher, its two links and real colors: an opaque pill, a label of another color.
    expect(tab).not.toBeNull();
    expect(tab!.label).toBe("Tonight");
    expect(tab!.links).toBe(2);
    expect(tab!.bg[3]).toBe(1);
    expect(tab!.fg[3]).toBe(1);
    expect(tab!.fg.slice(0, 3)).not.toEqual(tab!.bg.slice(0, 3));
    test.info().annotations.push({ type: "measured", description: `Tonight selected: ${tab!.ratio}:1; ${tab!.other.label} unselected: ${tab!.other.ratio}:1` });
    expect(tab!.ratio).toBeGreaterThanOrEqual(4.5);
    // And the label not selected, on the track (1.4.3).
    expect(tab!.other.label).toBe("Every night");
    expect(tab!.other.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
