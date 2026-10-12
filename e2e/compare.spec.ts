import type { Page } from "@playwright/test";
import { expect, smallTargets, test } from "./fixtures";

/* Compare (spec 8.8) in Chromium: the seeded sample beside the seeded
   newcomer, whose ten weeks leave all 12 of its questions Too early. Both are
   made up (`global-setup.ts`). */

/** Every row's two words, as its data and as drawn, once both sides have their answers. */
const rows = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-row]")].map((row) => {
      const cells = [...row.querySelectorAll<HTMLElement>("[data-cell]")];
      return {
        id: row.dataset.row!,
        words: cells.map((c) => c.dataset.word!),
        // The word a reader sees: the pill's own text.
        shown: cells.map((c) => c.firstElementChild?.textContent?.trim() ?? ""),
        under: cells.map((c) => c.querySelector("p")?.textContent ?? ""),
        opens: Boolean(row.querySelector("button")),
      };
    }),
  );

async function openCompare(page: Page, path = "/vs/sample/newcomer") {
  await page.goto(path);
  // Both sides checked: all 12 rows hold two words.
  await expect
    .poll(
      async () => {
        const all = await rows(page);
        return all.length === 12 && all.every((r) => r.words.length === 2);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await expect(page.locator("[data-progress]")).toHaveCount(0);
}

/** A tested word's swing alone (8.8): "A 23% bigger after-midnight share", "11% more listening". */
const SWING =
  /^(An? [\d,]+% (bigger|smaller) (after-midnight share|share of [a-z ]+)|[\d,]+% (more|less) listening|(Listening|An after-midnight share|A share of [a-z ]+) that barely moved)$/;
const TESTED = ["Yes", "Maybe", "Not clearly", "No"];

for (const width of [375, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("both columns, both words on every row, a one-sided Too early, and no score anywhere", async ({ page }) => {
      await openCompare(page);
      await expect(page.getByRole("heading", { level: 1, name: "Same sky, different people." })).toBeVisible();
      const all = await rows(page);
      // The word a reader sees is the row's word.
      for (const r of all) expect(r.shown, r.id).toEqual(r.words);
      // A row the sample answers and the newcomer can't yet, said on the newcomer's side only.
      const oneSided = all.filter((r) => r.words[0] !== "Too early" && r.words[1] === "Too early");
      expect(oneSided.length).toBeGreaterThan(0);
      for (const r of oneSided) {
        expect(r.under[1], r.id).toMatch(/needs|nothing to compare|start counting/i);
        expect(r.under[0], r.id).not.toMatch(/needs/);
      }
      // Under a tested word, the swing alone.
      const tested = all.filter((r) => TESTED.includes(r.words[0]));
      expect(tested.length).toBeGreaterThan(0);
      for (const r of tested) expect(r.under[0], r.id).toMatch(SWING);
      // Both columns sit side by side, at 375 too.
      const [left, right] = await page.locator("[data-row] [data-cell]").evaluateAll((cells) => cells.slice(0, 2).map((c) => c.getBoundingClientRect().left));
      expect(right).toBeGreaterThan(left + 100);
      // Outside the rows, these words and nothing else: no winner, no score, no tally (8.8).
      const outside = await page.evaluate(() => {
        const all = document.querySelector("main")!.innerText;
        const inRows = document.querySelector<HTMLElement>("[data-rows]")!.innerText;
        return all
          .replace(inRows, "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
      });
      expect(outside).toEqual([
        "RETROSPECT",
        "Same sky, different people.",
        "sample and newcomer, on the same 12 questions. Each answer is checked against its own listener’s history.",
        "sample",
        "newcomer",
      ]);
      // Every row, button and field at least 44px (10, 11).
      const { small, reached } = await smallTargets(page);
      expect(small).toEqual([]);
      expect(reached).toBeGreaterThan(1);
    });
  });
}

/** The sheet's two words and its two sides' sentences, read in one frame: the
    sheet may still be sliding in, which moves them all alike. */
const sheetBoxes = (page: Page) =>
  page.locator("[data-sheet-columns]").evaluate((columns) => {
    const box = (el: Element) => el.getBoundingClientRect().toJSON() as DOMRect;
    const sheet = columns.closest("[role=dialog]")!;
    return {
      words: [...sheet.querySelectorAll("[data-sheet-word]")].map(box),
      sides: [...columns.querySelectorAll(":scope > section")].map(box),
      width: box(columns).width,
      // What a screen reader meets, in order: each listener's name, then their sentences.
      order: [...columns.querySelectorAll(":scope h3, :scope > section")].map((el) => `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent}`),
    };
  });

test.describe("compare's question sheet on a phone (8.8)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("a row whose words differ opens as a URL, the two words side by side and each side's sentences under its own name; one whose words match doesn't", async ({
    page,
  }) => {
    await openCompare(page);
    const all = await rows(page);
    const differ = all.find((r) => r.words[0] !== r.words[1])!;
    const same = all.find((r) => r.words[0] === r.words[1]);
    // In the made-up pair, the first is Mercury retrograde: the sample's No beside the newcomer's Too early.
    expect([differ.id, ...differ.words]).toEqual(["mercury", "No", "Too early"]);
    expect(differ.opens).toBe(true);
    expect(same?.opens).toBe(false);
    // It shows that it opens something: a chevron (8.9).
    await expect(page.locator("[data-row='mercury'] button svg")).toHaveCount(1);
    await page.locator("[data-row='mercury'] button").tap();
    await expect(page).toHaveURL(/[?&]q=mercury(&|$)/);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Question 1 of 12" })).toBeVisible();
    await expect(dialog).toContainText("Does Mercury retrograde change how often you go back to old favorites?");
    // Named as typed, not as the label above them on a phone draws them (in capitals).
    const sample = dialog.getByRole("region", { name: "sample", exact: true });
    const newcomer = dialog.getByRole("region", { name: "newcomer", exact: true });
    await expect(sample).toContainText("No. While Mercury was retrograde");
    await expect(newcomer).toContainText("Too early.");
    const { words, sides, width, order } = await sheetBoxes(page);
    expect(order).toEqual(["H3:sample", "SECTION:sample", "H3:newcomer", "SECTION:newcomer"]);
    // The two words side by side, under the two names, at 375 too.
    expect(words).toHaveLength(2);
    expect(Math.abs(words[1].y - words[0].y)).toBeLessThan(2);
    expect(words[1].x).toBeGreaterThan(words[0].x + 100);
    // Each side's sentences under the words, the sample's then the newcomer's, each the sheet's full width.
    expect(sides).toHaveLength(2);
    expect(sides[0].y).toBeGreaterThanOrEqual(words[0].y + words[0].height);
    expect(sides[1].y).toBeGreaterThanOrEqual(sides[0].y + sides[0].height);
    for (const side of sides) {
      expect(Math.abs(side.x - words[0].x)).toBeLessThan(2);
      expect(side.width).toBeGreaterThan(width - 2);
    }
    // Stacked, each says whose it is.
    await expect(sample.getByText("sample", { exact: true })).toBeVisible();
    await expect(newcomer.getByText("newcomer", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/[?&]q=/);
  });
});

test.describe("compare's question sheet at 1280 (8.8)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("each side's sentences sit in two columns, each under its own name and word", async ({ page }) => {
    await openCompare(page);
    await page.locator("[data-row='mercury'] button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Question 1 of 12" })).toBeVisible();
    const { words, sides, order } = await sheetBoxes(page);
    expect(order).toEqual(["H3:sample", "SECTION:sample", "H3:newcomer", "SECTION:newcomer"]);
    expect(sides).toHaveLength(2);
    expect(sides[0].y).toBeGreaterThanOrEqual(words[0].y + words[0].height);
    expect(Math.abs(sides[1].y - sides[0].y)).toBeLessThan(2);
    expect(sides[1].x).toBeGreaterThan(sides[0].x + 100);
    for (const i of [0, 1]) expect(Math.abs(sides[i].x - words[i].x)).toBeLessThan(2);
    // The name over each column is the one above its word; the regions keep it as their names.
    const sample = dialog.getByRole("region", { name: "sample", exact: true });
    await expect(sample).toContainText("No. While Mercury was retrograde");
    await expect(sample.getByText("sample", { exact: true })).toHaveCount(1);
    await expect(sample.getByText("sample", { exact: true })).toBeHidden();
  });

  test("a side still on its way holds its word's place at the pill's own height, and a side with no answer says so under its name", async ({ page }) => {
    // A shared link straight to the sheet, with the newcomer still being checked.
    await page.route("**/api/user/newcomer/answers?*", (r) => r.fulfill({ json: { status: "computing", done: 4, total: 12, questions: [] } }));
    await page.goto("/vs/sample/newcomer?q=mercury");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "sample", exact: true })).toContainText("No. While Mercury was retrograde", { timeout: 60_000 });
    // The word's skeleton is the pill's height, so the row doesn't move when the word lands.
    const [pill, skeleton] = await dialog.locator("[data-sheet-word]").evaluateAll((cells) => cells.map((c) => c.lastElementChild!.getBoundingClientRect().height));
    expect(skeleton).toBeCloseTo(pill, 1);

    // A side that can't load: no region of sentences, and the reason right under its name.
    await page.goto("/vs/sample/no!one?q=mercury");
    await expect(dialog.getByRole("region", { name: "sample", exact: true })).toContainText("No. While Mercury was retrograde", { timeout: 60_000 });
    await expect(dialog.locator("[data-sheet-columns] > section")).toHaveCount(1);
    const missing = dialog.locator("[data-sheet-word]").nth(1);
    await expect(missing).toContainText("No answer to show.");
    const gap = await missing.evaluate((cell) => cell.lastElementChild!.getBoundingClientRect().top - cell.firstElementChild!.getBoundingClientRect().bottom);
    expect(gap).toBeCloseTo(8, 0);
  });
});

test.describe("compare's sheet and states", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("a question that isn't one of the 12 opens nothing, says so, and leaves the URL", async ({ page }) => {
    await page.goto("/vs/sample/newcomer?q=pluto");
    await expect(page.getByText("That link points to something that isn't in this history.")).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page.getByRole("heading", { name: /^Question \d+ of 12$/ })).toHaveCount(0);
  });

  test("each side's swing sits in its own column, whichever side it's on", async ({ page }) => {
    await openCompare(page, "/vs/newcomer/sample");
    const tested = (await rows(page)).filter((r) => TESTED.includes(r.words[1]));
    expect(tested.length).toBeGreaterThan(0);
    for (const r of tested) {
      expect(r.words[0], r.id).toBe("Too early");
      expect(r.under[1], r.id).toMatch(SWING);
    }
  });

  test("the same listener twice says so, with the two fields", async ({ page }) => {
    await page.goto("/vs/sample/SAMPLE");
    await expect(page.getByRole("heading", { name: "That’s the same listener twice." })).toBeVisible();
    await expect(page.getByLabel("First listener")).toHaveValue("sample");
    await expect(page.getByLabel("Second listener")).toHaveValue("SAMPLE");
    await expect(page.locator("[data-row]")).toHaveCount(0);
  });

  test("a side that can't load says so in its own column, and the other side stands", async ({ page }) => {
    // A name Last.fm can't have: refused before anything is asked of it.
    await page.goto("/vs/sample/no!one");
    const heads = page.locator("[data-columns] > *");
    await expect(heads.nth(1)).toHaveAttribute("data-side-error");
    await expect(heads.nth(1)).toContainText("no!one");
    await expect(heads.nth(1)).toContainText("That doesn't look like a Last.fm username.");
    await expect(heads.nth(0)).not.toHaveAttribute("data-side-error");
    await expect(heads.nth(0)).toHaveText("sample");
    await expect.poll(async () => (await rows(page)).filter((r) => r.words.length === 1).length, { timeout: 60_000 }).toBe(12);
  });

  test("a private side says so in its own column", async ({ page }) => {
    await page.route("**/api/user/newcomer/status", (r) => r.fulfill({ json: { status: "error", code: "private-history" } }));
    await page.goto("/vs/sample/newcomer");
    await expect(page.locator("[data-columns] > *").nth(1)).toContainText("This listening history is private.");
    await expect.poll(async () => (await rows(page)).filter((r) => r.words.length === 1).length, { timeout: 60_000 }).toBe(12);
  });

  test("a side still being checked says how far, in words, and the other side stands", async ({ page }) => {
    await page.route("**/api/user/newcomer/answers?*", (r) => r.fulfill({ json: { status: "computing", done: 4, total: 12, questions: [] } }));
    await page.goto("/vs/sample/newcomer");
    await expect(page.locator("[data-progress]")).toContainText("Checking newcomer: 4 of 12");
    // Said to a screen reader too, at most every 3 seconds (11).
    await expect(page.getByRole("status").filter({ hasText: "Checking newcomer: 4 of 12" })).toHaveCount(1, { timeout: 10_000 });
    await expect.poll(async () => (await rows(page)).filter((r) => r.words.length === 1).length, { timeout: 60_000 }).toBe(12);
  });

  test("a side being checked again swaps its new words in without a reload", async ({ page }) => {
    // The first answer that's ready comes back mid-recheck (6.6a); the next one is the real one.
    let rechecking = true;
    await page.route("**/api/user/newcomer/answers?*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (rechecking && body.status !== "computing") {
        rechecking = false;
        body.status = "updating";
        Object.assign(
          body.questions.find((q: { id: string }) => q.id === "mercury"),
          { word: "Checking", updating: true },
        );
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto("/vs/sample/newcomer");
    const mercury = async () => (await rows(page)).find((r) => r.id === "mercury")?.words[1];
    await expect.poll(mercury, { timeout: 60_000 }).toBe("Checking");
    await expect.poll(mercury, { timeout: 20_000 }).toBe("Too early");
  });
});
