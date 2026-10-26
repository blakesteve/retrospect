import type { Page } from "@playwright/test";
import { escapeSheet, expect, returnVisit, selectedTabContrast, settle, smallTargets, test } from "./fixtures";

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
    const rec = { angles: [] as number[], startedAt: -1, endedAt: -1, ever: false, opens: 0, starsAt: -1, planetsAt: -1 };
    let was = false;
    (window as unknown as { __opening: typeof rec }).__opening = rec;
    const frame = () => {
      const state = document.querySelector("[data-sky-wheel]")?.getAttribute("data-opening");
      if (state) rec.ever = true;
      if (rec.starsAt < 0 && document.querySelector("[data-sky-wheel] [data-star]")) rec.starsAt = performance.now();
      if (rec.planetsAt < 0 && document.querySelector("[data-sky-wheel] [data-body='Saturn']")) rec.planetsAt = performance.now();
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
type Opening = { angles: number[]; startedAt: number; endedAt: number; ever: boolean; opens: number; starsAt: number; planetsAt: number };
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
        await escapeSheet(page);
        // The sheet gone, so the next tap meets the wheel, not the sheet leaving.
        await expect(title).toBeHidden();
        await expect(page).not.toHaveURL(/[?&]planet=/);
        // Clear takes the tints and the legend, and gives focus back to the planet.
        await page.locator("[data-legend]").getByRole("button", { name: "Clear" }).click();
        await expect(page.locator("[data-legend]")).toHaveCount(0);
        // Polled: WebKit puts it there a moment after the click, Chromium at once.
        await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.body ?? null)).toBe(body);
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
          await escapeSheet(page);
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
      await escapeSheet(page);
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

/* The planets' glyphs (ClickUp 86e3jrztm): none covers another, a moved
   one's true place is marked, and the ℞ reads at 375 and is spoken. Each
   glyph and ℞ is drawn again, outline and all, in the font the page drew it
   in, the wheels' own (the check fails if it isn't), and no two planets may
   share a pixel of ink, so "covers" is what's on screen, not the layout's
   own model. */

type Mask = { body: string; mark: boolean; ink: number; px: number; font: string };
/** Every planet's glyph and ℞, and each true-place dot, drawn alone at twice
    the CSS size: the pixels any two glyphs or ℞s share, and how much of each
    dot lies under any of them. */
const inks = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>("[data-sky-wheel]")!;
    const box = svg.getBoundingClientRect();
    const k = 2;
    const W = Math.ceil(box.width * k);
    const H = Math.ceil(box.height * k);
    const canvas = () => Object.assign(document.createElement("canvas"), { width: W, height: H }).getContext("2d", { willReadFrequently: true })!;
    const solid = (ctx: CanvasRenderingContext2D) => {
      const alpha = ctx.getImageData(0, 0, W, H).data;
      const on = new Uint8Array(W * H);
      for (let i = 0; i < on.length; i++) on[i] = alpha[i * 4 + 3] > 128 ? 1 : 0;
      return on;
    };
    const masks: (Mask & { on: Uint8Array })[] = [];
    for (const g of svg.querySelectorAll<SVGGElement>("[data-glyph]")) {
      for (const t of g.querySelectorAll<SVGTextElement>(":scope > text")) {
        const ctx = canvas();
        const ctm = t.getScreenCTM()!;
        const fs = Number(t.getAttribute("font-size"));
        ctx.font = `${fs * ctm.a * k}px ${getComputedStyle(t).fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        // Anchored at its middle, its baseline .35em below its y.
        const at = new DOMPoint(Number(t.getAttribute("x") ?? 0), Number(t.getAttribute("y") ?? 0) + 0.35 * fs).matrixTransform(ctm);
        const [x, y] = [(at.x - box.left) * k, (at.y - box.top) * k];
        ctx.lineWidth = Number(t.getAttribute("stroke-width") ?? 0) * ctm.a * k;
        ctx.lineJoin = "round";
        if (ctx.lineWidth > 0) ctx.strokeText(t.textContent ?? "", x, y);
        ctx.fillText(t.textContent ?? "", x, y);
        const on = solid(ctx);
        masks.push({ body: g.dataset.glyph!, mark: t.hasAttribute("data-rx"), ink: on.reduce((n, v) => n + v, 0), px: fs * ctm.a, font: ctx.font, on });
      }
    }
    const shared: { a: string; b: string; pixels: number }[] = [];
    const name = (m: Mask) => `${m.body}${m.mark ? " ℞" : ""}`;
    for (let i = 0; i < masks.length; i++)
      for (let j = i + 1; j < masks.length; j++) {
        let pixels = 0;
        for (let p = 0; p < W * H; p++) if (masks[i].on[p] && masks[j].on[p]) pixels++;
        shared.push({ a: name(masks[i]), b: name(masks[j]), pixels });
      }
    const dots: { body: string; pixels: number; hidden: number }[] = [];
    for (const c of [...svg.querySelectorAll("[data-true]")].map((g) => g.querySelector<SVGCircleElement>("circle")!)) {
      const ctx = canvas();
      const ctm = c.getScreenCTM()!;
      const at = new DOMPoint(Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))).matrixTransform(ctm);
      ctx.beginPath();
      ctx.arc((at.x - box.left) * k, (at.y - box.top) * k, (Number(c.getAttribute("r")) + Number(c.getAttribute("stroke-width")) / 2) * ctm.a * k, 0, 2 * Math.PI);
      ctx.fill();
      const on = solid(ctx);
      let pixels = 0;
      let hidden = 0;
      for (let p = 0; p < W * H; p++)
        if (on[p]) {
          pixels++;
          if (masks.some((m) => m.on[p])) hidden++;
        }
      dots.push({ body: c.closest<SVGGElement>("[data-true]")!.dataset.true!, pixels, hidden });
    }
    return { masks: masks.map((m) => ({ body: m.body, mark: m.mark, ink: m.ink, px: m.px, font: m.font })), shared, dots };
  });

/** Each planet's true longitude, the angle and radius its glyph is drawn at,
    how far its true place is from the glyph's anchor (in its font size), and
    its true-place dot if any. */
const places = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGGElement>("[data-sky-wheel] [data-body]")].map((g) => {
      const body = g.dataset.body!;
      const drawn = document.querySelector<SVGGElement>(`[data-sky-wheel] [data-glyph="${body}"]`)!;
      const [x, y] = (drawn.getAttribute("transform") ?? "").match(/-?[\d.]+/g)!.map(Number);
      const dot = document.querySelector(`[data-sky-wheel] [data-true="${body}"] circle`);
      const angle = (px: number, py: number) => ((((Math.atan2(py, -px) * 180) / Math.PI) % 360) + 360) % 360;
      const longitude = Number(g.dataset.longitude);
      const radius = Math.hypot(x, y);
      const a = (longitude * Math.PI) / 180;
      const size = Number(drawn.querySelector("text")!.getAttribute("font-size"));
      const [dx, dy] = dot ? [Number(dot.getAttribute("cx")), Number(dot.getAttribute("cy"))] : [0, 0];
      return {
        body,
        longitude,
        glyph: { angle: angle(x, y), radius },
        trueOff: Math.hypot(-radius * Math.cos(a) - x, radius * Math.sin(a) - y) / size,
        dot: dot
          ? {
              angle: angle(dx, dy),
              radius: Math.hypot(dx, dy),
              // A ring over a neighbor's glyph comes after the glyphs.
              over: dot.closest("[data-over]") !== null,
              afterGlyphs: Boolean(drawn.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING),
            }
          : null,
        label: g.getAttribute("aria-label") ?? "",
      };
    }),
  );
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** The dial at a night, by its keys from the first night, and the planets still there. */
async function toNight(page: Page, keys: string[], said: string, retrograde: string[]) {
  const dial = slider(page);
  await dial.focus();
  for (const key of keys) await page.keyboard.press(key);
  await expect(dial).toHaveAttribute("aria-valuetext", new RegExp(`^${said}: `));
  // Still: the ℞ waits for a trip's end, where the sky is exact.
  for (const body of retrograde) await expect(page.locator(`[data-sky-wheel] [data-glyph="${body}"] [data-rx]`)).toBeVisible();
  // The glyphs' own font has come, so they're drawn in it and measured in it.
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check(`21px "Retrospect Sky Glyphs"`, "\u263F\u211E"))).toBe(true);
  await settle(page);
}

/** What was drawn: every planet, each ℞ wanted, in a font the canvas took, with ink. */
function drawn(ink: Awaited<ReturnType<typeof inks>>, retrograde: readonly string[]) {
  expect(ink.masks.filter((m) => !m.mark).map((m) => m.body).sort()).toEqual(["Jupiter", "Mars", "Mercury", "Moon", "Saturn", "Sun", "Venus"]);
  expect(ink.masks.filter((m) => m.mark).map((m) => m.body).sort()).toEqual([...retrograde].sort());
  for (const m of ink.masks) {
    expect(parseFloat(m.font), `${m.body}'s font`).toBeCloseTo(m.px * 2, 1);
    // In the wheels' own font, the same on every machine.
    expect(m.font, `${m.body}'s font`).toContain('"Retrospect Sky Glyphs"');
    expect(m.ink, `${m.body}'s ink`).toBeGreaterThan(40);
  }
}

/** The dial's keys to Sunday, March 23, 2025, from the first night, Sept 28, 2023: 18 months on, then 5 nights back. */
const MAR_23_2025 = ["Home", ...Array<string>(18).fill("PageUp"), ...Array<string>(5).fill("ArrowLeft")];
/** To Monday, Jan 12, 2026: 27 months on, to Dec 28, 2025, then 2 weeks and a night. */
const JAN_12_2026 = ["Home", ...Array<string>(27).fill("PageUp"), "Shift+ArrowRight", "Shift+ArrowRight", "ArrowRight"];

/** None covers another, and every moved planet's true place is marked: by a
    dot on its orbit, under the glyphs with three quarters of it in view or,
    where a neighbor's glyph sits on it, a ring over the glyphs; or, near
    enough, by the glyph itself standing over it. */
async function fannedOut(page: Page, at: Awaited<ReturnType<typeof places>>, retrograde: string[], width: number) {
  const ink = await inks(page);
  drawn(ink, retrograde);
  // No two planets share a pixel of ink, nor a ℞ its own planet's.
  for (const { a, b, pixels } of ink.shared) expect(pixels, `${a} and ${b}`).toBe(0);
  const moved = at.filter((p) => Math.abs(turn(p.longitude, p.glyph.angle)) > 0.5);
  expect(ink.dots.length).toBeGreaterThan(0);
  for (const p of at) {
    if (!moved.includes(p)) expect(p.dot, p.body).toBeNull();
    else if (p.dot) {
      // Both drawn to a tenth of a unit.
      expect(Math.abs(turn(p.longitude, p.dot.angle)), p.body).toBeLessThan(0.2);
      expect(p.dot.radius, p.body).toBeCloseTo(p.glyph.radius, 0);
      const dot = ink.dots.find((d) => d.body === p.body)!;
      expect(dot.pixels, `${p.body}'s dot`).toBeGreaterThan(20);
      if (p.dot.over) expect(p.dot.afterGlyphs, `${p.body}'s ring over the glyphs`).toBe(true);
      else expect(dot.hidden / dot.pixels, `${p.body}'s dot in view`).toBeLessThanOrEqual(0.25);
    } else expect(p.trueOff, `${p.body} over its true place`).toBeLessThan(0.6);
  }
  test.info().annotations.push({
    type: "measured",
    description: `at ${width}px, moved ${moved.map((p) => `${p.body} ${turn(p.longitude, p.glyph.angle).toFixed(1)}°`).join(", ")}; dots ${ink.dots
      .map((d) => `${d.body} ${at.find((p) => p.body === d.body)!.dot!.over ? "ringed over" : `${Math.round((100 * (d.pixels - d.hidden)) / d.pixels)}% in view`}`)
      .join(", ")}`,
  });
  return moved;
}

for (const width of [375, 1280]) {
  test.describe(`the planets' glyphs at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    test("at the Sun on Sunday, March 23, 2025, Mercury and Venus fan out, none covering another, their true places marked", async ({ page }) => {
      await openSky(page);
      await toNight(page, MAR_23_2025, "Sunday, Mar 23, 2025", ["Mercury", "Venus"]);
      const at = await places(page);
      const lon = Object.fromEntries(at.map((p) => [p.body, p.longitude]));
      // A real conjunction: Venus within 2° of the Sun, Mercury within 3°.
      expect(Math.abs(turn(lon.Sun, lon.Venus))).toBeLessThan(2);
      expect(Math.abs(turn(lon.Sun, lon.Mercury))).toBeLessThan(3);
      const moved = await fannedOut(page, at, ["Mercury", "Venus"], width);
      expect(moved.map((p) => p.body)).toEqual(expect.arrayContaining(["Mercury", "Venus"]));
    });

    test("the glyphs' own font is fetched where a wheel draws, and not where other glyphs do", async ({ page }) => {
      const fetched: number[] = [];
      page.on("response", (r) => {
        if (r.url().endsWith("/fonts/retrospect-sky-glyphs.woff2")) fetched.push(r.status());
      });
      // Every night draws planet glyphs (its filter chips) and no wheel.
      await returnVisit(page);
      await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
      await page.goto("/u/sample/nights");
      const glyphs = page.locator("main .font-glyph").filter({ hasText: /[\u2609\u263D\u263F\u2640\u2642-\u2644]/ });
      await expect(glyphs.first()).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      expect(fetched, "on Every night, with no wheel").toEqual([]);
      await openSky(page);
      await page.evaluate(() => document.fonts.ready);
      expect(fetched.length, "on Sky").toBeGreaterThan(0);
      expect(fetched.every((s) => s === 200 || s === 304)).toBe(true);
    });

    test("on Monday, Jan 12, 2026, Venus's and Mars's true places, under a neighbor's glyph, are ringed over the glyphs", async ({ page }) => {
      await openSky(page);
      await toNight(page, JAN_12_2026, "Monday, Jan 12, 2026", ["Jupiter"]);
      const at = await places(page);
      for (const body of ["Venus", "Mars"]) expect(at.find((p) => p.body === body)!.dot, body).toMatchObject({ over: true, afterGlyphs: true });
      await fannedOut(page, at, ["Jupiter"], width);
    });

    test("the ℞ reads at 12px or more and the planet says retrograde, on March 23, 2025 and on the calm first night", async ({ page }) => {
      await openSky(page);
      for (const [keys, said, retrograde] of [
        [MAR_23_2025, "Sunday, Mar 23, 2025", ["Mercury", "Venus"]],
        // The pair: Sept 28, 2023, where nothing overlaps, Jupiter and Saturn retrograde, nothing moved.
        [["Home"], "Thursday, Sept 28, 2023", ["Jupiter", "Saturn"]],
      ] as const) {
        await toNight(page, [...keys], said, [...retrograde]);
        const ink = await inks(page);
        drawn(ink, retrograde);
        const at = await places(page);
        for (const body of retrograde) {
          const mark = ink.masks.find((m) => m.body === body && m.mark)!;
          expect(mark.px, `${said} ${body}`).toBeGreaterThanOrEqual(12);
          // Clear of its own planet's glyph, and of every other.
          for (const { a, b, pixels } of ink.shared.filter((x) => x.a === `${body} ℞` || x.b === `${body} ℞`)) expect(pixels, `${said}: ${a} and ${b}`).toBe(0);
          expect(at.find((p) => p.body === body)!.label, `${said} ${body}`).toMatch(/, retrograde$/);
        }
        if (said.startsWith("Thursday")) for (const p of at) expect(Math.abs(turn(p.longitude, p.glyph.angle)), p.body).toBeLessThan(0.5);
        test.info().annotations.push({ type: "measured", description: `at ${width}px, ${said}: the ℞ at ${ink.masks.find((m) => m.mark)!.px.toFixed(1)}px, in ${ink.masks[0].font}` });
      }
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

  test("the wheel opens once a visit: the planets wind into place in 2s, the stars fly in, and all is still within 5s (8.11, 2.2.2)", async ({ page }) => {
    await recordOpening(page);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    await expect(page.locator("[data-sky-wheel]")).toHaveAttribute("data-opening", "run", { timeout: 30_000 });
    // The stars fly in (the check can see them)...
    await expect.poll(() => wheelAnimations(page), { timeout: 2500 }).toBeGreaterThan(0);
    await expect(page.locator("[data-sky-wheel]")).not.toHaveAttribute("data-opening", /./, { timeout: 5000 });
    const o = await opening(page);
    // Saturn, the farthest out, winds back 294° and comes round to its place.
    let travel = 0;
    for (let i = 1; i < o.angles.length; i++) travel += Math.abs(((o.angles[i] - o.angles[i - 1] + 540) % 360) - 180);
    expect(o.angles.length).toBeGreaterThan(10);
    expect(travel).toBeGreaterThan(250);
    // 1.9s, with room for a slow runner's frames.
    expect(o.endedAt - o.startedAt).toBeLessThan(2400);
    // ...and by 4.9 seconds nothing moves (2.2.2): nothing twinkles until Play.
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

  test("any input ends the opening at once: every planet in its place, the stars still, and none flying in later (2.2.2)", async ({ page }) => {
    await recordOpening(page);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    // The stars come a moment after the planets, so the key comes between.
    await page.route("**/api/user/sample/songs*", async (r) => {
      await new Promise((done) => setTimeout(done, 1500));
      await r.continue();
    });
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    // A key as the planets begin to wind.
    await expect(wheel).toHaveAttribute("data-opening", "run", { timeout: 30_000 });
    await page.keyboard.press("Shift");
    await expect(wheel).not.toHaveAttribute("data-opening", /./, { timeout: 300 });
    const saturn = wheel.locator("[data-body='Saturn']");
    const at = await saturn.getAttribute("transform");
    await page.waitForTimeout(600);
    expect(await saturn.getAttribute("transform")).toBe(at);
    // The control: left alone, it was still on its way when the key came.
    const o = await opening(page);
    expect(o.angles.length).toBeGreaterThan(0);
    expect(o.endedAt - o.startedAt).toBeLessThan(1500);
    // Stars that load after it ended simply appear.
    await expect(page.locator("[data-star]").first()).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(100);
    expect((await opening(page)).starsAt).toBeGreaterThan(o.endedAt);
    expect(await wheelAnimations(page)).toBe(0);
    // A new visit: a key while the stars fly stops them too.
    await page.reload();
    await expect.poll(() => wheelAnimations(page), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.keyboard.press("Shift");
    await expect.poll(() => wheelAnimations(page), { timeout: 300 }).toBe(0);
  });

  test("the planets never wait for the stars: they show, opening, as soon as tonight's positions arrive (8.11)", async ({ page }) => {
    await recordOpening(page);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    // The songs, and so the stars, come 6 seconds late.
    await page.route("**/api/user/sample/songs*", async (r) => {
      await new Promise((done) => setTimeout(done, 6000));
      await r.continue();
    });
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    await expect(wheel.locator("[data-body='Saturn']")).toBeAttached({ timeout: 30_000 });
    // Nothing between a planet and the screen hides it: its button, nor its
    // glyph, drawn in a layer of its own.
    const shown = await page.evaluate(() =>
      ["[data-body='Saturn']", "[data-glyph='Saturn'] text"].map((sel) => {
        let el: Element | null = document.querySelector(`[data-sky-wheel] ${sel}`);
        let opacity = el ? 1 : 0;
        while (el && el.tagName !== "svg") {
          opacity *= Number(getComputedStyle(el).opacity);
          el = el.parentElement;
        }
        return opacity;
      }),
    );
    expect(shown).toEqual([1, 1]);
    await expect(wheel).toHaveAttribute("data-opening", "run");
    expect(await page.locator("[data-star]").count()).toBe(0);
    // It began as the planets came, not after waiting for anything.
    const began = await opening(page);
    expect(began.startedAt - began.planetsAt).toBeLessThan(300);
    // The stars join late, near the opening's end or after it, and their
    // flight, if any, fits what's left: by 4.9 seconds nothing moves.
    await expect(page.locator("[data-star]").first()).toBeAttached({ timeout: 15_000 });
    const o = await opening(page);
    expect(o.starsAt - o.startedAt).toBeGreaterThan(2500);
    await page.waitForFunction((t) => performance.now() >= t, o.startedAt + 4900);
    expect(await wheelAnimations(page)).toBe(0);
  });

  test("a press that stops the opening only stops it: it opens nothing where a planet was going (11)", async ({ page }) => {
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    const saturn = wheel.locator("[data-body='Saturn']");
    // Saturn here and in its place: the attribute is absent before the planets come, too.
    await expect(saturn).toBeAttached({ timeout: 30_000 });
    await expect(wheel).not.toHaveAttribute("data-opening", /./, { timeout: 10_000 });
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

  test("off screen as tonight's planets arrive, the wheel doesn't open: the planets simply show, in place (8.11)", async ({ page }) => {
    await recordOpening(page);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    // A window too short to show the wheel at all.
    await page.setViewportSize({ width: 375, height: 120 });
    await page.goto(SKY);
    const wheel = page.locator("[data-sky-wheel]");
    const saturn = wheel.locator("[data-body='Saturn']");
    await expect(saturn).toBeAttached({ timeout: 30_000 });
    await expect(wheel).not.toHaveAttribute("data-opening", /./);
    const at = await saturn.getAttribute("transform");
    // On screen later: still nothing winds, and nothing moved.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(2500);
    expect((await opening(page)).startedAt).toBe(-1);
    expect(await saturn.getAttribute("transform")).toBe(at);
  });

  test("the stars twinkle only while Play runs, and ease to rest when it ends (8.11)", async ({ page }) => {
    await openSky(page);
    const twinkle = () =>
      page.evaluate(() => {
        const out = { twinkling: 0, easing: 0 };
        for (const a of document.getAnimations()) {
          const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
          if (!t?.classList.contains("sky-tw") || a.playState !== "running") continue;
          if (a instanceof CSSAnimation) out.twinkling++;
          else if (!(a instanceof CSSTransition)) out.easing++;
        }
        return out;
      });
    expect(await twinkle()).toEqual({ twinkling: 0, easing: 0 });
    await page.getByRole("button", { name: "Play your years" }).click();
    await expect.poll(async () => (await twinkle()).twinkling).toBeGreaterThan(5);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Pause" }).click();
    // Each star eases back from where its twinkle was, not a jump...
    const ended = await twinkle();
    expect(ended.twinkling).toBe(0);
    expect(ended.easing).toBeGreaterThan(0);
    // Played again before they're at rest: they twinkle from where they are,
    // the easing gone at once rather than holding them still over the twinkle.
    await page.getByRole("button", { name: "Play your years" }).click();
    expect((await twinkle()).easing).toBe(0);
    await page.getByRole("button", { name: "Pause" }).click();
    // ...and at rest within a second.
    await expect.poll(twinkle, { timeout: 1500 }).toEqual({ twinkling: 0, easing: 0 });
  });

  test("Play stopped rests the wheel on a whole night, the one the dial and a planet's sheet read (8.6, 8.7.4)", async ({ page }) => {
    await openSky(page);
    const moon = page.locator("[data-sky-wheel] [data-body='Moon']");
    await page.getByRole("button", { name: "Play your years" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Pause" }).click();
    await settle(page);
    const paused = await moon.getAttribute("transform");
    const night = await slider(page).getAttribute("aria-valuetext");
    // A night on and back again travels to that night's 9 p.m.: where the Moon already is.
    await slider(page).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(slider(page)).toHaveAttribute("aria-valuetext", night!);
    // Compared once it has settled: on its way back it passes through the in-between places.
    let last: string | null = null;
    await expect
      .poll(
        async () => {
          const now = await moon.getAttribute("transform");
          const still = now === last;
          last = now;
          return still;
        },
        { intervals: [300], timeout: 5000 },
      )
      .toBe(true);
    expect(last).toBe(paused);
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

test.describe("a planet's sheet from Sky (8.7.4)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("on a past night it's that night's planet, titled with the date, never tonight", async ({ page }) => {
    await openSky(page);
    const venus = page.locator("[data-sky-wheel] [data-body='Venus']");
    // The control: at tonight, "Venus tonight".
    await venus.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Venus tonight" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]planet=venus(&|$)/);
    await escapeSheet(page);
    await expect(page.getByRole("heading", { name: "Venus tonight" })).toBeHidden();
    // The first night, Thursday, Sept 28, 2023: Venus in Leo, which she left Oct 8.
    await slider(page).focus();
    await page.keyboard.press("Home");
    await expect(slider(page)).toHaveAttribute("aria-valuetext", /^Thursday, Sept 28, 2023/);
    await expect(venus).toHaveAttribute("aria-label", /Leo/);
    await venus.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]planet=venus-2023-09-28(&|$)/);
    await expect(page.getByRole("heading", { name: "Venus on Sept 28, 2023" })).toBeVisible();
    await expect(page.getByText("In Leo, a neutral sign")).toBeVisible();
    await expect(page.getByRole("heading", { name: /tonight/i })).toHaveCount(0);
    // What came after says its year, so it can't read as coming up.
    await expect(page.getByRole("heading", { name: "After that night" })).toBeVisible();
    await expect(page.getByText(/^Venus enters Virgo Oct 8, 2023, /)).toBeVisible();
  });
});

test.describe("a dated planet link on any view (8.7.4, 8.7)", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  const open = async (page: Page, path: string) => {
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    await page.goto(path);
  };
  const history = (page: Page) => page.getByRole("heading", { name: "Through your history" });

  test("inside the sky data but outside the history it opens, the sky alone, on Tonight and Every night", async ({ page }) => {
    // The sample begins Sept 28, 2023; Jun 15, 2010 is in the sky data.
    await open(page, "/u/sample?planet=venus-2010-06-15");
    await expect(page.getByRole("heading", { name: "Venus on Jun 15, 2010" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Where she's strong and weak" })).toBeVisible();
    await expect(history(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "In your 12 questions" })).toHaveCount(0);
    await page.goto("/u/sample/nights?planet=mars-2030-06-15");
    await expect(page.getByRole("heading", { name: "Mars on Jun 15, 2030" })).toBeVisible({ timeout: 30_000 });
    // Its data in (the title shows before it), and still the sky alone.
    await expect(page.getByRole("heading", { name: "Where he's strong and weak" })).toBeVisible();
    await expect(history(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "In your 12 questions" })).toHaveCount(0);
    // The control: a night inside the history keeps the lines about the listener.
    await page.goto("/u/sample?planet=venus-2024-05-10");
    await expect(page.getByRole("heading", { name: "Venus on May 10, 2024" })).toBeVisible({ timeout: 30_000 });
    await expect(history(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "In your 12 questions" })).toBeVisible();
  });

  test("outside the sky data it doesn't open, and says it's the sky that ends there", async ({ page }) => {
    await open(page, "/u/sample/sky?planet=venus-1999-06-15");
    const said = page.getByRole("status").filter({ hasText: "Retrospect's sky runs from 2002 through 2035, so it can't show that date." });
    await expect(said).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/planet=/);
    await expect(page.getByRole("heading", { name: /^Venus/ })).toHaveCount(0);
    // The history's line stays for what's outside the history (8.7).
    await expect(page.getByText("That link points to something that isn't in this history.")).toHaveCount(0);
  });

  test("on the landing's sample too, a date outside the sky data says it's the sky that ends there", async ({ page }) => {
    await open(page, "/?planet=venus-1999-06-15");
    await expect(page.getByRole("status").filter({ hasText: "Retrospect's sky runs from 2002 through 2035, so it can't show that date." })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).not.toHaveURL(/planet=/);
  });

  test("a planet that isn't one still gets the history's line", async ({ page }) => {
    await open(page, "/u/sample/sky?planet=pluto-1999-06-15");
    await expect(page.getByRole("status").filter({ hasText: "That link points to something that isn't in this history." })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Retrospect's sky runs from 2002 through 2035")).toHaveCount(0);
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
