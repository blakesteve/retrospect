import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { allUserKeys } from "./store/userKeys";
import { removeUserData } from "./removal";
import { GET as shareCard } from "@/app/api/og/route";

/* A removed history's share card must not outlive the removal by more than a
   day in any cache that honors the header. It was believed to cache for a
   year: `@vercel/og` sets `max-age=31536000`, but `next/og` replaces that
   response's headers with its own, and production sends
   `public, max-age=0, must-revalidate`. That value is now set in the route and
   pinned here, read off the real response rather than a constant. */

beforeEach(() => setBlobStore(new MemoryBlobStore()));
afterEach(() => setBlobStore(null));

const ONE_DAY_SECONDS = 86_400;

/** How old a card can be when someone last sees it without anyone asking the
    server again. Layers add up: a CDN copy up to `s-maxage` old (plus any
    stale-while-revalidate) can then sit in a browser for `max-age`. An
    `immutable` card is never asked about again. (`no-store` caches nothing,
    so it scores 0 through the zeros below.) */
function longestReuse(cacheControl: string): number {
  if (/\bimmutable\b/.test(cacheControl)) return Infinity;
  const seconds = (name: string) => Number(new RegExp(`\\b${name}=(\\d+)`).exec(cacheControl)?.[1] ?? 0);
  return seconds("s-maxage") + seconds("stale-while-revalidate") + seconds("max-age");
}

describe("the share card's cache header", () => {
  it("is exactly the no-caching value, and a real PNG comes with it", async () => {
    const res = await shareCard(new Request("http://x/api/og"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(res.headers.get("content-type")).toBe("image/png");
    // The render itself ran: a response with no body would pass the checks above.
    const png = new Uint8Array(await res.arrayBuffer());
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("keeps a removed history's card for a day at most", async () => {
    const store = new MemoryBlobStore();
    setBlobStore(store);
    for (const key of allUserKeys("card-then-gone")) await store.put(key, Buffer.from("x"));
    await removeUserData("card-then-gone");

    const res = await shareCard(new Request("http://x/api/og?u=card-then-gone"));
    expect(res.status).toBe(200);
    expect(longestReuse(res.headers.get("cache-control") ?? "")).toBeLessThanOrEqual(ONE_DAY_SECONDS);
  });

  it("measures reuse the way a cache would", () => {
    // The helper is the requirement's yardstick, so check it can fail.
    expect(longestReuse("public, immutable, no-transform, max-age=31536000")).toBe(Infinity);
    expect(longestReuse("public, max-age=3600, s-maxage=86400")).toBe(90_000);
    expect(longestReuse("public, max-age=0, must-revalidate")).toBe(0);
  });
});
