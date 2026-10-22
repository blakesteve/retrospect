import { expect, returnVisit, test } from "./fixtures";

/* What a visitor meets off the app's paths: the app's own not-found page
   with a 404, for an address it doesn't have and for a listener's or
   compare's address whose percent-encoding can't be read (`/u/abc%`, where
   Next's own routing answered a bare "Internal Server Error"; src/proxy.ts);
   a name that decodes to a "%" (`/u/abc%25`, where the app's second decode
   threw) told it isn't a Last.fm name; the app's own error page when a page
   throws while it draws, where Try again draws it again; and the API's 400s
   carrying the code a page reads. */

const NOT_HERE = "There’s nothing at this address.";

test.describe("an address the app doesn't have (1c)", () => {
  // A lone %, a bad escape, a cut-off UTF-8 sequence (two of its three bytes), and both.
  for (const path of ["/u/abc%", "/u/abc%zz", "/u/%E0%A4", "/u/%E0%A4%A", "/u/abc%/sky", "/u/abc%/nights", "/vs/a%/b", "/vs/a/b%", "/nope", "/u/sample/nope"]) {
    test(`${path} answers 404 with the app's own page and a way back`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res!.status()).toBe(404);
      expect(res!.headers()["content-type"]).toContain("text/html");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOT_HERE);
      await expect(page.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/");
      await expect(page).toHaveTitle("Nothing here · Retrospect");
      await expect(page.locator("body")).not.toContainText("Internal Server Error");
    });
  }

  test("the twin: a listener's own address answers 200 with its page, not the not-found page", async ({ page }) => {
    await returnVisit(page);
    const res = await page.goto("/u/sample");
    expect(res!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(NOT_HERE)).toHaveCount(0);
  });
});

test.describe("a name that decodes to a %, which no Last.fm name has (1c)", () => {
  test("/u/abc%25 says it isn't a Last.fm username, not that something went wrong on our side", async ({ page }) => {
    const res = await page.goto("/u/abc%25");
    expect(res!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That doesn't look like a Last.fm username.", { timeout: 30_000 });
  });
});

test.describe("the API, for a name that can't be read or decodes to a % (1c)", () => {
  for (const name of ["abc%", "abc%25"])
    for (const route of ["status", "answers", "genres", "nights", "songs", "dial", "highlights", "profile", "avatar"]) {
      test(`/api/user/${name}/${route} answers 400 with the code a page reads`, async ({ request }) => {
        // The nights route reads its months before the name.
        const res = await request.get(`/api/user/${name}/${route}?tz=America%2FChicago${route === "nights" ? "&from=2024-05&to=2024-05" : ""}`);
        expect(res.status()).toBe(400);
        expect((await res.json()).code).toBe("invalid-username");
      });
    }

  test("the twin: the sample's own name answers 200", async ({ request }) => {
    const res = await request.get("/api/user/sample/songs?tz=America%2FChicago");
    expect(res.status()).toBe(200);
  });
});

test.describe("a page that throws while it draws (1c)", () => {
  test("shows the app's own error page, not Next's, and Try again draws the page again", async ({ page }) => {
    await returnVisit(page);
    // React hands a caught error to the console, not to window.onerror.
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    // Tonight's sky arrives empty: Tonight throws reading it.
    await page.route("**/api/sky/now?*", (route) => route.fulfill({ json: {} }));
    await page.goto("/u/sample");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Something went wrong on our side.");
    await expect(page.getByText(/It.s not you or your account\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/");
    // Next 16.4's own page for this says "This page couldn’t load".
    await expect(page.locator("body")).not.toContainText(/This page couldn.t load/);
    await expect(page.locator("body")).not.toContainText("Cannot read");
    // It reached the boundary by throwing, not by a page's own failure state.
    expect(errors.join("\n")).toContain("TypeError");

    // Roster's Button arrives in the 44px its placeholder held.
    const button = page.getByRole("button", { name: "Try again" });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBe(44);

    await page.unroute("**/api/sky/now?*");
    await button.click();
    await expect(page.locator("svg[aria-label='Sky wheel']")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Something went wrong on our side.")).toHaveCount(0);
  });

  test("when Try again's button can't load, Try again is a full load of the address instead", async ({ page }) => {
    await returnVisit(page);
    // Once Tonight asks for its sky, the page has all its code: refuse any
    // more, as an old tab after a release would find it gone.
    let late = false;
    await page.route("**/_next/static/chunks/**", (route) => (late ? route.abort() : route.fallback()));
    await page.route("**/api/sky/now?*", (route) => {
      late = true;
      return route.fulfill({ json: {} });
    });
    await page.goto("/u/sample");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Something went wrong on our side.");
    const link = page.getByRole("link", { name: "Try again" });
    await expect(link).toHaveAttribute("href", /\/u\/sample$/);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
