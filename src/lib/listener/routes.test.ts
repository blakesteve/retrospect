import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { getBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { userKey } from "@/lib/store/userKeys";
import { getStore } from "@/lib/store/jsonStore";
import { writeTagStore } from "@/lib/genres";
import { synthHistory } from "@/lib/answers/synthHistory";
import { COMPACT_KEY, writeCompact } from "@/lib/space/compact";
import { synthCompact } from "@/lib/space/synthLog";
import { forgetFinalMonths, writeMonth } from "@/lib/space/store";
import { readListener, type ListenerRecord, type SongEntry } from "./record";

/* The listener routes end to end: a made-up history (no real account), a
   NASA log with the May 2024 storm and the Oct 2024 X9.0 flare, and JPL's
   June 2024 with 2024 MK. `after()` runs its job at once and keeps it. */
const background: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (job: () => Promise<unknown>) => void background.push(job()) };
});
const { GET: songsRoute } = await import("@/app/api/user/[name]/songs/route");
const { GET: nightsRoute } = await import("@/app/api/user/[name]/nights/route");
const { GET: highlightsRoute } = await import("@/app/api/user/[name]/highlights/route");
const { GET: genresRoute } = await import("@/app/api/user/[name]/genres/route");
const { GET: dialRoute } = await import("@/app/api/user/[name]/dial/route");
const { GET: skyAtRoute } = await import("@/app/api/sky/at/route");
const { GET: skyNowRoute } = await import("@/app/api/sky/now/route");

const at = (iso: string) => Date.parse(iso) / 1000;
/* A made-up history, plus plays on the evenings the tests read (Chicago
   time), so every assertion about those nights holds without an "if". */
const plays = [
  ...synthHistory(8_000, 7, 2016),
  ...["2024-04-08T23:00:00Z", "2024-05-10T23:00:00Z", "2024-05-23T23:00:00Z", "2024-06-29T23:00:00Z"].flatMap((iso) =>
    [0, 1, 2].map((i) => ({ uts: Date.parse(iso) / 1000 + i * 240, artist: "Artist 3", track: `Evening ${iso.slice(5, 10)} ${i}` })),
  ),
].sort((a, b) => a.uts - b.uts);
const call = async (route: typeof songsRoute, name: string, query = "tz=America/Chicago") => {
  const res = await route(new Request(`http://x/api/user/${name}/x?${query}`), { params: Promise.resolve({ name }) });
  return { status: res.status, body: await res.json() };
};

/** Every artist tagged, odd ones "dream pop", even ones "shoegaze". */
const allTags = () => {
  const artists = [...new Set(plays.map((p) => p.artist.toLowerCase()))];
  return { artists: Object.fromEntries(artists.map((a, i) => [a, [i % 2 ? "dream pop" : "shoegaze"]])) };
};

async function seed(name: string, history = plays, tagged = true) {
  await getStore().appendScrobbles(name, history);
  if (tagged) await writeTagStore(name, allTags());
  await getStore().setSyncState({
    username: name,
    status: "ready",
    pagesDone: 1,
    totalPages: 1,
    totalScrobbles: history.length,
    newestUts: history[history.length - 1].uts,
    updatedAt: Date.now(),
  });
}

beforeEach(async () => {
  forgetFinalMonths();
  setBlobStore(new MemoryBlobStore());
  // No test here reaches the network: a NASA refresh or tag fetch that starts fails at once.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in tests");
    }),
  );
  await writeCompact(
    synthCompact(new Date(Date.now() - 3_600_000).toISOString(), {
      kp: [
        ["2024-05-10T21:00:00Z", 8.33],
        ["2024-05-11T00:00:00Z", 9],
        ["2024-05-11T03:00:00Z", 9],
      ],
      xflares: [["2024-10-03T12:18:00Z", "X9.0"]],
    }),
  );
  await writeMonth({
    source: "jpl-cad",
    month: "2024-06",
    firstDate: "1900-01-01",
    refreshedAt: "2026-10-01T00:00:00.000Z",
    records: [{ name: "2024 MK", time: "2024-06-29T13:49:00Z", au: 0.00197, h: 22 }],
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(background.splice(0));
  vi.unstubAllGlobals();
  setBlobStore(null);
});

describe("the songs route (spec 7.4, 7.5)", () => {
  it("serves the row and the listed songs, and stores the record", async () => {
    await seed("songs");
    const { status, body } = await call(songsRoute, "songs");
    expect(status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.row.length).toBeGreaterThan(1);
    expect(body.row.length).toBeLessThanOrEqual(13);
    expect(body.listed.length).toBeLessThanOrEqual(50);
    expect(body.row.at(-1).firstScrobble).toBe(true);
    for (const s of body.listed) {
      expect(s.songId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(s.plays).toBeGreaterThanOrEqual(5);
      expect(s.firstNight).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.firstPlayTime).toMatch(/^\d{1,2}:\d{2} (a|p)\.m\. C[DS]T$/);
      // The Moon at the first-play minute (8.9), to 0.01°.
      expect(s.moonPhase).toBeGreaterThanOrEqual(0);
      expect(s.moonPhase).toBeLessThan(360);
      expect(Math.round(s.moonPhase * 100) / 100).toBe(s.moonPhase);
    }
    expect(new Set(body.listed.map((s: { moonPhase: number }) => s.moonPhase)).size).toBeGreaterThan(5);
    expect(await readListener("songs", "America/Chicago")).not.toBeNull();
  });

  it("gives a version 2 record's songs their Moon while it's rebuilt", async () => {
    await seed("v2");
    await call(songsRoute, "v2");
    const stored = (await readListener("v2", "America/Chicago"))!;
    const strip = (x: SongEntry) => {
      const rest: Partial<SongEntry> = { ...x };
      delete rest.moonPhase;
      return rest;
    };
    const old = { ...stored, version: 2, songs: { ...stored.songs, row: stored.songs.row.map(strip), listed: stored.songs.listed.map(strip) } };
    await getBlobStore().put(userKey("listener", "v2"), gzipSync(Buffer.from(JSON.stringify({ records: [old] }))));
    const { body } = await call(songsRoute, "v2");
    expect(body.status).toBe("updating");
    expect(body.row.map((x: { moonPhase: number }) => x.moonPhase)).toEqual(stored.songs.row.map((x) => x.moonPhase));
  });

  it("serves a current record without recomputing, and an old one as updating", async () => {
    await seed("fresh");
    await call(songsRoute, "fresh");
    expect((await call(songsRoute, "fresh")).body.status).toBe("ready");
    expect(background).toHaveLength(0);
    await getStore().appendScrobbles("fresh", [{ uts: plays.at(-1)!.uts + 600, artist: "Artist 1", track: "new" }]);
    expect((await call(songsRoute, "fresh")).body.status).toBe("updating");
    expect(background).toHaveLength(1);
  });
});

describe("the nights route (spec 7.4, 8.5)", () => {
  it("refuses months it can't read, or more than a year", async () => {
    await seed("bad");
    for (const q of ["from=2024-5&to=2024-06", "from=2024-06&to=2024-05", "from=2023-01&to=2024-01", "to=2024-01"]) {
      expect((await call(nightsRoute, "bad", `tz=UTC&${q}`)).status).toBe(400);
    }
  });

  it("gives every night of the months asked for, with the storm, the Moon and the filters", async () => {
    await seed("may");
    const { body } = await call(nightsRoute, "may", "tz=America/Chicago&from=2024-05&to=2024-06&counts=1");
    expect(body.nights).toHaveLength(61);
    expect(body.nights[0].date).toBe("2024-05-01");
    const may10 = body.nights.find((n: { date: string }) => n.date === "2024-05-10");
    expect(may10.space).toMatchObject({ kp: 9, stormGrade: "G5", stormLine: "Kp 9: a G5 storm, the top of the scale" });
    expect(may10.conditions).toContain("storms");
    expect(may10.plays).toBeGreaterThanOrEqual(3);
    expect(may10.filters).toContain("storm");
    expect(may10.wild).toMatchObject({ rank: 3, title: "The strongest geomagnetic storm in about 20 years" });
    // What changed that night, and when the strong Moon began (8.7.2, finding 10).
    expect(may10.changes).toEqual([{ time: at("2024-05-11T03:12:57Z"), body: "Moon", kind: "sign", text: "The Moon entered Cancer at 10:12 p.m. CDT." }]);
    expect(may10.conditions).toContain("moonstrong");
    expect(may10.conditionNotes).toEqual({ moonstrong: "from 10:12 p.m. CDT" });
    // A night the Moon is in Cancer throughout says nothing about her.
    const may11 = body.nights.find((n: { date: string }) => n.date === "2024-05-11");
    expect(may11.conditions).toContain("moonstrong");
    expect(may11.conditionNotes).toEqual({});
    // The full moon of May 23, 2024 peaked at 13:53 UTC: May 23's night in Chicago.
    const may23 = body.nights.find((n: { date: string }) => n.date === "2024-05-23");
    expect(may23.moon.sign).toBe("Sagittarius");
    expect(may23.filters).toContain("fullmoon");
    // 2024 MK, closer than the Moon, with its line in the listener's zone.
    const jun29 = body.nights.find((n: { date: string }) => n.date === "2024-06-29");
    expect(jun29.space.asteroid.line).toBe("2024 MK, 0.8 lunar distances, about 140 m wide, closest at 8:49 a.m. CDT");
    // A quiet night with NASA's log covering it: "no storm", not unknown.
    const quiet = body.nights.find((n: { date: string }) => n.date === "2024-05-02");
    expect(quiet.space.stormLine).toBe("No storm in NASA's log that night");
    // A night lights a genre with 3 plays or more of it; the counts agree.
    const lit = body.nights.flatMap((n: { genreFilters: string[] }) => n.genreFilters);
    expect(lit.length).toBeGreaterThan(0);
    for (const g of lit) expect(Object.keys(body.genreCounts)).toContain(g);
    // A night with no plays lights no filter, whatever the sky did (8.5).
    const silent = body.nights.filter((n: { plays: number }) => n.plays === 0);
    expect(silent.length).toBeGreaterThan(0);
    for (const n of silent) expect(n.filters).toEqual([]);
    expect(Object.keys(body.filterCounts)).toEqual([
      "storm",
      "xflare",
      "eclipse",
      "fullmoon",
      "newmoon",
      "firstplay",
      "wild",
      "venushome",
      "marshome",
      "moonstrong",
      "asteroid",
      "fireball",
    ]);
    // Each filter's lit nights per month, over the whole history (8.5): the
    // log's only storm covers 1 to 10 p.m. CDT on May 10, one night.
    expect(Object.keys(body.filterMonths)).toEqual(Object.keys(body.filterCounts));
    expect(body.filterMonths.storm).toEqual({ "2024-05": 1 });
    expect(body.filterCounts.storm).toBe(1);
    // A genre's months add up to its count, and the months asked for agree with their nights.
    expect(Object.keys(body.genreMonths).sort()).toEqual(["dream pop", "shoegaze"]);
    for (const [g, months] of Object.entries(body.genreMonths as Record<string, Record<string, number>>)) {
      expect(
        Object.values(months).reduce((a, b) => a + b, 0),
        g,
      ).toBe(body.genreCounts[g]);
      for (const m of ["2024-05", "2024-06"]) {
        const lit = body.nights.filter((n: { date: string; genreFilters: string[] }) => n.date.startsWith(m) && n.genreFilters.includes(g)).length;
        expect(months[m] ?? 0, `${g} ${m}`).toBe(lit);
      }
    }
    expect(body.nasa).toBe("ok");
  });

  it("sends the whole history's counts only when asked (counts=1), never with every year (8.5)", async () => {
    await seed("once");
    const COUNTS = ["filterCounts", "filterMonths", "genreCounts", "genreMonths"];
    const year = (await call(nightsRoute, "once", "tz=America/Chicago&from=2024-01&to=2024-12")).body;
    // A year without them: its nights, its first night and NASA's state.
    expect(year.nights.length).toBeGreaterThan(100);
    expect(year).toMatchObject({ first: expect.any(String), nasa: "ok" });
    for (const k of COUNTS) expect(year, k).not.toHaveProperty(k);
    // The same year asked with them: the same nights, and the four counts.
    const first = (await call(nightsRoute, "once", "tz=America/Chicago&from=2024-01&to=2024-12&counts=1")).body;
    expect(first.nights).toEqual(year.nights);
    for (const k of COUNTS) expect(first[k], k).toEqual(expect.any(Object));
    expect(first.filterCounts.storm).toBe(1);
    for (const q of ["counts=0", "counts=true", "counts="]) {
      expect(await call(nightsRoute, "once", `tz=America/Chicago&from=2024-05&to=2024-05&${q}`), q).toEqual({
        status: 400,
        body: { error: "counts must be 1, or left out" },
      });
    }
  });

  it("says whether the zone saw each wild night's eclipse, which ranks it (7.5)", async () => {
    await seed("seen");
    // Dec 4, 2021, 07:33 UT, over Antarctica: 1:33 a.m. CST, Dec 3's night, not seen from Chicago.
    const dec = (await call(nightsRoute, "seen", "tz=America/Chicago&from=2021-12&to=2021-12")).body;
    expect(dec.nights.find((n: { date: string }) => n.date === "2021-12-03").wild).toEqual({
      rank: 0,
      visible: false,
      title: "A total solar eclipse",
      story: null,
    });
    const apr = (await call(nightsRoute, "seen", "tz=America/Chicago&from=2024-04&to=2024-04")).body;
    expect(apr.nights.find((n: { date: string }) => n.date === "2024-04-08").wild).toMatchObject({
      rank: 0,
      visible: true,
      title: "A total solar eclipse across North America",
    });
  });

  it("says tonight, not that night, for tonight's quiet night (8.7.2)", async () => {
    await seed("tonight");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-05-03T01:00:00Z")); // 8 p.m. on May 2, Central
    const { body } = await call(nightsRoute, "tonight", "tz=America/Chicago&from=2024-05&to=2024-05");
    expect(body.nights.at(-1).date).toBe("2024-05-02");
    expect(body.nights.at(-1).space.stormLine).toBe("No storm in NASA's log tonight");
    expect(body.nights.find((n: { date: string }) => n.date === "2024-05-01").space.stormLine).toBe("No storm in NASA's log that night");
  });

  it("says when NASA's log didn't read, so the page can hide its filters (8.5)", async () => {
    await getBlobStore().del(COMPACT_KEY);
    await seed("nonasa");
    const { status, body } = await call(nightsRoute, "nonasa", "tz=America/Chicago&from=2024-05&to=2024-05&counts=1");
    expect(status).toBe(200);
    expect(body.nasa).toBe("unavailable");
    expect(body.filterCounts.storm).toBe(0);
    expect(body.nights.find((n: { date: string }) => n.date === "2024-05-10").space.kp).toBeNull();
  });

  it("counts the nights one sky filter and one genre light together, over the whole history (8.5, 7.6)", async () => {
    await seed("pair");
    const may = (await call(nightsRoute, "pair", "tz=America/Chicago&from=2024-05&to=2024-05&counts=1")).body;
    const may10 = may.nights.find((n: { date: string }) => n.date === "2024-05-10");
    // Artist 3's three evening plays light Artist 3's genre that night.
    expect(may10.genreFilters.length).toBeGreaterThan(0);
    const pair = async (filter: string, genre: string) => call(nightsRoute, "pair", `tz=America/Chicago&filter=${filter}&genre=${encodeURIComponent(genre)}`);
    for (const genre of ["dream pop", "shoegaze"]) {
      const { status, body } = await pair("storm", genre);
      expect(status).toBe(200);
      // The one storm night, May 10, when it held 3 plays of the genre.
      const lit = may10.genreFilters.includes(genre);
      expect(body).toEqual({
        status: "ready",
        zone: "America/Chicago",
        zoneFellBack: false,
        filter: "storm",
        genre,
        count: lit ? 1 : 0,
        months: lit ? { "2024-05": 1 } : {},
      });
    }
    // The full moons lit with a genre are among each's own, month by month.
    const both = (await pair("fullmoon", "shoegaze")).body;
    expect(both.count).toBeLessThanOrEqual(may.filterCounts.fullmoon);
    expect(Object.values(both.months as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(both.count);
    for (const [m, n] of Object.entries(both.months as Record<string, number>)) {
      expect(n).toBeLessThanOrEqual(Math.min(may.filterMonths.fullmoon[m], may.genreMonths.shoegaze[m]));
    }
    // One shape per request, a filter that exists, and a genre you have.
    for (const q of [
      "filter=storm&genre=shoegaze&from=2024-05&to=2024-05",
      "filter=storm&genre=shoegaze&from=2024-05",
      "filter=storm&genre=shoegaze&counts=1",
      "filter=storms&genre=shoegaze",
      "filter=storm&genre=polka",
      "filter=storm&genre=constructor",
      "filter=storm",
      "genre=shoegaze",
    ]) {
      expect((await call(nightsRoute, "pair", `tz=America/Chicago&${q}`)).status, q).toBe(400);
    }
  });

  it("serves a version 3 record while it's rebuilt: no months, no pairs, and its X flares counted", async () => {
    await seed("v3");
    await call(nightsRoute, "v3", "tz=America/Chicago&from=2024-05&to=2024-05");
    const fresh = (await readListener("v3", "America/Chicago"))!;
    const putOld = async () => {
      const old: Partial<ListenerRecord> = { ...fresh, version: 3, counts: { ...fresh.counts } };
      delete old.filterMonths;
      delete old.genreMonths;
      delete old.filterNights;
      delete old.counts!.xflares;
      await getBlobStore().put(userKey("listener", "v3"), gzipSync(Buffer.from(JSON.stringify({ records: [old] }))));
    };
    await putOld();
    const months = (await call(nightsRoute, "v3", "tz=America/Chicago&from=2024-05&to=2024-05&counts=1")).body;
    // Not known yet, which the page reads as such: {} would read as nothing lit.
    expect(months).toMatchObject({ status: "updating", filterMonths: null, genreMonths: null });
    await Promise.all(background.splice(0));
    await putOld();
    expect((await call(nightsRoute, "v3", "tz=America/Chicago&filter=storm&genre=shoegaze")).body).toEqual({
      status: "computing",
      zone: "America/Chicago",
      zoneFellBack: false,
    });
    await Promise.all(background.splice(0));
    await putOld();
    // The log's one X flare, Oct 3, 2024, inside the history.
    expect((await call(highlightsRoute, "v3")).body).toMatchObject({ status: "updating", counts: { xflares: 1 } });
  });
});

describe("the nights route at the edges", () => {
  it("stops at tonight and starts at the history's first night", async () => {
    await seed("edges");
    // Oct 20, 2026, 2 a.m. UTC: still Oct 19's night. The log is fresh then.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T02:00:00Z"));
    await writeCompact(synthCompact("2026-10-20T01:00:00Z"));
    const { body } = await call(nightsRoute, "edges", "tz=UTC&from=2026-10&to=2026-10");
    vi.useRealTimers();
    expect(body.nights).toHaveLength(19);
    expect(body.nights.at(-1).date).toBe("2026-10-19");
    const early = await call(nightsRoute, "edges", "tz=UTC&from=2015-06&to=2016-02");
    const firstNight = new Date(plays[0].uts * 1000 - 4 * 3_600_000).toISOString().slice(0, 10);
    expect(early.body.nights[0].date).toBe(firstNight);
    // Every request names the history's first night, months after it too.
    expect(early.body.first).toBe(firstNight);
    expect(body.first).toBe(firstNight);
  });
});

describe("the highlights route (spec 7.5, 8.3)", () => {
  it("gives the reveal's counts, the wild nights in order and their lines", async () => {
    await seed("reveal");
    const { body } = await call(highlightsRoute, "reveal");
    expect(body.length).toMatch(/years$/);
    // Every artist is "Artist N", so nothing is noise: every play counts.
    expect(plays.every((p) => /^Artist \d+$/.test(p.artist))).toBe(true);
    expect(body.counts.plays).toBe(plays.length);
    // The log's one X flare, Oct 3, 2024, and no storm starts: it keeps none.
    expect(body.counts).toMatchObject({ storms: 0, xflares: 1 });
    expect(body.wild.length).toBeLessThanOrEqual(10);
    /* 7.5's order, from Chicago (changed 2 Oct 2026): the total solar,
       annular and total lunar eclipses seen there, newest first in each;
       the G5 storm; then the eclipses not seen there. Aug 21, 2017 covered
       most of Chicago's Sun; Oct 14, 2023 about 43%. The lunar eclipses of
       Jan 20, 2019, May 15 and Nov 8, 2022 had the Moon up. Dec 14, 2020
       (South America), Dec 4, 2021 (Antarctica) and Apr 20, 2023 UT
       (Australia and Indonesia) were night or out of reach there. */
    expect(body.wild.map((w: { date: string; rank: number }) => [w.date, w.rank])).toEqual([
      ["2024-04-08", 0],
      ["2017-08-21", 0],
      ["2023-10-14", 1],
      ["2022-11-08", 2],
      ["2022-05-15", 2],
      ["2019-01-20", 2],
      ["2024-05-10", 3],
      ["2023-04-19", 0],
      ["2021-12-03", 0],
      ["2020-12-14", 0],
    ]);
    expect(body.wild[0].title).toBe("A total solar eclipse across North America");
    expect(body.wildest).toMatchObject({ date: "2024-04-08", dateLine: "Monday, Apr 8, 2024" });
    expect(body.wildest.line).toMatch(/^A total solar eclipse across North America\. You played \d+ songs that night \(a usual Monday is \d+\)/);
  });
});

describe("the genres route (spec 7.6)", () => {
  it("says it's building until every top artist is tagged, then lists facts, even over a record built before", async () => {
    await seed("genres", plays, false);
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    // fetch already fails (beforeEach): the tag fetch can't finish.
    // A record built while the tags are still being fetched: no genres in it.
    expect((await call(songsRoute, "genres")).body.status).toBe("ready");
    expect((await readListener("genres", "America/Chicago"))!.tagged).toBe(-1);
    const building = await call(genresRoute, "genres");
    expect(building.body).toMatchObject({ status: "building", done: 0 });
    // The tags finish: the next poll is ready, with genres, not the old record's none.
    await writeTagStore("genres", allTags());
    const ready = await call(genresRoute, "genres");
    expect(ready.body.status).toBe("ready");
    expect(ready.body.genres.map((g: { genre: string }) => g.genre).sort()).toEqual(["dream pop", "shoegaze"]);
    for (const g of ready.body.genres) {
      expect(g.topArtists.length).toBe(3);
      expect(g.peakNight.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.share).toBeGreaterThan(0);
    }
    vi.unstubAllEnvs();
  });

  it("keeps building while the record it would serve predates the tags", async () => {
    await seed("both", plays, false);
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    await call(songsRoute, "both"); // a record with no tags
    // The tags finish and the history grows at once: the old record is served
    // while it's rebuilt, and it has no genres to give.
    await writeTagStore("both", allTags());
    await getStore().appendScrobbles("both", [{ uts: plays.at(-1)!.uts + 600, artist: "Artist 1", track: "new" }]);
    expect((await call(genresRoute, "both")).body).toMatchObject({ status: "building", genres: [] });
    await Promise.all(background.splice(0));
    expect((await call(genresRoute, "both")).body.status).toBe("ready");
    vi.unstubAllEnvs();
  });

  it("fails, rather than building forever, with no Last.fm key", async () => {
    await seed("nokey", plays, false);
    vi.stubEnv("LASTFM_API_KEY", "");
    expect((await call(genresRoute, "nokey")).body).toMatchObject({ status: "failed", genres: [] });
    vi.unstubAllEnvs();
  });
});

describe("the sky routes (spec 7.2, 7.4)", () => {
  it("gives the sky at an instant, cached for good, within 2002 to 2035", async () => {
    const ok = await skyAtRoute(new Request(`http://x/api/sky/at?t=${at("2024-04-08T18:17:19Z")}`));
    expect(ok.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const sky = await ok.json();
    expect(sky.questionsHeld).toContain("newmoon");
    expect(sky.bodies.find((b: { body: string }) => b.body === "Sun").sign).toBe("Aries");
    for (const t of ["", "abc", "1.5", String(at("2001-12-31T00:00:00Z")), String(at("2036-01-01T00:00:00Z"))]) {
      expect((await skyAtRoute(new Request(`http://x/api/sky/at?t=${t}`))).status).toBe(400);
    }
  });

  it("doesn't count a storm reading from before tonight", async () => {
    // A reading ending 3 a.m. UTC belongs to last night; tonight began at 4 a.m.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
    await writeCompact(synthCompact("2026-10-20T15:00:00Z", { kp: [["2026-10-20T03:00:00Z", 8]] }));
    const body = await (await skyNowRoute(new Request("http://x/api/sky/now?tz=UTC"))).json();
    vi.useRealTimers();
    expect(body.questionsHeld).not.toContain("storms");
  });

  it("gives the sky now, what holds tonight so far, and at most 6 coming up", async () => {
    // 3 p.m. UTC: a reading ending 2:59 p.m. covers 11:59 a.m. on, tonight's.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
    await writeCompact(synthCompact("2026-10-20T15:00:00Z", { kp: [["2026-10-20T14:59:00Z", 6]] }));
    const body = await (await skyNowRoute(new Request("http://x/api/sky/now?tz=UTC"))).json();
    vi.useRealTimers();
    expect(body.nasa).toBe("ok");
    expect(body.comingUp.length).toBeLessThanOrEqual(6);
    for (const i of body.comingUp) expect(i.at).toMatch(/^\d{1,2}:\d{2} (a|p)\.m\. UTC$/);
    expect(body.questionsHeld).toContain("storms");
  });
});

/* The dial's own history, small enough to count by hand. In Chicago (CDT,
   UTC-5) the first night is Monday, Apr 1, 2024, and tonight is Oct 7, 2024
   (`DIAL_NOW`), so the dial has 190 nights: 30 in April, 31 in May, 30 in
   June, 31 in July, 31 in August, 30 in September and 7 in October. */
const DIAL_NIGHTS: [string, number][] = [
  ["2024-04-01T23:00:00Z", 2], // 6 p.m. Apr 1: offset 0
  ["2024-04-08T23:00:00Z", 3], // Apr 8, offset 7: the total solar eclipse peaked at 1:17 p.m. CDT
  ["2024-05-10T23:00:00Z", 4], // May 10, offset 39
  ["2024-05-12T02:00:00Z", 2], // 9 p.m. May 11, offset 40
  ["2024-05-12T07:30:00Z", 1], // 2:30 a.m. May 12: still May 11's night (7.1)
  ["2024-06-29T23:00:00Z", 1], // Jun 29, offset 89: 2024 MK came closest at 8:49 a.m. CDT
  ["2024-10-03T23:00:00Z", 1], // Oct 3, offset 185: the X9.0 flare peaked at 7:18 a.m. CDT
  ["2024-10-08T01:00:00Z", 1], // 8 p.m. Oct 7, offset 189: tonight, so far
];
const dialHistory = DIAL_NIGHTS.flatMap(([iso, n]) =>
  Array.from({ length: n }, (_, i) => ({ uts: at(iso) + i * 240, artist: `Artist ${i}`, track: `Dial ${iso} ${i}` })),
);
/** 10 p.m. CDT on Oct 7, 2024: tonight is Oct 7's night. */
const DIAL_NOW = "2024-10-08T03:00:00Z";
/** Each wild night, in night order (7.5): the eclipse, the storm's two
    nights (one card, May 10's, with the higher reading), 2024 MK and the
    X9.0 flare, under their curated titles but May 11's. */
const DIAL_WILD = [
  [7, 0, "A total solar eclipse across North America", true],
  [39, 3, "The strongest geomagnetic storm in about 20 years", true],
  [40, 4, "A G4 storm, Kp 8+", false],
  [89, 6, "A 150-meter asteroid, closer than the Moon", true],
  [185, 5, "The largest flare of this solar cycle in NASA's log, as of September 2026", true],
];

/** The dial's history with its own NASA log, at `DIAL_NOW`: the May 2024
    storm running past 4 a.m. into May 11's night, a storm on May 20 and X
    flares on May 14 and Oct 3, 2024 MK, and two made-up asteroids: one on
    Jun 15, closer than the Moon, and one on Apr 8, twice as far. Nobody
    listened on May 14, May 20 or Jun 15. */
async function seedDial(name: string, xflares: [string, string][] = []) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(DIAL_NOW));
  await writeCompact(
    synthCompact("2024-10-08T02:00:00Z", {
      kp: [
        ["2024-05-10T21:00:00Z", 8.33], // 1 to 4 p.m. CDT, May 10
        ["2024-05-11T00:00:00Z", 9],
        ["2024-05-11T03:00:00Z", 9],
        ["2024-05-11T06:00:00Z", 9],
        ["2024-05-11T09:00:00Z", 8.67], // 1 to 4 a.m. CDT: still May 10's night
        ["2024-05-11T12:00:00Z", 8.33], // 4 to 7 a.m. CDT: May 11's night, "Kp 8+"
        ["2024-05-20T23:00:00Z", 6], // 3 to 6 p.m. CDT, May 20
      ],
      xflares: [["2024-05-14T16:51:00Z", "X8.7"], ["2024-10-03T12:18:00Z", "X9.0"], ...xflares],
    }),
  );
  const approaches = (month: string, records: { name: string; time: string; au: number; h: number }[]) =>
    writeMonth({ source: "jpl-cad", month, firstDate: "1900-01-01", refreshedAt: "2024-10-01T00:00:00.000Z", records });
  await approaches("2024-04", [{ name: "2024 GA", time: "2024-04-08T20:00:00Z", au: 0.005, h: 26 }]);
  await approaches("2024-06", [
    { name: "2024 LZ", time: "2024-06-15T18:00:00Z", au: 0.0015, h: 27 },
    { name: "2024 MK", time: "2024-06-29T13:49:00Z", au: 0.00197, h: 22 },
  ]);
  await seed(name, dialHistory);
}

describe("the dial route (spec 8.6, 11)", () => {
  it("gives every night from the first to tonight with its plays, and the usual for each weekday", async () => {
    await seedDial("dial");
    const { status, body } = await call(dialRoute, "dial");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ready", zone: "America/Chicago", zoneFellBack: false, nasa: "ok", first: "2024-04-01", tonight: "2024-10-07" });
    // May 11's 2:30 a.m. play counts for May 11 (7.1); tonight's play so far is the last entry.
    const expected = Array(190).fill(0);
    for (const [i, n] of [[0, 2], [7, 3], [39, 4], [40, 3], [89, 1], [185, 1], [189, 1]]) expected[i] = n;
    expect(body.plays).toEqual(expected);
    // A usual Monday is the median of Apr 1, Apr 8 and Oct 7 (2, 3, 1); Saturdays May 11 and Jun 29 (3, 1) make 2.
    expect(body.usual).toEqual([null, 2, null, null, 1, 4, 2]);
    // The same first night as the nights route names.
    expect((await call(nightsRoute, "dial", "tz=America/Chicago&from=2024-10&to=2024-10")).body.first).toBe("2024-04-01");
  });

  it("ticks storms, X flares, eclipses and asteroids only on nights you listened (7.5, 8.5)", async () => {
    await seedDial("ticks");
    const { body } = await call(dialRoute, "ticks");
    expect(body.marks.storm).toEqual([[39, "Kp 9"], [40, "Kp 8+"]]);
    expect(body.marks.xflare).toEqual([[185, "X9.0"]]);
    expect(body.marks.eclipse).toEqual([[7, "total solar"]]);
    // Jun 29, 2024 MK's night, as an offset alone: nothing reads its name.
    expect(body.marks.asteroid).toEqual([89]);
    // Every tick on a night with plays: the asteroids are bare offsets, the rest [offset, ...].
    for (const [kind, marks] of Object.entries(body.marks as Record<string, (number | [number])[]>)) {
      for (const m of marks) {
        const i = typeof m === "number" ? m : m[0];
        expect(body.plays[i], `${kind} at ${i}`).toBeGreaterThan(0);
      }
    }
    /* The nights the sky did something and nobody listened, so each tick
       left out above was there to leave out: May 20's storm (offset 49),
       May 14's X8.7 (43), Jun 15's asteroid (75), Sept 17's partial lunar
       eclipse (169) and Oct 2's annular (184). */
    const quiet = { "2024-05-14": 43, "2024-05-20": 49, "2024-06-15": 75, "2024-09-17": 169, "2024-10-02": 184 };
    for (const i of Object.values(quiet)) expect(body.plays[i]).toBe(0);
    const months = (await call(nightsRoute, "ticks", "tz=America/Chicago&from=2024-04&to=2024-10")).body;
    const night = (date: string) => months.nights.find((n: { date: string }) => n.date === date);
    expect(night("2024-05-20")).toMatchObject({ plays: 0, space: { kpText: "Kp 6" } });
    expect(night("2024-05-14")).toMatchObject({ plays: 0, space: { biggestFlare: "X8.7", xFlare: true } });
    expect(night("2024-06-15")).toMatchObject({ plays: 0, space: { asteroid: { name: "2024 LZ" } } });
    expect(night("2024-09-17")).toMatchObject({ plays: 0, eclipse: { kind: "partial lunar" } });
    expect(night("2024-10-02")).toMatchObject({ plays: 0, eclipse: { kind: "annular solar" } });
    // A night you listened with an asteroid twice as far as the Moon: no asteroid tick.
    expect(night("2024-04-08")).toMatchObject({ plays: 3, space: { asteroid: { name: "2024 GA", ld: expect.closeTo(1.95, 2) } } });
  });

  it("marks every wild night, and one headline for a storm that runs past 4 a.m. (7.5)", async () => {
    await seedDial("wild");
    const { body } = await call(dialRoute, "wild");
    expect(body.marks.wild).toEqual(DIAL_WILD);
    expect(body.marks.wild.filter((w: unknown[]) => w[0] === 39 || w[0] === 40).map((w: unknown[]) => w[3])).toEqual([true, false]);
  });

  it("heads a storm run's other night by its next reason, as the Tonight row does (7.5)", async () => {
    // An X5.8 flare at 10 a.m. CDT on May 11: May 11's card is the flare, and May 10 keeps the storm's.
    await seedDial("then", [["2024-05-11T15:00:00Z", "X5.8"]]);
    const { body } = await call(dialRoute, "then");
    expect(body.marks.xflare).toEqual([[40, "X5.8"], [185, "X9.0"]]);
    expect(body.marks.wild).toEqual([DIAL_WILD[0], DIAL_WILD[1], [40, 5, "An X5.8 flare", true], DIAL_WILD[3], DIAL_WILD[4]]);
  });

  it("leaves NASA's ticks out when its log is unavailable, and keeps the eclipses and wild nights (8.5)", async () => {
    await seedDial("nonasa");
    const ok = (await call(dialRoute, "nonasa")).body;
    expect(ok.nasa).toBe("ok");
    expect(ok.marks.storm).toEqual([[39, "Kp 9"], [40, "Kp 8+"]]);
    expect(ok.marks.xflare).toEqual([[185, "X9.0"]]);
    expect(ok.marks.asteroid).toEqual([89]);
    await getBlobStore().del(COMPACT_KEY);
    // The record built with the log is served while it's rebuilt without it.
    const { status, body } = await call(dialRoute, "nonasa");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "updating", nasa: "unavailable", first: "2024-04-01", tonight: "2024-10-07" });
    expect(body.marks).toEqual({ storm: [], xflare: [], eclipse: [[7, "total solar"]], asteroid: [], wild: DIAL_WILD });
    expect(body.plays).toHaveLength(190);
  });

  it("gives a history that began tonight one night, with tonight's ticks (8.6)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-04-09T03:00:00Z")); // 10 p.m. CDT, Apr 8
    await seed("new", [{ uts: at("2024-04-08T23:00:00Z"), artist: "Artist 1", track: "Eclipse" }]);
    const { body } = await call(dialRoute, "new");
    expect(body).toMatchObject({ first: "2024-04-08", tonight: "2024-04-08", plays: [1] });
    expect(body.marks.eclipse).toEqual([[0, "total solar"]]);
    expect(body.marks.wild).toEqual([[0, 0, "A total solar eclipse across North America", true]]);
  });

  it("gives no first night and no plays when every play is noise", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(DIAL_NOW));
    const noise = [
      { uts: at("2024-05-10T23:00:00Z"), artist: "Rain Sounds", track: "Storm" },
      { uts: at("2024-05-11T03:00:00Z"), artist: "White Noise Baby Sleep", track: "Fan" },
    ];
    await seed("noise", noise);
    expect((await call(dialRoute, "noise")).body).toEqual({
      status: "ready",
      zone: "America/Chicago",
      zoneFellBack: false,
      nasa: "ok",
      first: null,
      tonight: "2024-10-07",
      plays: [],
      usual: [null, null, null, null, null, null, null],
      marks: { storm: [], xflare: [], eclipse: [], asteroid: [], wild: [] },
    });
    // One song among the noise: May 10 to Oct 7 is 151 nights (22 + 30 + 31 + 31 + 30 + 7), and the noise isn't counted.
    await seed("music", [...noise, { uts: at("2024-05-10T23:10:00Z"), artist: "Artist 1", track: "Song" }].sort((a, b) => a.uts - b.uts));
    const music = (await call(dialRoute, "music")).body;
    expect(music.first).toBe("2024-05-10");
    expect(music.plays).toHaveLength(151);
    expect(music.plays.slice(0, 2)).toEqual([1, 0]);
  });

  it("says computing while a history is first read, refuses a bad name, and reads a refused zone as UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(DIAL_NOW));
    await getStore().appendScrobbles("reading", dialHistory);
    await getStore().setSyncState({
      username: "reading",
      status: "syncing",
      pagesDone: 1,
      totalPages: 3,
      totalScrobbles: dialHistory.length,
      newestUts: dialHistory.at(-1)!.uts,
      updatedAt: Date.now(),
    });
    expect(await call(dialRoute, "reading")).toEqual({ status: 200, body: { status: "computing", zone: "America/Chicago", zoneFellBack: false } });
    expect(await call(dialRoute, "bad name!")).toEqual({ status: 400, body: { error: "Invalid username", code: "invalid-username" } });
    // Read in UTC, May 12's 2:30 a.m. CDT play is 7:30 a.m. UTC: May 12's night, offset 41.
    await seedDial("utc");
    const { status, body } = await call(dialRoute, "utc", "tz=Mars/Olympus_Mons");
    expect(status).toBe(200);
    expect(body).toMatchObject({ zone: "UTC", zoneFellBack: true, first: "2024-04-01", tonight: "2024-10-07" });
    expect(body.plays.slice(39, 42)).toEqual([4, 2, 1]);
  });

  it("accounts for every play of the made-up history, a night at a time", async () => {
    await seed("whole");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T02:00:00Z")); // 9 p.m. CDT, Oct 19
    await writeCompact(synthCompact("2026-10-20T01:00:00Z"));
    const { body } = await call(dialRoute, "whole");
    // The first play is in January 2016, on Central Standard Time (UTC-6), and a night starts at 4 a.m.
    const firstNight = new Date(plays[0].uts * 1000 - 10 * 3_600_000).toISOString().slice(0, 10);
    expect(body.first).toBe(firstNight);
    expect(body.tonight).toBe("2026-10-19");
    expect(body.plays).toHaveLength((Date.parse("2026-10-19") - Date.parse(firstNight)) / 86_400_000 + 1);
    expect(body.plays.reduce((a: number, b: number) => a + b, 0)).toBe(plays.length);
  });
});
