import { expect, test as base, type Page } from "@playwright/test";

/** The page never leaves this machine either: album art and NASA's photos
    would come from the network, so every request off it is refused (the
    cards keep their drawn skies). The hosts refused are noted on the test. */
export const test = base.extend<{ localOnly: string[] }>({
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

export { expect };

/** Two frames: IntersectionObserver callbacks and React have run. */
export const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

/** A return visit: the reveal and the guide already seen. */
export const returnVisit = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("retrospect:guide-done", "1");
      localStorage.setItem("retrospect:reveal-seen:sample", "1");
    } catch {}
  });

/** Every link, button and field on the page smaller than 44 by 44px (spec 10, 11), and how many were measured. */
export const smallTargets = (page: Page) =>
  page.evaluate(() => {
    const small: string[] = [];
    let reached = 0;
    for (const el of document.querySelectorAll("body a, body button, body input, body [role=button], body [role=slider]")) {
      // The wheel's planets: a tap goes to the nearest within 22px, checked on Tonight.
      if (el.closest("[data-body]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest("[inert]") || getComputedStyle(el).visibility === "hidden") continue;
      reached++;
      if (r.width < 44 || r.height < 44)
        small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}`);
    }
    return { small, reached };
  });

/** The view switcher's labels on what's behind them (11; ClickUp 86e3h9mca): the selected tab's on its
    pill, and an unselected tab's on the track, its translucent layers laid over the page's sky. */
export const selectedTabContrast = (page: Page) =>
  page.evaluate(() => {
    // Any CSS color (rgb, oklch, a token's hex) to 0-255 RGB and alpha, through a canvas.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (fg: number[], bg: number[]) => {
      const [x, y] = [lum(fg), lum(bg)].sort((m, n) => n - m);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    const active = document.querySelector("nav[aria-label=Views] [aria-current=page]");
    const pill = document.querySelector("nav[aria-label=Views] [data-testid=liquid-tabs-pill]");
    const other = document.querySelector("nav[aria-label=Views] a:not([aria-current])");
    if (!active || !pill || !other) return null;
    const fg = rgba(getComputedStyle(active).color);
    const bg = rgba(getComputedStyle(pill).backgroundColor);
    // The unselected label's background: every layer from the page down to it.
    const layers: number[][] = [];
    for (let el: Element | null = other; el; el = el.parentElement) layers.unshift(rgba(getComputedStyle(el).backgroundColor));
    const track = layers.reduce((under, top) => over(top, under), [0, 0, 0, 1]);
    return {
      label: active.textContent!.trim(),
      links: document.querySelectorAll("nav[aria-label=Views] a").length,
      ratio: ratio(fg, bg),
      fg,
      bg,
      other: { label: other.textContent!.trim(), ratio: ratio(over(rgba(getComputedStyle(other).color), track), track) },
    };
  });
