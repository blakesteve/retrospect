import type { Page } from "@playwright/test";
import { expect, returnVisit, settle, test } from "./fixtures";

/* The skeletons (Roster's Skeleton, 8.4, 8.7): each page's data held back,
   every part measured while its skeleton shows, then let through and measured
   again once its content lands. Nothing moves: the same height, the same
   place. These are the parts whose size doesn't depend on the night or the
   text, so they hold for any listener on any day; the rest were measured on
   15 Oct 2026, and ROADMAP's "Loading shifts that follow the data" lists them. */

const ZONE = "tz=America%2FChicago";

/** Holds every request matching `patterns` until the returned call lets them through. */
async function hold(page: Page, patterns: string[]) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  for (const p of patterns)
    await page.route(p, async (route) => {
      await gate;
      await route.continue();
    });
  return open;
}

/** Each part's height and its top on the page. */
const boxes = (page: Page, parts: Record<string, string>) =>
  page.evaluate((sel) => {
    const out: Record<string, { top: number; height: number } | null> = {};
    for (const [k, s] of Object.entries(sel)) {
      const r = document.querySelector(s)?.getBoundingClientRect();
      out[k] = r ? { top: r.top + scrollY, height: r.height } : null;
    }
    return out;
  }, parts);

const SHEET = "[data-testid=sheet-panel]";
/** `held`: what's held back. `fed`: every part the held data draws, so the
    rest of the page can land first; `ready`, what else must have landed.
    `parts`: what's measured, each the first match of its selector. `wide`:
    measured at 1280px only, where its size doesn't follow its text. */
const CASES: { name: string; url: string; held: string[]; fed: string[]; ready?: [string, number][]; parts: Record<string, string>; wide?: boolean }[] = [
  {
    name: "Tonight's wild nights",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/user/sample/highlights*"],
    fed: ["#history-h", "section[aria-labelledby=wild-h]"],
    parts: { wild: "section[aria-labelledby=wild-h]", after: "section[aria-labelledby=genres-h]" },
  },
  {
    name: "Every night's first month",
    url: `/u/sample/nights?${ZONE}`,
    held: ["**/api/user/sample/nights*"],
    fed: ["main"],
    parts: { firstMonth: "[data-month]", bar: "[data-nights-bar]" },
  },
  {
    name: "a question's sheet",
    url: `/u/sample?q=fullmoon&${ZONE}`,
    held: ["**/api/user/sample/answers*"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
  },
  {
    name: "a planet's sheet",
    url: `/u/sample?planet=moon&${ZONE}`,
    held: ["**/api/sky/planet*"],
    fed: [SHEET],
    parts: { sheet: SHEET },
  },
  {
    // The card beside its words: the 320px card is the taller.
    name: "the share sheet",
    url: `/u/sample?share=q:fullmoon&${ZONE}`,
    held: ["**/api/user/sample/answers*"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
    wide: true,
  },
  {
    name: "compare's question sheet",
    url: "/vs/sample/newcomer?q=mercury",
    held: ["**/api/user/newcomer/answers*"],
    fed: ["main", SHEET],
    // The sample's side, in the sheet and in all 12 rows, has landed.
    ready: [
      ["[data-sheet-columns] section[aria-label=sample] [data-skeleton]", 0],
      ["[data-rows] [data-cell]", 12],
    ],
    parts: { sheet: SHEET, columns: "[data-sheet-columns]" },
  },
];

for (const [width, phone] of [
  [375, true],
  [1280, false],
] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    for (const c of CASES.filter((c) => !c.wide || width === 1280)) {
      test(`${c.name}: its content lands where its skeleton was`, async ({ page }) => {
        await returnVisit(page);
        // A picture of the day isn't in the seeded store (global-teardown.ts).
        await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
        const release = await hold(page, c.held);
        await page.goto(c.url);
        // The held parts' skeletons are up, drawn as Roster's, and everything
        // not held back has landed, so only what the held data draws can move.
        const part = (sel: string) => page.locator(sel).first();
        await expect(part(Object.values(c.parts)[0]).locator("[data-skeleton]").first()).toBeAttached({ timeout: 30_000 });
        const onlyFed = () => page.evaluate((fed) => [...document.querySelectorAll("[data-skeleton]")].every((s) => fed.some((f) => s.closest(f))), c.fed);
        await expect.poll(onlyFed, { timeout: 30_000 }).toBe(true);
        for (const [sel, n] of c.ready ?? []) await expect(page.locator(sel)).toHaveCount(n, { timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const before = await boxes(page, c.parts);
        release();
        // Landed: no skeleton left in what's measured.
        for (const sel of Object.values(c.parts)) await expect(part(sel).locator("[data-skeleton]")).toHaveCount(0, { timeout: 30_000 });
        await settle(page);
        const after = await boxes(page, c.parts);
        for (const k of Object.keys(c.parts)) {
          expect(before[k], `${k} while loading`).not.toBeNull();
          expect(after[k]!.height, `${k}'s height`).toBeCloseTo(before[k]!.height, 0);
          expect(after[k]!.top, `${k}'s place`).toBeCloseTo(before[k]!.top, 0);
        }
      });
    }
  });
}
