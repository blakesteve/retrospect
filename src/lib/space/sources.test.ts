import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKFILL_FROM,
  RateLimited,
  resetDonkiAllowance,
  FIRST_DATES,
  fetchApodDay,
  fetchApodPage,
  fetchEpicDay,
  fetchApproaches,
  fetchFireballs,
  fetchFlares,
  fetchSdoNearest,
  fetchStorms,
  plainText,
} from "./sources";

/** Answers each fetch with `reply(url)`, and keeps every URL asked for. */
function nasa(reply: (url: string) => Response) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      return reply(url);
    }),
  );
  return asked;
}
beforeEach(() => resetDonkiAllowance());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("where each source starts", () => {
  it("records each source's documented first date, and backfills from 2002 at the earliest", () => {
    expect(FIRST_DATES).toEqual({
      "donki-gst": "2010-04-05",
      "donki-flr": "2010-04-03",
      "jpl-cad": "1900-01-01",
      "jpl-fireball": "1988-04-15",
      epic: "2015-06-13",
      sdo: "2010-05-13",
      apod: "1995-06-16",
    });
    expect(BACKFILL_FROM).toEqual({
      "donki-gst": "2010-04",
      "donki-flr": "2010-04",
      "jpl-cad": "2002-01",
      "jpl-fireball": "2002-01",
      epic: "2015-06",
      sdo: "2010-05",
      apod: "2002-01",
    });
  });
});

describe("DONKI", () => {
  it("reads a month of storms from CCMC, with no key, each reading's time in UTC", async () => {
    const asked = nasa(() =>
      Response.json([
        {
          gstID: "2024-02-27T00:00:00-GST-001",
          startTime: "2024-02-27T00:00Z",
          allKpIndex: [
            { observedTime: "2024-02-27T03:00Z", kpIndex: 5.67 },
            { observedTime: "2024-02-27T06:00Z", kpIndex: null },
          ],
        },
        { gstID: "x", startTime: "2024-02-28T12:00Z", allKpIndex: null },
      ]),
    );
    expect(await fetchStorms("2024-02")).toEqual([
      {
        id: "2024-02-27T00:00:00-GST-001",
        start: "2024-02-27T00:00:00Z",
        readings: [{ time: "2024-02-27T03:00:00Z", kp: 5.67 }],
      },
      { id: "x", start: "2024-02-28T12:00:00Z", readings: [] },
    ]);
    // The whole month, leap day included.
    expect(asked).toEqual(["https://ccmc.gsfc.nasa.gov/DONKI-API/get/GST?startDate=2024-02-01&endDate=2024-02-29"]);
  });

  it("reads a quiet month as none, and flares by peak, falling back to the start", async () => {
    nasa(() => new Response("", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchStorms("2011-01")).rejects.toThrow(/not JSON/);
    nasa(() => Response.json(null));
    expect(await fetchStorms("2011-01")).toEqual([]);
    const asked = nasa(() =>
      Response.json([
        { flrID: "a", beginTime: "2024-05-14T16:46Z", peakTime: "2024-05-14T16:51Z", classType: "X8.7" },
        { flrID: "b", beginTime: "2024-05-15T08:00Z", peakTime: null, classType: "M1.0" },
        { flrID: "c", beginTime: "2024-05-16T08:00Z", peakTime: "2024-05-16T08:10Z", classType: null },
      ]),
    );
    expect(await fetchFlares("2024-05")).toEqual([
      { id: "a", peak: "2024-05-14T16:51:00Z", class: "X8.7" },
      { id: "b", peak: "2024-05-15T08:00:00Z", class: "M1.0" },
    ]);
    expect(asked[0]).toBe("https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?startDate=2024-05-01&endDate=2024-05-31");
  });

  it("stops asking with a few calls of its allowance left, and asks again once it's refilled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    let left = 12;
    const asked = nasa(() => Response.json([], { headers: { "x-rate-limit-remaining": String(left--) } }));
    await fetchStorms("2024-01");
    await fetchStorms("2024-02");
    await fetchStorms("2024-03"); // leaves 10: the reserve
    await expect(fetchStorms("2024-04")).rejects.toThrow(RateLimited);
    expect(asked).toHaveLength(3);
    // At about 1.2 a call a second, one more second leaves it over the reserve.
    vi.setSystemTime(new Date("2026-10-01T12:00:01Z"));
    await fetchStorms("2024-04");
    expect(asked).toHaveLength(4);
  });

  it("stops at a 429 until the allowance has had time to refill", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    let status = 429;
    const asked = nasa(() => Response.json([], { status, headers: { "x-rate-limit-remaining": "40" } }));
    await expect(fetchFlares("2024-01")).rejects.toThrow("429 from ccmc.gsfc.nasa.gov/DONKI-API/get/FLR");
    await expect(fetchFlares("2024-01")).rejects.toThrow(/waiting for it to refill/);
    expect(asked).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-01T12:00:09Z"));
    status = 200;
    await fetchFlares("2024-01");
    expect(asked).toHaveLength(2);
    // Other hosts are never held back by it.
    const others = nasa(() => Response.json({ fields: ["date", "impact-e"], data: [] }));
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    await fetchFireballs("2024-01-01", "2024-01-31");
    expect(others).toHaveLength(1);
  });

  it("throws on a failed reply, naming the host and path but no query", async () => {
    nasa(() => new Response("down", { status: 503 }));
    await expect(fetchStorms("2024-05")).rejects.toThrow("503 from ccmc.gsfc.nasa.gov/DONKI-API/get/GST");
  });
});

describe("JPL", () => {
  it("reads close approaches by field name, JPL's month names and all", async () => {
    const asked = nasa(() =>
      Response.json({
        fields: ["des", "orbit_id", "jd", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf", "t_sigma_f", "h"],
        data: [
          ["2024 MK", "13", "2460491.08", "2024-Jun-29 13:49", "0.00197", "0", "0", "9.6", "9.6", "< 00:01", "21.6"],
          ["  2024 XY  ", "1", "0", "2024-Jun-30 01:02", "0.04", "0", "0", "1", "1", "x", null],
        ],
      }),
    );
    expect(await fetchApproaches("2024-06-01", "2024-06-30")).toEqual([
      { name: "2024 MK", time: "2024-06-29T13:49:00Z", au: 0.00197, h: 21.6 },
      { name: "2024 XY", time: "2024-06-30T01:02:00Z", au: 0.04, h: null },
    ]);
    // JPL reads a bare date-max as 00:00, which would leave Jun 30 out.
    expect(asked[0]).toBe(
      "https://ssd-api.jpl.nasa.gov/cad.api?date-min=2024-06-01&date-max=2024-06-30T23:59:59&dist-max=0.05",
    );
    nasa(() => Response.json({ fields: ["des", "cd", "dist", "h"], count: "0" }));
    expect(await fetchApproaches("2002-01-01", "2002-12-31")).toEqual([]);
  });

  it("reads fireballs, with no energy as null", async () => {
    nasa(() =>
      Response.json({
        fields: ["date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir", "alt", "vel"],
        data: [
          ["2024-05-10 15:00:03", "2.1", "0.083", "1", "N", "2", "E", null, null],
          ["2013-02-15 03:20:33", "375000", null, "54.8", "N", "61.1", "E", "23.3", "18.6"],
        ],
      }),
    );
    expect(await fetchFireballs("2002-01-01", "2026-10-01")).toEqual([
      { time: "2024-05-10T15:00:03Z", kt: 0.083 },
      { time: "2013-02-15T03:20:33Z", kt: null },
    ]);
  });
});

describe("a row that won't read", () => {
  it("is left out, and the rest of the reply kept", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    nasa(() =>
      Response.json([
        { gstID: "bad", startTime: "sometime", allKpIndex: [] },
        {
          gstID: "ok",
          startTime: "2024-05-10T15:00Z",
          allKpIndex: [
            { observedTime: "later", kpIndex: 7 },
            { observedTime: "2024-05-10T18:00Z", kpIndex: 8.33 },
          ],
        },
      ]),
    );
    expect(await fetchStorms("2024-05")).toEqual([
      { id: "ok", start: "2024-05-10T15:00:00Z", readings: [{ time: "2024-05-10T18:00:00Z", kp: 8.33 }] },
    ]);
    nasa(() =>
      Response.json({
        fields: ["des", "cd", "dist", "h"],
        data: [
          ["2024 MK", "2024-Jun-29 13:49", "0.00197", "21.6"],
          ["garbled", "June 29th", "0.01", null],
          ["no distance", "2024-Jun-30 01:00", null, null],
        ],
      }),
    );
    expect((await fetchApproaches("2024-06-01", "2024-06-30")).map((a) => a.name)).toEqual(["2024 MK"]);
    nasa(() =>
      Response.json([
        { image: "epic_1b_a", date: "2024-05-10 00:31:45", centroid_coordinates: { lat: 1, lon: 2 } },
        { image: "epic_1b_b", date: "2024-05-10 01:31:45" },
      ]),
    );
    expect((await fetchEpicDay("2024-05-10")).images.map((i) => i.name)).toEqual(["epic_1b_a"]);
    vi.restoreAllMocks();
  });
});

describe("SDO", () => {
  const listing = (names: string[]) =>
    new Response(`<html><body>${names.map((n) => `<a href="${n}">${n}</a>`).join("\n")}</body></html>`);

  it("picks the day's AIA 171 image nearest the event", async () => {
    const asked = nasa(() =>
      listing([
        "20240510_183000_1024_0171.jpg",
        "20240510_193000_1024_0171.jpg",
        "20240510_193100_1024_0193.jpg",
        "20240510_193100_512_0171.jpg",
        "20240510_203000_1024_0171.jpg",
      ]),
    );
    expect(await fetchSdoNearest("2024-05-10", "2024-05-10T19:40:00Z")).toEqual({
      date: "2024-05-10",
      time: "2024-05-10T19:30:00Z",
      url: "https://sdo.gsfc.nasa.gov/assets/img/browse/2024/05/10/20240510_193000_1024_0171.jpg",
    });
    expect(asked).toEqual(["https://sdo.gsfc.nasa.gov/assets/img/browse/2024/05/10/"]);
  });

  it("finds none on a day without one, or without a folder", async () => {
    nasa(() => listing(["20240510_193000_1024_0193.jpg"]));
    expect(await fetchSdoNearest("2024-05-10", "2024-05-10T19:40:00Z")).toBeNull();
    nasa(() => new Response("Not Found", { status: 404 }));
    expect(await fetchSdoNearest("2012-03-09", "2012-03-09T12:00:00Z")).toBeNull();
    // A failure is still a failure, to be tried again.
    nasa(() => new Response("", { status: 503 }));
    await expect(fetchSdoNearest("2012-03-09", "2012-03-09T12:00:00Z")).rejects.toThrow(/^503 /);
    // EPIC: a day without a folder is a day without photos.
    nasa(() => new Response("{}", { status: 404 }));
    expect(await fetchEpicDay("2015-06-20")).toEqual({ date: "2015-06-20", images: [] });
  });
});

describe("APOD", () => {
  const row = {
    date: "2024-05-10",
    title: "Aurora &amp; the <em>Milky Way</em>",
    credit: "<b>Image Credit &amp; Copyright:</b> <a href='x'>Jane Doe</a> , Some Club",
    media_type: "image",
    permalink: "https://science.nasa.gov/apod/2024/05/10/aurora/",
    url: "https://apod.nasa.gov/apod/image/2405/picture.jpg",
  };

  it("keeps the title, the credit and the page, never the picture", async () => {
    const asked = nasa(() => Response.json(row));
    const day = await fetchApodDay("2024-05-10");
    expect(day).toEqual({
      date: "2024-05-10",
      title: "Aurora & the Milky Way",
      credit: "Jane Doe, Some Club",
      mediaType: "image",
      link: "https://science.nasa.gov/apod/2024/05/10/aurora/",
    });
    expect(JSON.stringify(day)).not.toContain("picture.jpg");
    expect(asked).toEqual(["https://science.nasa.gov/wp-json/wp/v2/apod-basic/240510"]);
  });

  it("has nothing for a day it doesn't know, and throws when NASA fails", async () => {
    nasa(() => new Response("{}", { status: 404 }));
    expect(await fetchApodDay("1990-01-01")).toBeNull();
    // An id that lands on another day (it ignores dates it can't read).
    nasa(() => Response.json({ ...row, date: "2024-05-11" }));
    expect(await fetchApodDay("2024-05-10")).toBeNull();
    nasa(() => new Response("", { status: 500 }));
    await expect(fetchApodDay("2024-05-10")).rejects.toThrow(/^500 /);
  });

  it("reads a page of the archive, 25 days at a time", async () => {
    const asked = nasa(() => Response.json([row, { ...row, date: "2024-05-09", credit: null, media_type: null }]));
    const days = await fetchApodPage(3);
    expect(days.map((d) => [d.date, d.credit, d.mediaType])).toEqual([
      ["2024-05-10", "Jane Doe, Some Club", "image"],
      ["2024-05-09", "", "image"],
    ]);
    expect(asked).toEqual(["https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=25&page=3"]);
  });

  it("turns NASA's HTML into plain text", () => {
    expect(plainText("Moon &#8211; <i>and</i>&nbsp;Venus &#x2019;s &bogus; \n  glow")).toBe("Moon – and Venus ’s &bogus; glow");
    // Past U+10FFFF, fromCodePoint throws: such an entity stays as written.
    expect(plainText("odd &#99999999; &#x110000; end")).toBe("odd &#99999999; &#x110000; end");
  });
});

describe("every source", () => {
  it("asks for no key", async () => {
    const asked = nasa((url) =>
      url.includes("ssd-api")
        ? Response.json({ fields: ["des", "cd", "dist", "h", "date", "impact-e"], data: [] })
        : url.includes("/browse/")
          ? new Response("")
          : Response.json([]),
    );
    await fetchStorms("2024-05");
    await fetchFlares("2024-05");
    await fetchApproaches("2024-05-01", "2024-05-31");
    await fetchFireballs("2024-05-01", "2024-05-31");
    await fetchSdoNearest("2024-05-10", "2024-05-10T12:00:00Z");
    await fetchApodPage(1);
    expect(asked).toHaveLength(6);
    for (const url of asked) expect(url).not.toMatch(/api_key|DEMO_KEY|api\.nasa\.gov/);
  });
});
