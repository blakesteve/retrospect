import type { Page } from "@playwright/test";
import { expect, returnVisit, settle, test } from "./fixtures";

/* The skeletons (Roster's Skeleton, 8.4, 8.7): each page's data held back,
   every part measured while its skeleton shows, then let through and measured
   again once its content lands. Nothing moves: the same height, the same
   place. A part's room is held whatever its data says (two lines for a song's
   title, the arrows' box beside a row's title, a sheet at its full height), or
   its skeleton knows what's coming (Tonight's heading, the 12 questions, a
   share link). What still follows the data, "Tonight, for you", "Your habits"
   and compare's rows, ROADMAP's "Loading shifts that follow the data" lists
   with its measured shift. Each part is measured on a page freshly loaded at
   its size, once fonts are in and nothing finite is still moving. */

const ZONE = "tz=America%2FChicago";

/** Holds every request matching `patterns` until the returned call lets them
    through, to any route a case set up before it (Playwright runs the
    newest first), then the server. */
async function hold(page: Page, patterns: string[]) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  for (const p of patterns)
    await page.route(p, async (route) => {
      await gate;
      await route.fallback();
    });
  return open;
}

/** Fonts in, nothing finite still moving, then two frames. */
async function still(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 5; i++) {
      const moving = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
      if (moving.length === 0) break;
      await Promise.all(moving.map((a) => a.finished.catch(() => undefined)));
    }
  });
  await settle(page);
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
const FOR_YOU = "section[aria-labelledby=foryou-h]";
/** A phone, and the two widths every case is measured at unless it says. */
const PHONE = { width: 375, height: 900, phone: true };
const LAPTOP = { width: 1280, height: 900, phone: false };
/** A narrow window with a mouse: the rows show their arrows, so a long title
    beside them takes a second line, as it must in the skeleton too. */
const NARROW_MOUSE = { width: 375, height: 900, phone: false };
/** A screen taller than any sheet's body, where one that didn't fill it shrank. */
const TALL = { width: 1280, height: 1300, phone: false };
type Size = { width: number; height: number; phone: boolean };

/** `held`: what's held back. `fed`: every part the held data draws, so the
    rest of the page can land first; `ready`, what else must have landed.
    `parts`: what's measured, each the first match of its selector, its
    height and its place; `heightOnly`, parts under "Tonight, for you",
    whose place follows its rows. `watch`: where the held data's skeleton
    shows and then goes (the first part, unless it has none of its own). `sizes`: where it's measured. `fake`: a
    route the case needs (two genres, too few to page). `heldAfterLoad`
    and `open`: what's held only once the page is in, and what opens the
    part then (a sheet whose code is split off the page). */
const CASES: {
  name: string;
  url: string;
  held: string[];
  fed: string[];
  ready?: [string, number][];
  parts: Record<string, string>;
  heightOnly?: Record<string, string>;
  watch?: string;
  /** What else must be true once it's landed, so the case measured what it says. */
  landed?: (page: Page) => Promise<void>;
  sizes?: Size[];
  fake?: (page: Page) => Promise<void>;
  heldAfterLoad?: boolean;
  open?: (page: Page) => Promise<void>;
}[] = [
  {
    name: "Tonight's wild nights",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/user/sample/highlights*"],
    fed: ["#history-h", "section[aria-labelledby=wild-h]"],
    parts: { wild: "section[aria-labelledby=wild-h]", after: "section[aria-labelledby=genres-h]" },
  },
  {
    // The heading needs only the zone and the clock, so it's drawn at once.
    name: "Tonight's heading and wheel",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/sky/now?*"],
    fed: ["#tonight-wheel", FOR_YOU, `${FOR_YOU} + div + div`, "section[aria-labelledby=coming-h]"],
    parts: { wheel: "#tonight-wheel", heading: "#view-heading" },
    heightOnly: { comingUp: "section[aria-labelledby=coming-h]" },
    sizes: [PHONE, NARROW_MOUSE, LAPTOP],
  },
  {
    // Every event one line: each card holds two lines' room anyway, so the
    // row lands at its skeleton's height (the sample's own all take two).
    name: "coming up, every event one line",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/sky/now?*"],
    fed: ["#tonight-wheel", FOR_YOU, `${FOR_YOU} + div + div`, "section[aria-labelledby=coming-h]"],
    parts: {},
    heightOnly: { comingUp: "section[aria-labelledby=coming-h]" },
    sizes: [PHONE, NARROW_MOUSE, LAPTOP],
    fake: (page) =>
      page.route("**/api/sky/now?*", async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        expect(body.comingUp.length).toBeGreaterThan(0);
        await route.fulfill({ response: res, json: { ...body, comingUp: body.comingUp.map((c: object) => ({ ...c, text: "Full moon" })) } });
      }),
    landed: async (page) => {
      // What it measured: every event on one line.
      const lines = await page.locator("section[aria-labelledby=coming-h] p.font-display").evaluateAll((ps) =>
        ps.map((p) => {
          const range = document.createRange();
          range.selectNodeContents(p);
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
        }),
      );
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines)).toEqual(new Set([1]));
    },
  },
  {
    // The 12 tiles at once, each word's pill a skeleton until the words come.
    name: "the 12 questions",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/user/sample/answers*"],
    fed: ["#questions-grid", FOR_YOU],
    parts: {},
    heightOnly: { questions: "#questions-grid" },
    landed: async (page) => {
      // The subtitle line once the words are in, as the UX lead wrote it
      // (24 Oct): a tile can read "Not checked" or "Too early", so not "checked".
      await expect(page.locator("#questions-h + p")).toHaveText("Each answer comes from your own listening.");
    },
  },
  {
    name: "the sky of your songs",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/user/sample/songs*"],
    fed: ["section[aria-labelledby=songs-h]"],
    parts: { songs: "section[aria-labelledby=songs-h]", after: "section[aria-labelledby=wild-h]" },
    sizes: [PHONE, NARROW_MOUSE, LAPTOP],
  },
  {
    name: "your genres",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/user/sample/genres*"],
    fed: ["section[aria-labelledby=genres-h]"],
    parts: { genres: "section[aria-labelledby=genres-h]", after: "section[aria-labelledby=your-habits-h]" },
  },
  {
    // Too few to page, so no arrows: the heading line holds their box anyway.
    name: "two genres, too few to page",
    url: `/u/sample?${ZONE}`,
    held: ["**/api/user/sample/genres*"],
    fed: ["section[aria-labelledby=genres-h]"],
    parts: { genres: "section[aria-labelledby=genres-h]", after: "section[aria-labelledby=your-habits-h]" },
    sizes: [LAPTOP],
    fake: (page) =>
      page.route("**/api/user/sample/genres*", async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        expect(body.genres.length).toBeGreaterThan(2);
        await route.fulfill({ response: res, json: { ...body, genres: body.genres.slice(0, 2) } });
      }),
    landed: async (page) => {
      // What it measured: two cards, and no arrows to page them.
      const row = page.locator("section[aria-labelledby=genres-h]");
      await expect(row.getByRole("link", { name: /^Your biggest/ })).toHaveCount(2);
      await expect(row.getByRole("button", { name: /genres$/ })).toHaveCount(0);
    },
  },
  {
    name: "Every night's first month",
    url: `/u/sample/nights?${ZONE}`,
    held: ["**/api/user/sample/nights*"],
    fed: ["main"],
    parts: { firstMonth: "[data-month]", bar: "[data-nights-bar]" },
  },
  {
    // The key's line under the wheel, held while tonight's sky is on its way.
    name: "the Sky view's wheel and key",
    url: `/u/sample/sky?${ZONE}`,
    held: ["**/api/sky/now?*"],
    fed: ["main"],
    watch: "main",
    parts: { wheel: "[data-sky-wheel]", nights: "section[aria-label='Your nights']" },
  },
  {
    // Each side's progress under its name, in a line kept once it's done.
    name: "compare's columns",
    url: "/vs/sample/newcomer",
    held: ["**/api/user/newcomer/answers*"],
    fed: ["[data-rows]"],
    watch: "[data-rows]",
    parts: { columns: "[data-columns]" },
  },
  {
    name: "a question's sheet",
    url: `/u/sample?q=fullmoon&${ZONE}`,
    held: ["**/api/user/sample/answers*"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
    sizes: [PHONE, LAPTOP, TALL],
  },
  {
    name: "a planet's sheet",
    url: `/u/sample?planet=moon&${ZONE}`,
    held: ["**/api/sky/planet*"],
    fed: [SHEET],
    parts: { sheet: SHEET },
    sizes: [PHONE, LAPTOP, TALL],
  },
  {
    // The chart's code is its own chunk, loaded when the sheet opens.
    name: "the birth chart's sheet",
    url: `/u/sample/sky?${ZONE}`,
    held: ["**/_next/static/chunks/*.js"],
    heldAfterLoad: true,
    open: (page) => page.locator('a[href*="chart=you"]').first().click(),
    fed: [SHEET],
    parts: { sheet: SHEET },
    sizes: [PHONE, LAPTOP, TALL],
  },
  {
    name: "the landing's Tonight",
    url: "/?sample=tonight",
    held: ["**/samples/*.json", "**/api/sky/now?*"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
    sizes: [PHONE, LAPTOP, TALL],
  },
  {
    // It never fills the sheet; the sheet stands at its full height anyway.
    name: "the landing's answers",
    url: "/?sample=answers",
    held: ["**/samples/*.json"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
    sizes: [PHONE, LAPTOP, TALL],
  },
  {
    // The card beside its words from 640px, under them below it, where the
    // words have the sheet's width: the link and the question drawn as
    // themselves, so their lines break where the sheet's do.
    name: "the share sheet",
    url: `/u/sample?share=q:fullmoon&${ZONE}`,
    held: ["**/api/user/sample/answers*"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
    sizes: [PHONE, ...[476, 520, 560, 600, 639].map((width) => ({ width, height: 900, phone: false })), LAPTOP],
  },
  {
    // A longer question ending on "Not clearly.": a line more than "No.",
    // the word the skeleton once held room for, at 476px.
    name: "the share sheet, a long question",
    url: `/u/sample?share=q:moonstrong&${ZONE}`,
    held: ["**/api/user/sample/answers*"],
    fed: [SHEET, "main"],
    parts: { sheet: SHEET },
    sizes: [PHONE, ...[476, 520, 560, 600, 639].map((width) => ({ width, height: 900, phone: false })), LAPTOP],
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

for (const c of CASES)
  for (const size of c.sizes ?? [PHONE, LAPTOP])
    test.describe(`at ${size.width} by ${size.height}px${size.phone || size.width > 1000 ? "" : ", with a mouse"}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, isMobile: size.phone, hasTouch: size.phone });
      test(`${c.name}: its content lands where its skeleton was`, async ({ page }) => {
        await returnVisit(page);
        // A picture of the day isn't in the seeded store (global-teardown.ts).
        await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
        await c.fake?.(page);
        let release = c.heldAfterLoad ? () => {} : await hold(page, c.held);
        await page.goto(c.url);
        if (c.heldAfterLoad) {
          // Everything the page loads with is in before anything is held.
          await page.waitForLoadState("networkidle");
          release = await hold(page, c.held);
        }
        await c.open?.(page);
        // The held parts' skeletons are up, drawn as Roster's, and everything
        // not held back has landed, so only what the held data draws can move.
        const all = { ...c.parts, ...c.heightOnly };
        const part = (sel: string) => page.locator(sel).first();
        const watch = c.watch ?? Object.values(all)[0];
        await expect(part(watch).locator("[data-skeleton]").first()).toBeAttached({ timeout: 30_000 });
        const onlyFed = () => page.evaluate((fed) => [...document.querySelectorAll("[data-skeleton]")].every((s) => fed.some((f) => s.closest(f))), c.fed);
        await expect.poll(onlyFed, { timeout: 30_000 }).toBe(true);
        for (const [sel, n] of c.ready ?? []) await expect(page.locator(sel)).toHaveCount(n, { timeout: 30_000 });
        // Shown, not only attached: compare's columns were 0px tall for the first moment.
        for (const sel of Object.values(all)) await expect(part(sel)).toBeVisible({ timeout: 30_000 });
        await still(page);
        const before = await boxes(page, all);
        release();
        // Landed: no skeleton left in what's measured, nor where the data was watched.
        for (const sel of [watch, ...Object.values(all)]) await expect(part(sel).locator("[data-skeleton]")).toHaveCount(0, { timeout: 30_000 });
        await c.landed?.(page);
        await still(page);
        const after = await boxes(page, all);
        for (const k of Object.keys(all)) {
          expect(before[k], `${k} while loading`).not.toBeNull();
          expect(after[k]!.height, `${k}'s height`).toBeCloseTo(before[k]!.height, 0);
          if (k in c.parts) expect(after[k]!.top, `${k}'s place`).toBeCloseTo(before[k]!.top, 0);
        }
      });
    });
