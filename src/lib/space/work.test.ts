import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { COMPACT_KEY, nasaLogFrom, readCompact, writeCompact } from "./compact";
import { resetDonkiAllowance } from "./sources";
import { PROGRESS_KEY, monthsBetween, readMonth, storedMonths, writeMonth, writeSpaceJson } from "./store";
import { synthCompact } from "./synthLog";
import { resetSpaceWork, runSpaceWork } from "./work";

/* A pass over a fake NASA, on a clock the test moves: the 3-hour and daily
   freshness rules, the budget, and the per-process gap all run on it. Each
   fetch can cost fake time, so a budget runs out the way it does for real. */

interface Fake {
  storms: Record<string, object[]>;
  flares: Record<string, object[]>;
  approaches: { des: string; cd: string; dist: string; h: string | null }[];
  fireballs: { date: string; kt: string | null }[];
  epicDates: string[];
  sdo: Record<string, string[]>;
  /** Newest first, as the archive pages it. */
  apod: string[];
  /** A reply other than 200 for this URL, or null. */
  status: (url: string) => number | null;
  msPerFetch: number;
}

let fake: Fake;
let asked: string[];
let blobs: MemoryBlobStore;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const jplTime = (iso: string) => `${iso.slice(0, 4)}-${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]}-${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
/** As JPL reads its bounds: a bare date is that day's 00:00. */
const jplBound = (value: string) => Date.parse(value.includes("T") ? `${value}Z` : `${value}T00:00:00Z`);
const jplWithin = (q: URLSearchParams, iso: string) =>
  Date.parse(`${iso}Z`) >= jplBound(q.get("date-min")!) && Date.parse(`${iso}Z`) <= jplBound(q.get("date-max")!);

function reply(url: URL): Response {
  const q = url.searchParams;
  if (url.host === "ccmc.gsfc.nasa.gov") {
    const month = q.get("startDate")!.slice(0, 7);
    return Response.json((url.pathname.endsWith("/GST") ? fake.storms : fake.flares)[month] ?? []);
  }
  if (url.pathname === "/cad.api") {
    const rows = fake.approaches.filter((a) => jplWithin(q, a.cd));
    return Response.json({ fields: ["des", "cd", "dist", "h"], data: rows.map((a) => [a.des, jplTime(a.cd), a.dist, a.h]) });
  }
  if (url.pathname === "/fireball.api") {
    const rows = fake.fireballs.filter((f) => jplWithin(q, f.date.replace(" ", "T")));
    return Response.json({ fields: ["date", "impact-e"], data: rows.map((f) => [f.date, f.kt]) });
  }
  if (url.pathname === "/api/natural/available") return Response.json(fake.epicDates);
  const epic = /^\/api\/natural\/date\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
  if (epic) {
    return Response.json([
      { image: `epic_1b_${epic[1].replace(/-/g, "")}003633`, date: `${epic[1]} 00:31:45`, centroid_coordinates: { lat: 5, lon: 170 } },
    ]);
  }
  const sdo = /\/browse\/(\d{4})\/(\d{2})\/(\d{2})\/$/.exec(url.pathname);
  if (sdo) return new Response((fake.sdo[`${sdo[1]}-${sdo[2]}-${sdo[3]}`] ?? []).map((n) => `<a href="${n}">${n}</a>`).join("\n"));
  if (url.pathname === "/wp-json/wp/v2/apod-basic") {
    const page = Number(q.get("page"));
    return Response.json(
      fake.apod.slice((page - 1) * 25, page * 25).map((date) => ({
        date,
        title: `Picture of ${date}`,
        credit: "Someone",
        media_type: "image",
        permalink: `https://science.nasa.gov/apod/${date}/`,
      })),
    );
  }
  return new Response("not found", { status: 404 });
}

const NOW = "2026-10-12T12:00:00Z";
const setNow = (iso: string) => vi.setSystemTime(new Date(iso));
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const HOUR = 3_600_000;

beforeEach(() => {
  resetDonkiAllowance();
  resetSpaceWork();
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(NOW);
  blobs = new MemoryBlobStore();
  setBlobStore(blobs);
  asked = [];
  fake = {
    storms: {},
    flares: {},
    approaches: [],
    fireballs: [],
    epicDates: [],
    sdo: {},
    apod: [],
    status: () => null,
    msPerFetch: 0,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (href: string) => {
      asked.push(href);
      later(fake.msPerFetch);
      const status = fake.status(href);
      if (status) return new Response("no", { status });
      return reply(new URL(href));
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setBlobStore(null);
});

const DONKI = ["donki-gst", "donki-flr"] as const;
const donki = () => runSpaceWork({ budgetMs: 60_000, only: [...DONKI] });
const storm = (start: string, readings: [string, number][]) => ({
  gstID: `${start}-GST-001`,
  startTime: start,
  allKpIndex: readings.map(([observedTime, kpIndex]) => ({ observedTime, kpIndex })),
});
const log = async () => nasaLogFrom(await readCompact());
const stampedAt = async () => (await readCompact())!.refreshedAt;
const startDates = () => asked.map((u) => `${new URL(u).pathname.slice(-3)} ${new URL(u).searchParams.get("startDate")}`);

describe("DONKI", () => {
  it("fills every month from April 2010, this month first, and stamps the log once both are current", async () => {
    fake.storms["2024-05"] = [storm("2024-05-10T15:00Z", [["2024-05-10T18:00Z", 8.33], ["2024-05-10T21:00Z", 9]])];
    fake.flares["2024-05"] = [{ flrID: "f", beginTime: "2024-05-14T16:46Z", peakTime: "2024-05-14T16:51Z", classType: "X8.7" }];
    const summary = await donki();

    expect(monthsBetween("2010-04", "2026-10")).toHaveLength(199);
    expect(summary).toMatchObject({ skipped: false, fetches: 398, failed: [], done: true });
    expect(startDates().slice(0, 2)).toEqual(["GST 2026-10-01", "GST 2010-04-01"]);
    expect(asked.every((u) => u.startsWith("https://ccmc.gsfc.nasa.gov/DONKI-API/get/"))).toBe(true);
    expect((await storedMonths("donki-gst")).size).toBe(199);
    expect(await readMonth("donki-flr", "2010-04")).toMatchObject({ firstDate: "2010-04-03", refreshedAt: "2026-10-12T12:00:00.000Z", records: [] });

    expect(await stampedAt()).toBe("2026-10-12T12:00:00.000Z");
    const nasa = (await log())!;
    expect(nasa.kp).toEqual([
      [Date.parse("2024-05-10T15:00Z") / 1000, Date.parse("2024-05-10T18:00Z") / 1000, 8.33],
      [Date.parse("2024-05-10T18:00Z") / 1000, Date.parse("2024-05-10T21:00Z") / 1000, 9],
    ]);
    expect(nasa.xflares).toEqual([[Date.parse("2024-05-14T16:51Z") / 1000, "X8.7"]]);
  });

  it("refreshes this month once it's over 3 hours old, and nothing else", async () => {
    await donki();
    later(3 * HOUR - 60_000);
    asked = [];
    expect((await donki()).fetches).toBe(0);
    expect(await stampedAt()).toBe("2026-10-12T12:00:00.000Z");

    later(2 * 60_000);
    fake.storms["2026-10"] = [storm("2026-10-12T03:00Z", [["2026-10-12T06:00Z", 6]])];
    expect((await donki()).fetches).toBe(2);
    expect(startDates()).toEqual(["GST 2026-10-01", "FLR 2026-10-01"]);
    expect(await stampedAt()).toBe("2026-10-12T15:01:00.000Z");
    expect((await log())!.kp).toEqual([[Date.parse("2026-10-12T03:00Z") / 1000, Date.parse("2026-10-12T06:00Z") / 1000, 6]]);
  });

  it("keeps reading last month until it's been read a week after it ended", async () => {
    setNow("2026-10-07T12:00:00Z");
    await donki();
    later(3 * HOUR + 60_000);
    asked = [];
    expect((await donki()).fetches).toBe(4);
    expect(startDates().sort()).toEqual(["FLR 2026-09-01", "FLR 2026-10-01", "GST 2026-09-01", "GST 2026-10-01"]);
    // Oct 8: September was last read on Oct 7, so it's read once more...
    setNow("2026-10-08T12:00:00Z");
    expect((await donki()).fetches).toBe(4);
    // ...and then it's final.
    later(3 * HOUR + 60_000);
    asked = [];
    expect((await donki()).fetches).toBe(2);
    expect(startDates()).toEqual(["GST 2026-10-01", "FLR 2026-10-01"]);
  });

  it("reads a month again when its first week was missed, and holds the stamp back until it does", async () => {
    setNow("2026-09-25T12:00:00Z");
    await donki();
    // No pass from Sept 25 to Oct 10, and a storm logged for Sept 28 meanwhile.
    fake.storms["2026-09"] = [storm("2026-09-28T03:00Z", [["2026-09-28T06:00Z", 7]])];
    fake.status = (u) => (u.includes("GST?startDate=2026-09-01") ? 503 : null);
    setNow("2026-10-10T12:00:00Z");
    await donki();
    // September's storms weren't read again: the log is whole only to Sept 25.
    expect(await stampedAt()).toBe("2026-09-25T12:00:00.000Z");
    expect((await log())!.coveredUntil).toBe(Date.parse("2026-09-22T00:00:00Z") / 1000);

    fake.status = () => null;
    later(5 * 60_000);
    await donki();
    expect(await stampedAt()).toBe("2026-10-10T12:00:00.000Z");
    expect((await log())!.kp).toEqual([[Date.parse("2026-09-28T03:00Z") / 1000, Date.parse("2026-09-28T06:00Z") / 1000, 7]]);
  });

  it("skips a month that fails, fills the rest, and asks for it again next pass", async () => {
    fake.status = (u) => (u.includes("/GST?startDate=2015-06-01") ? 500 : null);
    const first = await donki();
    expect(first.failed).toEqual(["donki-gst 2015-06: 500 from ccmc.gsfc.nasa.gov/DONKI-API/get/GST"]);
    expect(first.done).toBe(false);
    // The failed month is still to fetch; a failure never counts down.
    expect(first.left).toEqual({ "donki-gst": 1, "donki-flr": 0 });
    const gst = await storedMonths("donki-gst");
    expect([gst.has("2015-05"), gst.has("2015-06"), gst.has("2015-07")]).toEqual([true, false, true]);
    // Stamped, but not a log: a hole would read as quiet.
    expect(await stampedAt()).toBe("2026-10-12T12:00:00.000Z");
    expect(await log()).toBeNull();

    fake.status = () => null;
    later(60_000);
    asked = [];
    const second = await donki();
    expect(startDates()).toEqual(["GST 2015-06-01"]);
    expect(second.done).toBe(true);
    expect(second.left).toEqual({ "donki-gst": 0, "donki-flr": 0 });
    expect(await log()).not.toBeNull();
  });

  it("ends a source's turn after three failures in a row, or at a rate limit", async () => {
    fake.status = (u) => (/GST\?startDate=2015-0[678]-01/.test(u) ? 500 : null);
    await donki();
    const gst = await storedMonths("donki-gst");
    expect([gst.has("2015-05"), gst.has("2015-09")]).toEqual([true, false]);
    expect((await storedMonths("donki-flr")).size).toBe(199);

    // A 429 ends DONKI for the pass: the allowance it guards is shared.
    blobs = new MemoryBlobStore();
    setBlobStore(blobs);
    later(5 * 60_000);
    fake.status = (u) => (u.includes("GST?startDate=2012-01-01") ? 429 : null);
    const limited = await donki();
    expect(limited.failed).toEqual([
      "donki-gst 2012-01: 429 from ccmc.gsfc.nasa.gov/DONKI-API/get/GST",
      "donki-flr 2026-10: DONKI's rate limit: waiting for it to refill",
    ]);
    expect((await storedMonths("donki-gst")).has("2012-02")).toBe(false);
    expect((await storedMonths("donki-flr")).size).toBe(0);
  });

  it("stops when its budget runs out, and the next pass carries on without fetching a month twice", async () => {
    fake.msPerFetch = 1_000;
    const passes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const s = await runSpaceWork({ budgetMs: 10_000, only: [...DONKI] });
      passes.push(s.fetches);
      if (s.done) break;
    }
    expect(Math.max(...passes)).toBe(10);
    expect(passes.reduce((a, b) => a + b, 0)).toBe(398);
    expect(new Set(asked).size).toBe(398);
    // Stamped by the older of the two months' reads: GST read this month
    // first, in the first pass, and FLR in a later one.
    expect(await stampedAt()).toBe("2026-10-12T12:00:01.000Z");
    expect(await log()).not.toBeNull();
  });

  it("adds storms' starts to a log written before it kept them, from storage", async () => {
    fake.storms["2017-09"] = [storm("2017-09-07T21:00Z", [["2017-09-08T00:00Z", 8.33]])];
    await donki();
    const old = (await readCompact())!;
    // A log as step 4 wrote it, without starts.
    await writeCompact({ ...old, starts: undefined } as unknown as typeof old);
    later(HOUR);
    asked = [];
    expect((await donki()).fetches).toBe(0);
    expect((await log())!.stormStarts).toEqual([Date.parse("2017-09-07T21:00Z") / 1000]);
  });

  it("rebuilds a lost log from the stored months without fetching them", async () => {
    fake.storms["2017-09"] = [storm("2017-09-07T21:00Z", [["2017-09-08T00:00Z", 8.33]])];
    await donki();
    const before = (await log())!;
    await blobs.del(COMPACT_KEY);
    later(HOUR);
    asked = [];
    expect((await donki()).fetches).toBe(0);
    const after = (await log())!;
    expect(after.kp).toEqual(before.kp);
    expect(after.stamp).toBe(before.stamp);
  });

  it("patches in a month the log holds older than storage: two passes wrote over each other", async () => {
    setNow("2026-10-03T12:00:00Z");
    await donki();
    const older = await blobs.get(COMPACT_KEY);
    later(3 * HOUR + 60_000);
    fake.storms["2026-09"] = [storm("2026-09-30T18:00Z", [["2026-09-30T21:00Z", 6.33]])];
    await donki();
    // The other pass's log, read before this one's refresh, lands last.
    await blobs.put(COMPACT_KEY, older!);
    expect((await log())!.kp).toEqual([]);
    later(60_000);
    asked = [];
    expect((await donki()).fetches).toBe(0);
    expect((await log())!.kp).toEqual([[Date.parse("2026-09-30T18:00Z") / 1000, Date.parse("2026-09-30T21:00Z") / 1000, 6.33]]);
    expect(await stampedAt()).toBe("2026-10-03T15:01:00.000Z");
  });
});

describe("a pass", () => {
  it("runs one at a time, and not again within the gap it's given", async () => {
    const first = donki();
    expect((await donki()).skipped).toBe(true);
    expect((await first).skipped).toBe(false);
    expect((await runSpaceWork({ budgetMs: 1, only: ["apod"], minGapMs: 300_000 })).skipped).toBe(true);
    later(300_001);
    expect((await runSpaceWork({ budgetMs: 1, only: ["apod"], minGapMs: 300_000 })).skipped).toBe(false);
    later(299_000);
    expect((await runSpaceWork({ budgetMs: 1, only: ["apod"], minGapMs: 300_000 })).skipped).toBe(true);
    // The cron passes no gap, so it always runs.
    expect((await runSpaceWork({ budgetMs: 1, only: ["apod"] })).skipped).toBe(false);
  });

  it("waits for a running pass when asked to, rather than skip", async () => {
    const first = donki();
    const cron = runSpaceWork({ budgetMs: 60_000, only: ["jpl-fireball"], wait: true });
    expect((await first).skipped).toBe(false);
    const waited = await cron;
    expect(waited.skipped).toBe(false);
    expect(waited.fetches).toBe(26); // this month, then 2002 to 2026 a year at a time
  });

  it("fails a pass whose store is down without an unhandled rejection", async () => {
    setBlobStore({
      get: async () => {
        throw new Error("store down");
      },
      put: async () => {
        throw new Error("store down");
      },
      del: async () => {},
      has: async () => false,
      list: async () => [],
    } as unknown as Parameters<typeof setBlobStore>[0]);
    const unhandled: unknown[] = [];
    const seen = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", seen);
    try {
      await expect(runSpaceWork({ budgetMs: 1_000 })).rejects.toThrow("store down");
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", seen);
    }
    expect(unhandled).toEqual([]);
  });

  it("spends a short budget on DONKI before anything else", async () => {
    fake.msPerFetch = 1_000;
    fake.apod = ["2026-10-12"];
    fake.epicDates = ["2026-10-10"];
    await runSpaceWork({ budgetMs: 5_000 });
    expect(asked).toHaveLength(5);
    expect(asked.every((u) => u.includes("ccmc.gsfc.nasa.gov"))).toBe(true);
  });
});

describe("the daily sources and the backfill", () => {
  const days = (from: string, to: string) => {
    const out: string[] = [];
    for (let t = Date.parse(to); t >= Date.parse(from); t -= 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const apod = () => runSpaceWork({ budgetMs: 20_000, only: ["apod"] });

  it("reads APOD's newest page daily and its archive a page at a time back to 2002, resuming where it stopped", async () => {
    fake.apod = days("2001-11-01", "2026-10-11");
    fake.msPerFetch = 1_000;
    const first = await apod();
    expect(first.fetches).toBe(20);
    expect(first.done).toBe(false);
    // About 363 pages of 25 days back to 2002 (an estimate); 19 read, the next is page 20.
    expect(first.left.apod).toBe(363 - 20 + 1);
    // A new day arrives at the top between passes, moving every page down
    // one: the backfill reads a day twice, never skips one.
    fake.apod.unshift("2026-10-12");
    let last = first;
    for (let i = 0; i < 100; i++) if ((last = await apod()).done) break;
    expect(last.left.apod).toBe(0);

    const months = await storedMonths("apod");
    expect([...months.keys()].sort()[0]).toBe("2002-01");
    expect(months.size).toBe(monthsBetween("2002-01", "2026-10").length);
    const stored = (await Promise.all([...months.keys()].map((m) => readMonth("apod", m)))).flatMap((f) => f!.records);
    expect(stored.map((r) => r.date).sort()).toEqual(days("2002-01-01", "2026-10-11").reverse());
    expect((await readMonth("apod", "2024-02"))!.records[0]).toEqual({
      date: "2024-02-01",
      title: "Picture of 2024-02-01",
      credit: "Someone",
      mediaType: "image",
      link: "https://science.nasa.gov/apod/2024-02-01/",
    });

    // Done: within the day it asks for nothing; 21 hours on (a daily cron can
    // fire anywhere in its hour), the newest page.
    asked = [];
    fake.msPerFetch = 0;
    later(19 * HOUR);
    expect((await apod()).fetches).toBe(0);
    later(2 * HOUR);
    await apod();
    expect(asked).toEqual(["https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=25&page=1"]);
    expect((await readMonth("apod", "2026-10"))!.records.map((r) => r.date).at(-1)).toBe("2026-10-12");
  });

  it("reads close approaches and fireballs a year per call, last days included, empty months too", async () => {
    fake.approaches = [
      { des: "2024 MK", cd: "2024-06-29T13:49", dist: "0.00197", h: "21.6" },
      { des: "2002 YE", cd: "2002-12-31T20:00", dist: "0.04", h: "25" },
      { des: "2026 TA", cd: "2026-10-12T08:00", dist: "0.01", h: null },
    ];
    fake.fireballs = [{ date: "2013-02-15 03:20:33", kt: "440" }];
    const s = await runSpaceWork({ budgetMs: 60_000, only: ["jpl-cad", "jpl-fireball"] });
    // 25 years, plus this month as the daily read, for each.
    expect(s.fetches).toBe(52);
    expect((await storedMonths("jpl-cad")).size).toBe(monthsBetween("2002-01", "2026-10").length);
    expect((await readMonth("jpl-cad", "2024-06"))!.records).toEqual([
      { name: "2024 MK", time: "2024-06-29T13:49:00Z", au: 0.00197, h: 21.6 },
    ]);
    // A year's last day, and today, are read too.
    expect((await readMonth("jpl-cad", "2002-12"))!.records.map((a) => a.name)).toEqual(["2002 YE"]);
    expect((await readMonth("jpl-cad", "2026-10"))!.records.map((a) => a.name)).toEqual(["2026 TA"]);
    expect((await readMonth("jpl-cad", "2003-05"))!.records).toEqual([]);
    expect((await readMonth("jpl-fireball", "2013-02"))!.records).toEqual([{ time: "2013-02-15T03:20:33Z", kt: 440 }]);
    asked = [];
    later(21 * HOUR);
    expect((await runSpaceWork({ budgetMs: 60_000, only: ["jpl-cad", "jpl-fireball"] })).fetches).toBe(2);
  });

  it("counts a JPL year that fails as still to fetch, with this month's daily read", async () => {
    fake.status = (u) => (u.includes("cad.api") && u.includes("date-min=2010-01-01") ? 500 : null);
    const s = await runSpaceWork({ budgetMs: 60_000, only: ["jpl-cad", "jpl-fireball"] });
    expect(s.left).toEqual({ "jpl-cad": 1, "jpl-fireball": 0 });
    fake.status = () => null;
    expect((await runSpaceWork({ budgetMs: 60_000, only: ["jpl-cad"] })).left).toEqual({ "jpl-cad": 0 });
  });

  it("reads last month's fireballs again after it ends, so a late one isn't lost", async () => {
    const jpl = () => runSpaceWork({ budgetMs: 60_000, only: ["jpl-fireball"] });
    setNow("2026-10-31T09:30:00Z");
    await jpl();
    fake.fireballs = [{ date: "2026-10-31 20:00:00", kt: "0.1" }];
    setNow("2026-11-01T09:30:00Z");
    asked = [];
    await jpl();
    expect((await readMonth("jpl-fireball", "2026-10"))!.records).toEqual([{ time: "2026-10-31T20:00:00Z", kt: 0.1 }]);
    expect(asked.map((u) => new URL(u).searchParams.get("date-min")).sort()).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("finds the Sun at each storm reading and X flare once, a day's folder read once, from SDO's start", async () => {
    await writeCompact(
      synthCompact("2026-10-12T12:00:00Z", {
        kp: [
          ["2015-12-31T12:00:00Z", 7], // before SDO's browse archive: never asked
          ["2017-03-09T12:00:00Z", 7], // SDO has no folder that day
          ["2024-05-10T18:00:00Z", 8.33],
          ["2024-05-10T21:00:00Z", 9],
          ["2024-05-11T03:00:00Z", 8.67],
        ],
        xflares: [["2024-05-14T16:51:00Z", "X8.7"]],
      }),
    );
    // A month stored before moments: its record has no moment, and goes.
    await writeMonth({ source: "sdo", month: "2024-05", firstDate: "2016-01-01", refreshedAt: NOW, records: [{ date: "2024-05-10", time: "2024-05-10T19:00:00Z", url: "old" } as never] });
    fake.sdo["2024-05-10"] = ["20240510_160000_1024_0171.jpg", "20240510_190000_1024_0171.jpg", "20240510_200000_1024_0171.jpg"];
    fake.sdo["2024-05-14"] = ["20240514_165000_1024_0171.jpg"];
    fake.status = (u) => (u.includes("/browse/2017/03/09/") ? 404 : null);
    const s = await runSpaceWork({ budgetMs: 60_000, only: ["sdo"] });
    // Four days, five moments: May 10's two share one read of its folder.
    expect(s.fetches).toBe(4);
    expect(s.left.sdo).toBe(0);
    expect(asked.some((u) => u.includes("/browse/2015/"))).toBe(false);
    expect(s.failed).toEqual([]);
    const url = (stamp: string) => `https://sdo.gsfc.nasa.gov/assets/img/browse/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}/${stamp}_1024_0171.jpg`;
    expect((await readMonth("sdo", "2024-05"))!.records).toEqual([
      { date: "2024-05-10", at: "2024-05-10T16:30:00.000Z", time: "2024-05-10T16:00:00Z", url: url("20240510_160000") },
      { date: "2024-05-10", at: "2024-05-10T19:30:00.000Z", time: "2024-05-10T19:00:00Z", url: url("20240510_190000") },
      // No image that day: kept as none, so it isn't asked again.
      { date: "2024-05-11", at: "2024-05-11T01:30:00.000Z", time: "2024-05-11T01:30:00.000Z", url: null },
      { date: "2024-05-14", at: "2024-05-14T16:51:00.000Z", time: "2024-05-14T16:50:00Z", url: url("20240514_165000") },
    ]);
    expect((await readMonth("sdo", "2017-03"))!.records).toEqual([
      { date: "2017-03-09", at: "2017-03-09T10:30:00.000Z", time: "2017-03-09T10:30:00.000Z", url: null },
    ]);
    expect(await readMonth("sdo", "2015-12")).toBeNull();

    const reads = vi.spyOn(blobs, "get");
    expect((await runSpaceWork({ budgetMs: 60_000, only: ["sdo"] })).fetches).toBe(0);
    expect(reads.mock.calls.map(([key]) => key).filter((key) => key.startsWith("space/sdo/"))).toEqual([]);

    // A reading DONKI logs later, on a day already read: only its moment is asked for.
    await writeCompact(
      synthCompact("2026-10-12T12:00:00Z", {
        kp: [
          ["2017-03-09T12:00:00Z", 7],
          ["2024-05-10T18:00:00Z", 8.33],
          ["2024-05-10T21:00:00Z", 9],
          ["2024-05-10T24:00:00Z", 8],
          ["2024-05-11T03:00:00Z", 8.67],
        ],
        xflares: [["2024-05-14T16:51:00Z", "X8.7"]],
      }),
    );
    asked = [];
    const late = await runSpaceWork({ budgetMs: 60_000, only: ["sdo"] });
    expect(asked).toEqual(["https://sdo.gsfc.nasa.gov/assets/img/browse/2024/05/10/"]);
    expect(late.left.sdo).toBe(0);
    expect((await readMonth("sdo", "2024-05"))!.records.map((r) => r.at)).toContain("2024-05-10T22:30:00.000Z");
  });

  it("keeps going past a day that fails, and asks for it again next pass", async () => {
    await writeCompact(
      synthCompact("2026-10-12T12:00:00Z", {
        kp: [
          ["2024-05-10T21:00:00Z", 9],
          ["2024-06-10T21:00:00Z", 6],
        ],
      }),
    );
    fake.status = (u) => (u.includes("/browse/2024/06/10/") ? 503 : null);
    const first = await runSpaceWork({ budgetMs: 60_000, only: ["sdo"] });
    expect(first.failed).toEqual(["sdo 2024-06-10: 503 from sdo.gsfc.nasa.gov/assets/img/browse/2024/06/10/"]);
    expect((await readMonth("sdo", "2024-05"))!.records).toHaveLength(1);
    fake.status = () => null;
    asked = [];
    await runSpaceWork({ budgetMs: 60_000, only: ["sdo"] });
    expect(asked).toEqual(["https://sdo.gsfc.nasa.gov/assets/img/browse/2024/06/10/"]);
  });

  it("reads EPIC newest first, keeps a month as far as it got, and reads only the last few days again", async () => {
    const epic = () => runSpaceWork({ budgetMs: 60_000, only: ["epic"] });
    fake.epicDates = [...days("2015-06-13", "2015-06-20"), ...days("2026-09-28", "2026-09-30"), ...days("2026-10-01", "2026-10-10")].sort();
    fake.msPerFetch = 1_000;
    // Out of time partway through October: what it read is kept.
    const cut = await runSpaceWork({ budgetMs: 6_000, only: ["epic"] });
    expect(cut.done).toBe(false);
    expect((await readMonth("epic", "2026-10"))!.records.map((d) => d.date)).toEqual(days("2026-10-06", "2026-10-10").reverse());

    fake.msPerFetch = 0;
    asked = [];
    const full = await epic();
    expect(full.done).toBe(true);
    // The rest of October, then September and June 2015; the last three days again.
    expect(asked).toHaveLength(1 + 5 + 3 + 8 + 2);
    expect((await readMonth("epic", "2026-10"))!.records).toHaveLength(10);
    expect((await readMonth("epic", "2015-06"))!.records.map((d) => d.date)).toEqual(days("2015-06-13", "2015-06-20").reverse());
    expect((await readMonth("epic", "2026-10"))!.records[0]).toEqual({
      date: "2026-10-01",
      images: [{ name: "epic_1b_20261001003633", time: "2026-10-01T00:31:45Z", lat: 5, lon: 170 }],
    });

    // The next day: the new day, and the days within the last three again.
    fake.epicDates.push("2026-10-11");
    later(25 * HOUR);
    asked = [];
    await epic();
    expect(asked.map((u) => u.split("/api/natural/")[1]).sort()).toEqual(["available", "date/2026-10-10", "date/2026-10-11"]);
    expect((await readMonth("epic", "2026-10"))!.records).toHaveLength(11);
    // Within the same day, only the list of dates.
    later(HOUR);
    asked = [];
    await epic();
    expect(asked.map((u) => u.split("/api/natural/")[1])).toEqual(["available"]);
  });

  it("reads EPIC's most wanted days first: around storms, X flares, eclipses, close asteroids and the last year", async () => {
    await writeCompact(
      synthCompact("2026-10-12T12:00:00Z", { kp: [["2020-05-11T12:00:00Z", 7]], xflares: [["2017-09-06T12:02:00Z", "X9.3"]] }),
    );
    // A 140 m asteroid 0.39 lunar distances out on Jan 2, 2018, and one 2 out on Mar 10, 2018.
    const cad = (time: string, au: number) => ({ name: "x", time, au, h: 22 });
    await writeMonth({ source: "jpl-cad", month: "2018-01", firstDate: "1900-01-01", refreshedAt: NOW, records: [cad("2018-01-02T05:00:00Z", 0.001)] });
    await writeMonth({ source: "jpl-cad", month: "2018-03", firstDate: "1900-01-01", refreshedAt: NOW, records: [cad("2018-03-10T05:00:00Z", 0.0051)] });
    fake.epicDates = [
      ...days("2016-03-01", "2016-03-02"), // nothing: last
      "2017-09-06", // the X9.3 flare alone
      ...days("2018-01-01", "2018-01-02"), // the close asteroid
      "2018-03-10", // an asteroid 2 lunar distances out: not close enough
      ...days("2019-07-01", "2019-07-03"), // the total solar eclipse of Jul 2, 2019
      ...days("2020-05-10", "2020-05-12"), // the storm reading on May 11
      "2020-05-20", // nothing: last
      "2025-09-12", // 13 months back: last
      "2025-11-12", // 11 months back: the last year
      ...days("2026-09-28", "2026-09-29"),
    ].sort();
    fake.msPerFetch = 1_000;
    const cut = await runSpaceWork({ budgetMs: 4_000, only: ["epic"] });
    // 17 days to read, 12 of them wanted first; three read before the budget ran out.
    expect(cut.left).toEqual({ epic: 17 - 3, "epic-priority": 12 - 3 });
    fake.msPerFetch = 0;
    await runSpaceWork({ budgetMs: 60_000, only: ["epic"] });
    const order = asked.filter((u) => u.includes("/api/natural/date/")).map((u) => u.slice(-10));
    expect(order).toEqual([
      "2026-09-29",
      "2026-09-28",
      "2025-11-12",
      "2020-05-12",
      "2020-05-11",
      "2020-05-10",
      "2019-07-03",
      "2019-07-02",
      "2019-07-01",
      "2018-01-02",
      "2018-01-01",
      "2017-09-06",
      // Then the rest, newest first.
      "2025-09-12",
      "2020-05-20",
      "2018-03-10",
      "2016-03-02",
      "2016-03-01",
    ]);
  });

  it("puts every source's wanted part before any source's rest: APOD's last year, then EPIC's, then the rest of each", async () => {
    fake.apod = days("2024-01-01", "2026-10-11"); // 1,015 days: 41 pages
    fake.epicDates = ["2016-03-01", "2026-09-29"];
    await runSpaceWork({ budgetMs: 600_000, only: ["apod", "epic"] });
    const at = (needle: string) => asked.findIndex((u) => u.includes(needle));
    const page = (n: number) => at(`apod-basic?per_page=25&page=${n}`);
    // Page 15 reaches back past Oct 12, 2025: the last year, read first.
    expect(page(15)).toBeLessThan(at("date/2026-09-29"));
    expect(at("date/2026-09-29")).toBeLessThan(page(16));
    expect(page(41)).toBeLessThan(at("date/2016-03-01"));
  });

  it("lets one full pass run at a time across instances, by a lease in the bucket", async () => {
    fake.epicDates = ["2026-10-01"];
    // Another instance's pass holds the fill until a minute from now.
    await writeSpaceJson("space/fill-lease.json", { until: Date.now() + 60_000, by: "elsewhere" });
    const held = await runSpaceWork({ budgetMs: 60_000 });
    expect(held).toMatchObject({ skipped: true, fetches: 0, heldUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(asked).toEqual([]);
    // DONKI-only passes don't ask for it.
    resetSpaceWork();
    expect((await runSpaceWork({ budgetMs: 60_000, only: ["donki-gst"] })).skipped).toBe(false);
    // Once it lapses, a full pass takes it, and lets it go when done.
    later(61_000);
    resetSpaceWork();
    const ran = await runSpaceWork({ budgetMs: 60_000 });
    expect(ran.skipped).toBe(false);
    expect(JSON.parse((await blobs.get("space/fill-lease.json"))!.toString("utf8")).until).toBe(0);
  });

  it("keeps an SDO record from before moments until its own day is read again", async () => {
    await writeCompact(synthCompact("2026-10-12T12:00:00Z", { kp: [["2024-05-10T21:00:00Z", 9]], xflares: [["2024-05-14T16:51:00Z", "X8.7"]] }));
    const old = (date: string) => ({ date, time: `${date}T12:00:00Z`, url: `old ${date}` }) as never;
    await writeMonth({ source: "sdo", month: "2024-05", firstDate: "2016-01-01", refreshedAt: NOW, records: [old("2024-05-10"), old("2024-05-14")] });
    fake.sdo["2024-05-14"] = ["20240514_165000_1024_0171.jpg"];
    fake.msPerFetch = 1_000;
    // Out of time after May 14, the newest: May 10's old picture stays.
    await runSpaceWork({ budgetMs: 1_000, only: ["sdo"] });
    const urls = (await readMonth("sdo", "2024-05"))!.records.map((r) => r.url);
    expect(urls).toContain("old 2024-05-10");
    expect(urls).not.toContain("old 2024-05-14");
  });

  it("leaves a readable trail of full passes, and none of DONKI-only ones", async () => {
    fake.epicDates = days("2026-10-01", "2026-10-03");
    await runSpaceWork({ budgetMs: 60_000, only: ["donki-gst", "donki-flr"] });
    expect(await blobs.get(PROGRESS_KEY)).toBeNull();
    resetSpaceWork();
    const s = await runSpaceWork({ budgetMs: 600_000 });
    const progress = JSON.parse((await blobs.get(PROGRESS_KEY))!.toString("utf8"));
    expect(progress.updatedAt).toBe(new Date(Date.parse(NOW)).toISOString());
    expect(progress.passes).toEqual([{ at: progress.updatedAt, ms: s.ms, fetches: s.fetches, wrote: s.wrote.length, failed: s.failed.length, done: s.done }]);
    expect(progress.left.epic).toEqual({ count: 0, at: progress.updatedAt });
    expect(Object.keys(progress.left).sort()).toEqual(["apod", "donki-flr", "donki-gst", "epic", "epic-priority", "jpl-cad", "jpl-fireball", "sdo"]);
  });

  it("keeps the latest 30 passes, and the last count of a source a pass didn't reach", async () => {
    const before = {
      updatedAt: "2026-10-11T09:30:00.000Z",
      left: { epic: { count: 3800, at: "2026-10-11T09:30:00.000Z" } },
      passes: Array.from({ length: 30 }, (_, i) => ({ at: `2026-09-${String(30 - i).padStart(2, "0")}T09:30:00.000Z`, ms: 1, fetches: 1, wrote: 1, failed: 0, done: false })),
    };
    await writeSpaceJson(PROGRESS_KEY, before);
    // Out of time in DONKI: EPIC isn't reached.
    fake.msPerFetch = 1_000;
    await runSpaceWork({ budgetMs: 3_000 });
    const p = JSON.parse((await blobs.get(PROGRESS_KEY))!.toString("utf8"));
    expect(p.passes).toHaveLength(30);
    expect(p.passes[0].at).toBe(p.updatedAt);
    expect(p.passes[1]).toEqual(before.passes[0]);
    expect(p.left.epic).toEqual({ count: 3800, at: "2026-10-11T09:30:00.000Z" });
    expect(p.left["donki-gst"].at).toBe(p.updatedAt);
  });
});
