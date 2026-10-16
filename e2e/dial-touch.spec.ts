import type { Page } from "@playwright/test";
import { expect, returnVisit, settle, test } from "./fixtures";

/* A real finger on the two sliders that drag (ClickUp 86e3qqbhp): Sky's dial
   and Every night's year strip, at a phone's width. The touch goes through
   Chromium's DevTools protocol, which feeds it to the same input pipeline a
   touchscreen does, so the browser applies `touch-action` and captures the
   pointer implicitly to whatever the finger lands on, as it would for a
   person. A mouse gets no implicit capture, and a synthetic event gets
   neither, so neither can show this. WebKit has no such protocol, and the
   touch cases skip there.

   Each case first checks what lies under its starting point, so a pass or a
   failure can't come from landing somewhere else, and reads the slider just
   before the finger lifts, so the dial's snap to a nearby wild night on
   release can't hide where the drag got to. */

type Point = { x: number; y: number };

/** A finger down at `from`, moved `dx` page pixels in `steps`, read with `beforeLift`, then lifted. False where there's no DevTools protocol. */
async function touchSwipe(page: Page, from: Point, dx: number, beforeLift: () => Promise<void>, steps = 15) {
  let session;
  try {
    session = await page.context().newCDPSession(page);
  } catch {
    return false;
  }
  const at = (i: number) => [{ x: from.x + (dx * i) / steps, y: from.y, id: 1 }];
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (let i = 1; i <= steps; i++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i) });
      await page.waitForTimeout(16);
    }
    await settle(page);
    await beforeLift();
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
  return true;
}

/** The same path with the mouse. */
async function mouseDrag(page: Page, from: Point, dx: number, beforeLift: () => Promise<void>, steps = 15) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps });
  await settle(page);
  await beforeLift();
  await page.mouse.up();
}

/** What the finger lands on at `p`: the slider itself, its drawing, its handle, or something else. */
const under = (page: Page, p: Point, slider: string) =>
  page.evaluate(
    ([x, y, sel]) => {
      const el = document.elementFromPoint(x, y);
      const s = document.querySelector(sel);
      if (!el || !s) return "nothing";
      if (el === s) return "slider";
      if (el.closest("[data-dial-handle]")) return "handle";
      if (s.contains(el)) return `drawing (${el.tagName.toLowerCase()})`;
      return "outside";
    },
    [p.x, p.y, slider] as const,
  );

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test.describe("Sky's dial", () => {
    const DIAL = "[data-dial]";
    const PAD = 27; // TimeDial's DIAL_PAD
    const TRACK_H = 76; // TimeDial's DIAL_TRACK_H

    async function openSky(page: Page) {
      await returnVisit(page);
      // A picture of the day isn't in the seeded store (global-teardown.ts).
      await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
      await page.goto("/u/sample/sky");
      const dial = page.getByRole("slider", { name: "Move through your nights" });
      await expect(dial).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
      await expect(page.locator("[data-sky-wheel]")).not.toHaveAttribute("data-opening", /./);
      await dial.scrollIntoViewIfNeeded();
      await settle(page);
      const box = (await dial.boundingBox())!;
      const max = Number(await dial.getAttribute("aria-valuemax"));
      const w = box.width - 2 * PAD;
      /** The night under a page x, as TimeDial's stepAt reads it. */
      const stepAt = (x: number) => Math.round(Math.min(1, Math.max(0, (x - box.x - PAD) / w)) * max);
      return { dial, box, max, w, stepAt };
    }

    /** Where each case starts: 70% along the nights, on the drawing or on the dial's own strip under it, or on the handle (at tonight). */
    const starts = {
      drawing: (b: { x: number; y: number; width: number }, w: number) => ({ x: b.x + PAD + 0.7 * w, y: b.y + TRACK_H / 2 }),
      strip: (b: { x: number; y: number; width: number }, w: number) => ({ x: b.x + PAD + 0.7 * w, y: b.y + TRACK_H + 23 }),
    };

    for (const [name, where, landsOn] of [
      // The claimed failure: the finger lands on the drawing, which the
      // browser captures it to, and the dial takes capture mid-drag.
      ["a touch drag that starts on the drawing follows the finger", "drawing", /^drawing/],
      // The pair: the finger lands on the dial itself, below the drawing.
      ["a touch drag that starts on the dial below the drawing follows the finger", "strip", /^slider$/],
    ] as const) {
      test(name, async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "touch through the DevTools protocol is Chromium's");
        const { dial, box, w, stepAt } = await openSky(page);
        const from = starts[where](box, w);
        expect(await under(page, from, DIAL)).toMatch(landsOn);
        const dx = -120;
        let during = -1;
        await touchSwipe(page, from, dx, async () => {
          during = Number(await dial.getAttribute("aria-valuenow"));
        });
        // Still under the finger when it lifts: 120px is about a third of the nights.
        expect(Math.abs(during - stepAt(from.x + dx))).toBeLessThanOrEqual(1);
      });
    }

    test("a touch drag on the handle follows the finger", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "touch through the DevTools protocol is Chromium's");
      const { dial, stepAt } = await openSky(page);
      const h = (await page.locator("[data-dial-handle]").boundingBox())!;
      const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
      expect(await under(page, from, DIAL)).toBe("handle");
      let during = -1;
      await touchSwipe(page, from, -120, async () => {
        during = Number(await dial.getAttribute("aria-valuenow"));
      });
      expect(Math.abs(during - stepAt(from.x - 120))).toBeLessThanOrEqual(1);
    });

    test("a mouse drag that starts on the drawing follows the pointer", async ({ page }) => {
      const { dial, box, w, stepAt } = await openSky(page);
      const from = starts.drawing(box, w);
      expect(await under(page, from, DIAL)).toMatch(/^drawing/);
      let during = -1;
      await mouseDrag(page, from, -120, async () => {
        during = Number(await dial.getAttribute("aria-valuenow"));
      });
      expect(Math.abs(during - stepAt(from.x - 120))).toBeLessThanOrEqual(1);
    });
  });

  test.describe("Every night's year strip", () => {
    const STRIP = "[role=slider][aria-label=Month]";

    async function openStrip(page: Page) {
      await returnVisit(page);
      await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
      await page.goto("/u/sample/nights");
      const strip = page.getByRole("slider", { name: "Month" });
      await expect(strip).toBeVisible({ timeout: 30_000 });
      await settle(page);
      const box = (await strip.boundingBox())!;
      const max = Number(await strip.getAttribute("aria-valuemax"));
      return { strip, box, max };
    }

    for (const how of ["touch", "mouse"] as const) {
      test(`a ${how} drag from its last month to its first follows the ${how === "touch" ? "finger" : "pointer"}`, async ({ page, browserName }) => {
        test.skip(how === "touch" && browserName !== "chromium", "touch through the DevTools protocol is Chromium's");
        const { strip, box, max } = await openStrip(page);
        expect(max).toBeGreaterThan(6);
        const from = { x: box.x + box.width - 4, y: box.y + box.height / 2 };
        // The strip is all drawing: the finger lands on its SVG, as on the dial's.
        expect(await under(page, from, STRIP)).toMatch(/^drawing/);
        let during = -1;
        await (how === "touch" ? touchSwipe : mouseDrag)(page, from, -(box.width - 8), async () => {
          during = Number(await strip.getAttribute("aria-valuenow"));
        });
        expect(during).toBe(0);
      });
    }
  });
});
