import { existsSync, readFileSync, statSync } from "node:fs";
import type { APIRequestContext, Page } from "@playwright/test";
import { BLOCKED_LOG, DATA_DIR } from "../playwright.config";
import { readAnswers } from "@/lib/answers/store";
import { FsBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { expect, returnVisit, smallTargets, test } from "./fixtures";
import { CONTROL } from "./global-setup";

/* The share sheet and the share cards (spec 8.7.5) in Chromium, on the
   seeded sample. Cards read only what's stored: global setup computed the
   sample's answers and record for America/Chicago. */

const ZONE = "America/Chicago";
/** Vercel's response limit. */
const LIMIT = 4.5 * 1024 * 1024;
/** The made-up sample's full-moon card at 9:16, as the sheet asks for it. */
const TALL_Q = "/api/og?u=sample&card=q%3Afullmoon&tz=America%2FChicago&size=tall";

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (b: Buffer) => ({ png: b.subarray(1, 4).toString("ascii") === "PNG", width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
const blocked = () => (existsSync(BLOCKED_LOG) ? readFileSync(BLOCKED_LOG, "utf8").trim().split("\n").filter(Boolean) : []);

/** The id of a song the sample holds, and its title. */
async function aSong(request: APIRequestContext) {
  const songs = await (await request.get(`/api/user/sample/songs?tz=${encodeURIComponent(ZONE)}`)).json();
  const song = songs.row.find((s: { firstScrobble: boolean; early: boolean }) => !s.firstScrobble && !s.early) ?? songs.row[0];
  return { id: song.songId as string, track: song.track as string };
}

async function openShare(page: Page, value: string, query = "") {
  await returnVisit(page);
  await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
  await page.goto(`/u/sample?share=${encodeURIComponent(value)}${query}`);
  await expect(page.locator("[data-card-preview]")).toBeVisible({ timeout: 30_000 });
}

/** How many of a card's pixels in a box are gold (the signs, the word) and near white (the copy in full ink). */
async function inks(page: Page, png: Buffer, box: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(
    async ({ data, box }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const { data: px } = g.getImageData(box.x, box.y, box.width, box.height);
      let gold = 0;
      let white = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 160 && px[i + 1] > 120 && px[i + 2] < 110) gold++;
        if (px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 215) white++;
      }
      return { gold, white };
    },
    { data: png.toString("base64"), box },
  );
}

test.describe("the share sheet (8.7.5)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("previews the 9:16 card, its targets are 44px, and Copy link says so politely", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openShare(page, "q:fullmoon");
    await expect(page.getByRole("heading", { name: "Share this answer" })).toBeVisible();
    // The preview is this question's tall card itself, loaded.
    await expect(page.locator("[data-card-preview]")).toHaveAttribute("src", TALL_Q);
    await expect
      .poll(() => page.locator("[data-card-preview]").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]), { timeout: 30_000 })
      .toEqual([1080, 1920]);
    // A word never without its question.
    await expect(page.getByRole("dialog")).toContainText("Does a full moon change how late I listen? Not clearly.");
    const { small, reached } = await smallTargets(page);
    expect(small).toEqual([]);
    // Close, Save image and Copy link at least (Share… only where the browser has it); the page behind is inert.
    expect(reached).toBeGreaterThanOrEqual(3);
    // The polite regions are there, empty, before anything is said: a region made with its words isn't announced.
    const said = page.getByRole("dialog").locator('[role="status"][aria-live="polite"]');
    await expect(said).toHaveCount(2);
    await expect(said.nth(0)).toHaveText("");
    await expect(said.nth(1)).toHaveText("");
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(said.filter({ hasText: "Link copied." })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/u\/sample\?q=fullmoon&tz=America%2FChicago$/);
  });

  test("Save image saves that card, the tall one", async ({ page, request }) => {
    await openShare(page, "q:fullmoon");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save image" }).click()]);
    expect(download.suggestedFilename()).toBe("retrospect-sample-q-fullmoon.png");
    const file = await download.path();
    const bytes = readFileSync(file);
    expect(pngSize(bytes)).toEqual({ png: true, width: 1080, height: 1920 });
    expect(statSync(file).size).toBeLessThan(LIMIT);
    // The very card: byte for byte the question's tall card (it holds nothing that changes by the minute).
    expect(bytes.equals(await (await request.get(TALL_Q)).body())).toBe(true);
    await expect(page.getByText("Couldn’t make the image. Try again.")).toHaveCount(0);
  });

  test("a failed save says so in the sheet, politely", async ({ page }) => {
    await openShare(page, "q:fullmoon");
    await page.route("**/api/og?*", (r) => r.fulfill({ status: 500, body: "" }));
    await page.getByRole("button", { name: "Save image" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Couldn’t make the image. Try again." })).toBeVisible();
  });

  test("Share… hands the browser the card's words and link, and a canceled share does nothing", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shared: unknown[]; cancel: boolean };
      w.shared = [];
      w.cancel = false;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: unknown) => {
          w.shared.push(data);
          if (w.cancel) throw new DOMException("Share canceled", "AbortError");
        },
      });
    });
    await openShare(page, "q:fullmoon");
    const shared = () => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared);
    await page.getByRole("button", { name: "Share…" }).click();
    await expect
      .poll(shared)
      .toEqual([
        {
          title: "Retrospect",
          text: "Does a full moon change how late I listen? Not clearly.",
          url: expect.stringMatching(/\/u\/sample\?q=fullmoon&tz=America%2FChicago$/),
        },
      ]);
    await page.evaluate(() => ((window as unknown as { cancel: boolean }).cancel = true));
    await page.getByRole("button", { name: "Share…" }).click();
    await expect.poll(async () => (await shared()).length).toBe(2);
    // Nothing said, nothing closed.
    await expect(page.getByRole("heading", { name: "Share this answer" })).toBeVisible();
    for (const region of await page.getByRole("dialog").locator('[role="status"]').all()) await expect(region).toHaveText("");
  });
});

test.describe("a shared link, in the sharer's zone (7.1)", () => {
  test.use({ viewport: { width: 375, height: 812 }, timezoneId: "Asia/Tokyo" });

  test("opens the song's sheet with its times in America/Chicago, and says so", async ({ page, request }) => {
    const song = await aSong(request);
    await returnVisit(page);
    await page.route("**/api/apod?*", (r) => r.fulfill({ status: 404, json: { error: "not in the sample" } }));
    // The link Copy link makes, as a friend in Tokyo opens it.
    await page.goto(`/u/sample?song=${song.id}&tz=${encodeURIComponent(ZONE)}`);
    await expect(page.getByRole("dialog").getByRole("heading", { name: song.track })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("dialog")).toContainText(/First played \d+:\d\d [ap]\.m\. C[DS]T/);
    await expect(page.getByText("Times in America/Chicago, as shared.")).toBeVisible();
  });

  test("shared on from Tokyo, the link and the card keep the first sharer's zone", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openShare(page, "q:fullmoon", `&tz=${encodeURIComponent(ZONE)}`);
    await expect(page.locator("[data-card-preview]")).toHaveAttribute("src", TALL_Q);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/u\/sample\?q=fullmoon&tz=America%2FChicago$/);
  });
});

test.describe("the share cards (/api/og)", () => {
  test("every card at both sizes: a PNG of the right size, under 4.5 MB, nothing fetched", async ({ request }) => {
    const song = await aSong(request);
    const cards = [`card=song:${song.id}`, "card=night:2024-05-10", "card=q:fullmoon", ""];
    for (const card of cards) {
      for (const [size, width, height] of [
        ["", 1200, 630],
        ["&size=tall", 1080, 1920],
      ] as const) {
        const res = await request.get(`/api/og?u=sample&${card}&tz=${encodeURIComponent(ZONE)}${size}`);
        expect(res.status(), card).toBe(200);
        expect(res.headers()["content-type"]).toBe("image/png");
        const body = await res.body();
        expect(pngSize(body), `${card}${size}`).toEqual({ png: true, width, height });
        expect(body.length, `${card}${size}`).toBeLessThan(LIMIT);
      }
    }
    // The glyphs come from the cards' own font: no font or emoji fetched (8.7.5), by these cards or any
    // drawn earlier in the run. Control: the log holds setup's own refused request, so it's the one being read.
    expect(blocked().filter((l) => CONTROL.test(l))).toHaveLength(1);
    expect(blocked().filter((l) => !CONTROL.test(l))).toEqual([]);
  });

  test("draws the song card's sign glyphs in gold, and the question card's question in ink", async ({ page, request }) => {
    const song = await aSong(request);
    const songCard = await (await request.get(`/api/og?u=sample&card=song:${song.id}&tz=${encodeURIComponent(ZONE)}`)).body();
    // The planets' column sits right of center; the signs are its only gold.
    expect((await inks(page, songCard, { x: 600, y: 120, width: 600, height: 390 })).gold).toBeGreaterThan(300);
    // Between the header and the footer, the question is the only copy in full ink, and the word is gold.
    const qCard = await (await request.get(`/api/og?u=sample&card=q:fullmoon&tz=${encodeURIComponent(ZONE)}`)).body();
    const q = await inks(page, qCard, { x: 0, y: 110, width: 1200, height: 400 });
    expect(q.white).toBeGreaterThan(500);
    expect(q.gold).toBeGreaterThan(300);
  });

  test("with nothing stored in the zone, the card is drawn without computing anything", async ({ request }) => {
    // No one asked for the sample's answers in Kiribati's zone: the card must not compute them (6.6).
    const stored = async () => {
      setBlobStore(new FsBlobStore(DATA_DIR));
      try {
        return [await readAnswers("sample", "Pacific/Kiritimati"), await readAnswers("sample", ZONE)];
      } finally {
        setBlobStore(new MemoryBlobStore());
      }
    };
    expect((await stored()).map(Boolean)).toEqual([false, true]);
    const res = await request.get("/api/og?u=sample&card=q:fullmoon&tz=Pacific/Kiritimati");
    expect(res.status()).toBe(200);
    expect(pngSize(await res.body())).toEqual({ png: true, width: 1200, height: 630 });
    // And nothing stored for a while after: a computation started in the background takes about a second here.
    for (const until = Date.now() + 3000; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
      expect((await stored()).map(Boolean)).toEqual([false, true]);
    }
  });

  test("a shared link's page unfurls as its card in the sharer's zone; compare as the generic card", async ({ request }) => {
    const song = await aSong(request);
    const page = await (await request.get(`/u/sample?song=${song.id}&tz=${encodeURIComponent(ZONE)}`)).text();
    const og = /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1] ?? "";
    expect(og).toContain(`/api/og?u=sample&amp;card=song%3A${song.id}&amp;tz=America%2FChicago`);
    const vs = await (await request.get("/vs/sample/newcomer")).text();
    expect(/<meta property="og:image" content="([^"]+)"/.exec(vs)?.[1]).toMatch(/\/api\/og$/);
  });
});
