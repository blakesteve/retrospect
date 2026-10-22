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

    // The page measured has the real switcher (3c: Tonight, Every night and Sky),
    // and so no eyebrow over the heading (8.4).
    await expect(page.locator("nav[aria-label=Views] a")).toHaveCount(3);
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

test("a focused planet shows its own two-tone ring, not a square box around it (11)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openTonight(page);
  const wheel = page.locator("svg[aria-label='Sky wheel']");
  await wheel.locator("[data-body][tabindex='0']").focus();
  await page.keyboard.press("ArrowRight");
  const r = await page.evaluate(() => {
    const el = document.activeElement as SVGGElement;
    const cs = getComputedStyle(el);
    const other = document.querySelector(`svg[aria-label='Sky wheel'] [data-body]:not([data-body="${el.dataset.body}"]) .pl-sel`)!;
    return { body: el.dataset.body ?? "", outline: cs.outlineStyle, shadow: cs.boxShadow, rings: [...el.querySelectorAll(".pl-sel")].map((c) => getComputedStyle(c).opacity), other: getComputedStyle(other).opacity };
  });
  expect(r.body).not.toBe("");
  expect(r).toMatchObject({ outline: "none", shadow: "none", rings: ["1", "1"], other: "0" });
});

/* The ℞ on the listener's wheel (ClickUp 86e3rwyfe): 12px or more at 375, as
   Sky's is, still spoken, and clear of every glyph. Sunday, March 23, 2025, at
   9 p.m. in Chicago, Mercury and Venus both retrograde (Sky's check uses the
   same night): the server's own sky for that instant (`/api/sky/at`) stands in
   for tonight's in `/api/sky/now`, so the date is a literal, not today. The
   night's sheet draws the same wheel smaller, at 260px, the smallest a phone
   reads it at. Each glyph and ℞ is drawn again alone, in the font the page
   drew it in, and no ℞ may share a pixel of ink with any other glyph or ℞
   (Sky's pixel-sharing check, e2e/sky.spec.ts). */

/** 9 p.m. CDT on Sunday, March 23, 2025. */
const MAR_23_2025_9PM = Date.UTC(2025, 2, 24, 2) / 1000;

/** The wheel's width, and each planet's glyph and ℞ drawn alone at twice the
    CSS size: its size on screen, its font and ink, and the pixels each ℞
    shares with every other glyph or ℞. */
const wheelInks = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const svg = document.querySelector<SVGSVGElement>(sel)!;
    const box = svg.getBoundingClientRect();
    const k = 2;
    const W = Math.ceil(box.width * k);
    const H = Math.ceil(box.height * k);
    const masks: { body: string; mark: boolean; px: number; font: string; ink: number; on: Uint8Array }[] = [];
    for (const g of svg.querySelectorAll<SVGGElement>("[data-body]")) {
      for (const t of g.querySelectorAll<SVGTextElement>("text")) {
        const ctx = Object.assign(document.createElement("canvas"), { width: W, height: H }).getContext("2d", { willReadFrequently: true })!;
        const ctm = t.getScreenCTM()!;
        const fs = Number(t.getAttribute("font-size"));
        ctx.font = `${fs * ctm.a * k}px ${getComputedStyle(t).fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        // Anchored at its middle, its baseline .35em below its y.
        const at = new DOMPoint(Number(t.getAttribute("x") ?? 0), Number(t.getAttribute("y") ?? 0) + 0.35 * fs).matrixTransform(ctm);
        ctx.fillText(t.textContent ?? "", (at.x - box.left) * k, (at.y - box.top) * k);
        const alpha = ctx.getImageData(0, 0, W, H).data;
        const on = new Uint8Array(W * H);
        for (let i = 0; i < on.length; i++) on[i] = alpha[i * 4 + 3] > 128 ? 1 : 0;
        masks.push({ body: g.dataset.body!, mark: t.textContent === "\u211E", px: fs * ctm.a, font: ctx.font, ink: on.reduce((n, v) => n + v, 0), on });
      }
    }
    const shared: { a: string; b: string; pixels: number }[] = [];
    const name = (m: (typeof masks)[number]) => `${m.body}${m.mark ? " ℞" : ""}`;
    for (const m of masks.filter((x) => x.mark))
      for (const o of masks.filter((x) => x !== m)) {
        let pixels = 0;
        for (let p = 0; p < W * H; p++) if (m.on[p] && o.on[p]) pixels++;
        shared.push({ a: name(m), b: name(o), pixels });
      }
    const labels = Object.fromEntries([...svg.querySelectorAll<SVGGElement>("[data-body]")].map((g) => [g.dataset.body!, g.getAttribute("aria-label")]));
    return { width: box.width, masks: masks.map((m) => ({ body: m.body, mark: m.mark, px: m.px, font: m.font, ink: m.ink })), shared, labels };
  }, selector);

/** Every planet drawn and nothing still moving: arrivals and pulses ended,
    the wheels' font in, and two frames since. */
async function wheelStill(page: Page, selector: string, retrograde: string[]) {
  for (const body of retrograde) await expect(page.locator(`${selector} [data-body="${body}"] text`).filter({ hasText: "℞" })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check(`21px "Retrospect Sky Glyphs"`, "\u263F\u211E"))).toBe(true);
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))),
  );
  await settle(page);
}

/** Each ℞ wanted, at 12px or more, in the wheels' own font, with ink, sharing none of it. */
function marksRead(ink: Awaited<ReturnType<typeof wheelInks>>, retrograde: readonly string[], where: string) {
  expect(ink.masks.filter((m) => m.mark).map((m) => m.body).sort(), where).toEqual([...retrograde].sort());
  expect(ink.masks.filter((m) => !m.mark)).toHaveLength(7);
  for (const m of ink.masks) {
    expect(m.font, `${where}: ${m.body}'s font`).toContain('"Retrospect Sky Glyphs"');
    expect(m.ink, `${where}: ${m.body}'s ink`).toBeGreaterThan(20);
    if (m.mark) expect(m.px, `${where}: ${m.body}'s ℞`).toBeGreaterThanOrEqual(12);
  }
  // A ℞ clear of its own planet's glyph, and of every other glyph and ℞.
  for (const { a, b, pixels } of ink.shared) expect(pixels, `${where}: ${a} and ${b}`).toBe(0);
  expect(ink.shared.length).toBe(retrograde.length * (7 + retrograde.length - 1));
}

test.describe("the ℞ on the listener's wheel, on a phone (ClickUp 86e3rwyfe)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("on Sunday, March 23, 2025, Mercury's and Venus's ℞ read at 12px or more, clear of every glyph, and each planet says retrograde", async ({ page }) => {
    const at = await (await page.request.get(`/api/sky/at?t=${MAR_23_2025_9PM}`)).json();
    expect(at.at).toBe("2025-03-24T02:00:00.000Z");
    expect(at.bodies.filter((b: { retrograde: boolean }) => b.retrograde).map((b: { body: string }) => b.body).sort()).toEqual(["Mercury", "Venus"]);
    delete at.questionsHeld;
    // NASA's picture of that day isn't in the sample, and the server would ask NASA for it.
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.route("**/api/sky/now?*", async (route) => {
      const res = await route.fetch();
      route.fulfill({ response: res, json: { ...(await res.json()), sky: at } });
    });

    // Tonight's wheel, 280px wide under 400.
    const TONIGHT_WHEEL = "svg[aria-label='Sky wheel']";
    await openTonight(page);
    await wheelStill(page, TONIGHT_WHEEL, ["Mercury", "Venus"]);
    const tonight = await wheelInks(page, TONIGHT_WHEEL);
    expect(tonight.width).toBe(280);
    marksRead(tonight, ["Mercury", "Venus"], "Tonight");
    for (const body of ["Mercury", "Venus"]) expect(tonight.labels[body], body).toMatch(/, retrograde$/);
    for (const body of ["Sun", "Moon", "Mars", "Jupiter", "Saturn"]) expect(tonight.labels[body], body).not.toMatch(/retrograde/);

    // The same night's sheet, its wheel at 260px.
    const SHEET_WHEEL = "[role=dialog] svg:has([data-body])";
    await page.goto(`${TONIGHT}?night=2025-03-23`);
    await expect(page.getByRole("dialog")).toContainText("At 9 p.m. that night.", { timeout: 30_000 });
    await wheelStill(page, SHEET_WHEEL, ["Mercury", "Venus"]);
    const sheet = await wheelInks(page, SHEET_WHEEL);
    expect(sheet.width).toBe(260);
    marksRead(sheet, ["Mercury", "Venus"], "the night's sheet");

    const px = (ink: typeof tonight) => ink.masks.filter((m) => m.mark).map((m) => `${m.body} ${m.px.toFixed(2)}px`).join(", ");
    test.info().annotations.push({ type: "measured", description: `the ℞ at 375: Tonight ${px(tonight)}; the night's sheet ${px(sheet)}; in ${tonight.masks[0].font}` });
  });
});

test.describe("the selected tab's contrast on the rendered page (11; ClickUp 86e3h9mca)", () => {
  test("Tonight's label reads at 4.5:1 or more on its pill, and the other on the track, on the real switcher", async ({ page }) => {
    await openTonight(page);
    const tab = await selectedTabContrast(page);
    // It reached the real switcher, its three links and real colors: an opaque pill, a label of another color.
    expect(tab).not.toBeNull();
    expect(tab!.label).toBe("Tonight");
    expect(tab!.links).toBe(3);
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
