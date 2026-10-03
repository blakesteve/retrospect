import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { getBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { userKey } from "@/lib/store/userKeys";
import { getStore } from "@/lib/store/jsonStore";
import { writeTagStore } from "@/lib/genres";
import { synthHistory } from "@/lib/answers/synthHistory";
import { writeCompact } from "@/lib/space/compact";
import { synthCompact } from "@/lib/space/synthLog";
import { forgetFinalMonths, writeMonth } from "@/lib/space/store";
import { readListener, type SongEntry } from "./record";

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
    const { body } = await call(nightsRoute, "may", "tz=America/Chicago&from=2024-05&to=2024-06");
    expect(body.nights).toHaveLength(61);
    expect(body.nights[0].date).toBe("2024-05-01");
    const may10 = body.nights.find((n: { date: string }) => n.date === "2024-05-10");
    expect(may10.space).toMatchObject({ kp: 9, stormGrade: "G5", stormLine: "Kp 9: a G5 storm, the top of the scale" });
    expect(may10.conditions).toContain("storms");
    expect(may10.plays).toBeGreaterThanOrEqual(3);
    expect(may10.filters).toContain("storm");
    expect(may10.wild).toMatchObject({ rank: 3, title: "The strongest geomagnetic storm in about 20 years" });
    // What changed that night, and when the strong Moon began (8.7.2, finding 10).
    expect(may10.changes).toEqual([
      { time: at("2024-05-11T03:12:57Z"), body: "Moon", kind: "sign", text: "The Moon entered Cancer at 10:12 p.m. CDT." },
    ]);
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
      "storm", "xflare", "eclipse", "fullmoon", "newmoon", "firstplay", "wild", "venushome", "marshome", "moonstrong", "asteroid", "fireball",
    ]);
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
    expect(early.body.nights[0].date).toBe(new Date(plays[0].uts * 1000 - 4 * 3_600_000).toISOString().slice(0, 10));
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
