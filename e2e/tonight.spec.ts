import { expect, test as base, type Page } from "@playwright/test";

/** The page never leaves this machine either: album art and NASA's photos
    would come from the network, so every request off it is refused (the
    cards keep their drawn skies). The hosts refused are noted on the test. */
const test = base.extend<{ localOnly: string[] }>({
  localOnly: [
    async ({ context, baseURL }, use, info) => {
      const refused: string[] = [];
      await context.route(
        (url: URL) => !url.href.startsWith(`${baseURL}/`),
        (route) => {
          refused.push(new URL(route.request().url()).host);
          return route.abort();
        },
      );
      await use(refused);
      if (refused.length) info.annotations.push({ type: "refused", description: [...new Set(refused)].join(", ") });
    },
    { auto: true },
  ],
});

/* Tonight in Chromium, on the seeded sample listener (`global-setup.ts`):
   the checks jsdom can't make, because they need layout and color. Each
   asserts that it reached what it measures, so none can pass on an empty
   page. */

const TONIGHT = "/u/sample";
const ROWS = "section[aria-labelledby=foryou-h] li";

async function openTonight(page: Page) {
  // The reveal and the guide already seen, as on a return visit.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("retrospect:guide-done", "1");
      localStorage.setItem("retrospect:reveal-seen:sample", "1");
    } catch {}
  });
  await page.goto(TONIGHT);
  await expect(page.locator(ROWS).first()).toBeVisible({ timeout: 30_000 });
  // The answers are in: no row still says "Checking…".
  await expect(page.locator("section[aria-labelledby=foryou-h]")).not.toContainText("Checking…", { timeout: 30_000 });
}

/** Two frames: IntersectionObserver callbacks and React have run. */
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

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

    // The spec's worst case: "Wednesday night, Sept 30" (two lines), the
    // switcher (Roster's LiquidNav at size lg: 44px tabs, 4px padding and a
    // 1px border each side, 54px, under a 12px gap), and a four-entry halo key.
    const worst = await page.evaluate((rows) => {
      document.querySelector("h1")!.textContent = "Wednesday night, Sept 30";
      const switcher = document.createElement("div");
      switcher.style.cssText = "height:54px;margin-top:12px";
      document.querySelector("header")!.appendChild(switcher);
      const eyebrow = document.querySelector("section[aria-labelledby=view-heading]")!.firstElementChild as HTMLElement;
      if (eyebrow.tagName !== "H1") eyebrow.style.display = "none"; // with a switcher, no eyebrow (8.4)
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
  const measure = (page: Page) =>
    page.evaluate(() => {
      const small: string[] = [];
      let reached = 0;
      for (const el of document.querySelectorAll("body a, body button, body input, body [role=button]")) {
        // The wheel's planets: a tap goes to the nearest within 22px, checked below.
        if (el.closest("[data-body]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest("[inert]") || getComputedStyle(el).visibility === "hidden") continue;
        reached++;
        if (r.width < 44 || r.height < 44)
          small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}`);
      }
      return { small, reached };
    });

  test("at 1280px, every link, button and field", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTonight(page);
    const { small, reached } = await measure(page);
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
      const { small, reached } = await measure(page);
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
  test("its label reads at 4.5:1 or more on its pill", async ({ page }) => {
    await openTonight(page);
    const ratio = await page.evaluate(() => {
      // Any CSS color (rgb, oklch, a token's hex) to 0-255 RGB and alpha, through a canvas.
      const ctx = document.createElement("canvas").getContext("2d")!;
      const rgba = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const contrast = (fg: number[], bg: number[]) => {
        const [x, y] = [lum(fg), lum(bg)].sort((m, n) => n - m);
        return (x + 0.05) / (y + 0.05);
      };
      // The switcher, when there is one: its active label on its pill.
      const active = document.querySelector("nav[aria-label=Views] [aria-current=page]");
      const pill = document.querySelector("nav[aria-label=Views] [data-testid=liquid-tabs-pill]");
      // With one view there's no switcher (8.4 item 1), so the selected tab's
      // own colors, as the page's stylesheet resolves them, on a stand-in.
      const probe = document.createElement("span");
      probe.textContent = "Tonight";
      probe.style.cssText = "color: var(--roster-lt-text-active); background: var(--roster-lt-pill)";
      document.querySelector("main")!.appendChild(probe);
      const fg = rgba(getComputedStyle(active ?? probe).color);
      const bg = rgba(getComputedStyle(pill ?? probe).backgroundColor);
      probe.remove();
      return {
        switcher: Boolean(active),
        nav: Boolean(document.querySelector("nav[aria-label=Views]")),
        ratio: contrast(fg, bg),
        bgAlpha: bg[3],
        fg,
        bg,
      };
    });
    test.info().annotations.push({
      type: "measured",
      description: ratio.switcher ? "the switcher's selected tab" : "the selected tab's colors (one view: no switcher yet)",
    });
    // A switcher on the page is the one measured, never the stand-in.
    expect(ratio.switcher).toBe(ratio.nav);
    // It reached real colors: an opaque pill, a label of another color.
    expect(ratio.bgAlpha).toBe(1);
    expect(ratio.fg.slice(0, 3)).not.toEqual(ratio.bg.slice(0, 3));
    expect(ratio.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
