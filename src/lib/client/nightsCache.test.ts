import { afterEach, describe, expect, it, vi } from "vitest";
import { loadedYear, nightsYear, withCounts, yearUrl } from "@/components/listener/nightsCache";
import { userUrl } from "@/components/listener/api";

/* Every night's year cache (8.5): the whole history's counts come once a
   visit, with the first year asked for, never with every year. Fetch is
   stubbed, and each test is a listener of its own, since the cache keeps
   what it has for the visit. Every year asks up to May 2024, so every URL
   below is a literal. */

const COUNTS = {
  filterCounts: { storm: 2 },
  genreCounts: { shoegaze: 1 },
  filterMonths: { storm: { "2024-05": 2 } },
  genreMonths: { shoegaze: { "2024-05": 1 } },
};
const LAST = "2024-05";
const listener = (name: string, zone = "America/Chicago") => ({ zone, listenerUrl: (route: string, extra = "") => userUrl(name, route, zone, extra) });
const url = (name: string, from: string, to: string, counts = false, tz = "America%2FChicago") =>
  `/api/user/${name}/nights?tz=${tz}&from=${from}&to=${to}${counts ? "&counts=1" : ""}`;

/** The route's answer: the counts only when asked, as the route sends them. */
const ok = (u: string, extra: object = {}) =>
  new Response(
    JSON.stringify({
      status: "ready",
      zone: "America/Chicago",
      nights: [],
      first: "2023-09-28",
      nasa: "ok",
      ...(u.includes("counts=1") ? { ...COUNTS, ...extra } : {}),
    }),
  );
const unavailable = () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });

function stub(answer: (u: string) => Response) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      asked.push(u);
      return answer(u);
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the whole history's counts, once a visit (8.5)", () => {
  it("come with the first year asked for; a later year asks for its nights alone and reads them from the cache", async () => {
    const L = listener("once");
    const asked = stub((u) => ok(u));
    await nightsYear(L, 2024, LAST);
    await nightsYear(L, 2023, LAST);
    expect(asked).toEqual([url("once", "2024-01", "2024-05", true), url("once", "2023-01", "2023-12")]);
    const y2023 = loadedYear(yearUrl(L, 2023, LAST))!;
    expect(y2023.meta.filterCounts).toBeUndefined();
    expect(withCounts(L, y2023.meta)).toMatchObject({ first: "2023-09-28", ...COUNTS });
  });

  it("come once when two years are asked at once: the second waits for the first, then asks alone", async () => {
    const L = listener("together");
    const asked = stub((u) => ok(u));
    await Promise.all([nightsYear(L, 2024, LAST), nightsYear(L, 2023, LAST)]);
    expect(asked).toEqual([url("together", "2024-01", "2024-05", true), url("together", "2023-01", "2023-12")]);
  });

  it("are asked for again by a year waiting on one that didn't load, and not by Try again once they're here", async () => {
    const L = listener("fails");
    let asked = stub((u) => (u.includes("from=2024") ? unavailable() : ok(u)));
    const [y2024, y2023] = await Promise.allSettled([nightsYear(L, 2024, LAST), nightsYear(L, 2023, LAST)]);
    expect([y2024.status, y2023.status]).toEqual(["rejected", "fulfilled"]);
    expect(asked).toEqual([url("fails", "2024-01", "2024-05", true), url("fails", "2023-01", "2023-12", true)]);
    asked = stub((u) => ok(u));
    await nightsYear(L, 2024, LAST);
    expect(asked).toEqual([url("fails", "2024-01", "2024-05")]);
  });

  it("are asked for again while a record being rebuilt sends them without months", async () => {
    const L = listener("rebuilt");
    let months: object = { filterMonths: null, genreMonths: null };
    const asked = stub((u) => ok(u, months));
    await nightsYear(L, 2024, LAST);
    expect(withCounts(L, loadedYear(yearUrl(L, 2024, LAST))!.meta).filterMonths).toBeNull();
    months = {};
    await nightsYear(L, 2023, LAST);
    await nightsYear(L, 2022, LAST);
    expect(asked).toEqual([url("rebuilt", "2024-01", "2024-05", true), url("rebuilt", "2023-01", "2023-12", true), url("rebuilt", "2022-01", "2022-12")]);
    // The year that came with null months reads the rebuilt ones now.
    expect(withCounts(L, loadedYear(yearUrl(L, 2024, LAST))!.meta).filterMonths).toEqual(COUNTS.filterMonths);
  });

  it("are a zone's own: another zone asks for them again", async () => {
    const asked = stub((u) => ok(u));
    await nightsYear(listener("zones"), 2024, LAST);
    await nightsYear(listener("zones", "Asia/Tokyo"), 2024, LAST);
    expect(asked).toEqual([url("zones", "2024-01", "2024-05", true), url("zones", "2024-01", "2024-05", true, "Asia%2FTokyo")]);
  });
});
