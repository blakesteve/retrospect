import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { synthHistory } from "@/lib/answers/synthHistory";
import { writeCompact } from "@/lib/space/compact";
import { synthCompact } from "@/lib/space/synthLog";
import { forgetFinalMonths, writeMonth, type SpaceMonth, type SpaceRecords, type SpaceSource } from "@/lib/space/store";
import { getBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { getStore } from "@/lib/store/jsonStore";
import { userKey } from "@/lib/store/userKeys";
import { zoneClock } from "@/lib/zone";
import { readListener } from "./record";
import { songIdOf, songKey } from "./songs";
import type { SpaceNight } from "./spaceNights";
import { factItems, factSeeds, nightGallery, NO_FACTS, type FactSeeds } from "./tonightCards";

/* Tonight's wild night cards and the Surprise me pool (spec 7.5, 8.4),
   through the highlights route as routes.test.ts drives it: made-up
   histories (no real account), a made-up NASA log, and `after()` run at
   once and kept. */
const background: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (job: () => Promise<unknown>) => void background.push(job()) };
});
const { GET: highlightsRoute } = await import("@/app/api/user/[name]/highlights/route");
const { GET: nightsRoute } = await import("@/app/api/user/[name]/nights/route");
const { GET: songsRoute } = await import("@/app/api/user/[name]/songs/route");

const at = (iso: string) => Date.parse(iso) / 1000;
const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const chicago = zoneClock("America/Chicago", at("2023-01-01T00:00:00Z"), at("2026-12-31T00:00:00Z"));

type Route = typeof highlightsRoute;
const call = async (route: Route, name: string, query = "tz=America/Chicago") => {
  const res = await route(new Request(`http://x/api/user/${name}/x?${query}`), { params: Promise.resolve({ name }) });
  return { status: res.status, body: await res.json() };
};

async function seed(name: string, history: Scrobble[]) {
  await getStore().appendScrobbles(name, history);
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

const month = <S extends SpaceSource>(source: S, m: string, records: SpaceRecords[S][]): SpaceMonth<S> => ({
  source,
  month: m,
  firstDate: "1900-01-01",
  refreshedAt: "2026-10-01T00:00:00.000Z",
  records,
});

/** n plays from 6 p.m. CDT (23:00 UTC) on a date, a minute apart, each a
    different song unless `song` says otherwise. */
const evening = (date: string, n: number, song = (i: number) => ({ artist: "Artist B", track: `${date} ${i}` })): Scrobble[] =>
  Array.from({ length: n }, (_, i) => ({ uts: at(`${date}T23:00:00Z`) + i * 60, ...song(i) }));
const evensong = { artist: "Artist A", track: "Evensong" };

/*
 * A listener in Chicago, Sept 28, 2023 to Sept 30, 2026 ("three years"), who
 * played music on these nights only:
 * - Thu Sept 28, 2023: the first scrobble.
 * - Mon Apr 8, 2024, the total solar eclipse: 1 play.
 * - Fridays May 3, 10 and 17, 2024: 50, 39 and 52 plays, so a usual Friday
 *   is 50. May 10 is the G5 storm; Evensong is first played that night and
 *   five more times on May 17.
 * - Sat Jun 29, 2024, 2024 MK's pass; Sun Sept 22, 2024, when Venus entered
 *   Scorpio at 9:35 p.m. CDT; Thu Oct 3, 2024, the X9.0 flare.
 * - Wed Sept 30, 2026: the last.
 * And, so each fact's choice among nights with plays is tested, a smaller or
 * lesser one on a newer night with plays: Thu Aug 29, 2024 (Venus into Libra,
 * older), Tue Sept 17, 2024 (a partial lunar eclipse), a G2 storm on Sept 22,
 * a small flyby on Oct 3, and an X1.0 flare and a small fireball on the last.
 */
const chicagoListener: Scrobble[] = [
  ...evening("2023-09-28", 2),
  ...evening("2024-04-08", 1),
  ...evening("2024-05-03", 50),
  ...evening("2024-05-10", 39, (i) => (i === 0 ? evensong : { artist: "Artist B", track: `2024-05-10 ${i}` })),
  ...evening("2024-05-17", 52, (i) => (i < 5 ? evensong : { artist: "Artist B", track: `2024-05-17 ${i}` })),
  ...evening("2024-06-29", 3),
  ...evening("2024-08-29", 3),
  ...evening("2024-09-17", 2),
  ...evening("2024-09-22", 2),
  ...evening("2024-10-03", 3),
  ...evening("2026-09-30", 2),
].sort((a, b) => a.uts - b.uts);

/* NASA's and JPL's months. Each kind of fact has a bigger or newer event on a
   night with no plays, which must never be the one a fact names. */
async function writeSpace() {
  const log = synthCompact(new Date(Date.now() - 3_600_000).toISOString(), {
    kp: [
      ["2024-05-10T21:00:00Z", 8.33],
      ["2024-05-11T00:00:00Z", 9],
      ["2024-05-11T03:00:00Z", 9],
      ["2024-09-23T00:00:00Z", 5.67], // Sept 22's night: a G2 storm, newer
      ["2024-10-11T00:00:00Z", 9], // Oct 10's night: newer, and no plays
    ],
    xflares: [
      ["2024-10-03T12:18:00Z", "X9.0"],
      ["2024-05-14T16:51:00Z", "X8.7"],
      ["2025-01-04T12:00:00Z", "X11.0"], // bigger, and no plays
      ["2026-09-30T20:00:00Z", "X1.0"], // newer, smaller
    ],
  });
  log.starts["2024-05"] = [at("2024-05-10T17:05:00Z")];
  log.starts["2024-09"] = [at("2024-09-22T18:00:00Z")];
  log.starts["2024-10"] = [at("2024-10-10T15:00:00Z")];
  await writeCompact(log);
  const small = Array.from({ length: 1_652 }, (_, k) => ({
    name: `small ${k}`,
    time: new Date((at("2024-06-01T12:00:00Z") + k * 600) * 1000).toISOString(),
    au: 0.005,
    h: 30,
  }));
  await writeMonth(
    month("jpl-cad", "2024-06", [
      ...small,
      { name: "big one", time: "2024-06-15T12:00:00Z", au: 0.008, h: 18 }, // about 890 m, no plays
      { name: "2024 MK", time: "2024-06-29T13:49:00Z", au: 0.00197, h: 22 },
    ]),
  );
  await writeMonth(month("jpl-cad", "2024-10", [{ name: "newer small", time: "2024-10-03T22:00:00Z", au: 0.006, h: 28 }]));
  await writeMonth(
    month("jpl-fireball", "2024-10", [
      { time: "2024-10-03T21:30:00Z", kt: 0.3 },
      { time: "2024-10-20T08:00:00Z", kt: 5 }, // bigger, no plays
    ]),
  );
  await writeMonth(month("jpl-fireball", "2026-09", [{ time: "2026-09-30T23:30:00Z", kt: 0.1 }])); // newer, smaller
  await writeMonth(
    month("epic", "2024-05", [
      {
        date: "2024-05-10",
        images: [
          { name: "east", time: "2024-05-10T05:30:00Z", lat: 0, lon: 100 },
          { name: "west", time: "2024-05-10T17:30:00Z", lat: 0, lon: -85 },
        ],
      },
    ]),
  );
  await writeMonth(
    month("sdo", "2024-05", [
      { date: "2024-05-10", time: "2024-05-10T22:00:00Z", url: "https://sdo.gsfc.nasa.gov/assets/img/browse/2024/05/10/20240510_220000_1024_0171.jpg" },
    ]),
  );
  await writeMonth(
    month("sdo", "2024-10", [
      { date: "2024-10-03", time: "2024-10-03T12:18:00Z", url: "https://sdo.gsfc.nasa.gov/assets/img/browse/2024/10/03/20241003_121800_1024_0171.jpg" },
    ]),
  );
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
  await writeSpace();
});
afterEach(async () => {
  await Promise.all(background.splice(0));
  vi.unstubAllGlobals();
  setBlobStore(null);
});

/** 9.6: no mechanism words, no "cannot", nothing causal, no unsourced superlative. */
const NEVER = /\b(electromagnet\w*|energ(y|ies|etic)|vibrat\w*|vibes?|frequenc(y|ies)|download\w*|activat\w*|cannot|because|caused?|made you|biggest|largest|strongest)\b|—/i;

const MAVEN_CAPTION =
  "Auroras across the night side of Mars, seen by NASA's MAVEN orbiter between May 14 and 20, 2024, as a solar storm reached Mars.";

describe("the wild night cards (spec 8.4)", () => {
  it("gives each card its plays against the usual, its kicker, its kind and the photo its sheet opens on", async () => {
    await seed("cards", chicagoListener);
    const { status, body } = await call(highlightsRoute, "cards");
    expect(status).toBe(200);
    // Every field the row had before stays.
    expect(body.wild).toEqual([
      {
        date: "2024-04-08",
        rank: 0,
        title: "A total solar eclipse across North America",
        story: "Totality crossed Mexico, then the US from Texas to Maine, then Canada.",
        eventId: "eclipse-2024-04-08",
        plays: 1,
        usual: 1,
        line: "1 song · a usual Monday is 1",
        dateLine: "Mon, Apr 8, 2024",
        kind: "eclipse",
        // No EPIC that day: the curated photo leads.
        photo: {
          url: "https://images-assets.nasa.gov/image/GRC-2024-C-02616/GRC-2024-C-02616~large.jpg",
          credit: "NASA/GRC/Jordan Salkin",
          caption: "The diamond ring of the total solar eclipse, seen from NASA's Glenn Research Center in Cleveland on Apr 8, 2024.",
        },
      },
      {
        date: "2024-05-10",
        rank: 3,
        title: "The strongest geomagnetic storm in about 20 years",
        story: "G5, the top of NOAA's scale. NOAA called it the strongest since the Halloween storms of 2003.",
        eventId: "storm-2024-05-10",
        plays: 39,
        usual: 50,
        line: "39 songs · a usual Friday is 50",
        dateLine: "Fri, May 10, 2024",
        kind: "storm",
        // EPIC's Earth before SDO's Sun, though it's a storm night with both:
        // of the day's two, the one facing Chicago's standard longitude (-90°).
        photo: {
          url: "https://epic.gsfc.nasa.gov/archive/natural/2024/05/10/jpg/west.jpg",
          credit: "NASA EPIC team",
          caption: "Earth at 12:30 p.m. CDT on May 10, 2024, from NASA's EPIC camera, a million miles out.",
        },
      },
      {
        date: "2024-10-03",
        rank: 5,
        title: "The largest flare of this solar cycle in NASA's log, as of September 2026",
        story: "An X9.0 flare. NOAA called it the most powerful so far in Solar Cycle 25, and none bigger has come since.",
        eventId: "flare-2024-10-03",
        plays: 3,
        usual: 3, // Thursdays: 2, 3 and 3 plays
        line: "3 songs · a usual Thursday is 3",
        dateLine: "Thu, Oct 3, 2024",
        kind: "flare",
        // No EPIC and no curated photo: SDO's Sun, on an X-flare night.
        photo: {
          url: "https://sdo.gsfc.nasa.gov/assets/img/browse/2024/10/03/20241003_121800_1024_0171.jpg",
          credit: "NASA/SDO and the AIA science team",
          caption: "The Sun at 7:18 a.m. CDT on Oct 3, 2024, from NASA's Solar Dynamics Observatory.",
        },
      },
      {
        date: "2024-06-29",
        rank: 6,
        title: "A 150-meter asteroid, closer than the Moon",
        story: "Asteroid 2024 MK passed 295,000 km from Earth, first reported only 13 days before.",
        eventId: "asteroid-2024-06-29",
        plays: 3,
        usual: 3,
        line: "3 songs · a usual Saturday is 3",
        dateLine: "Sat, Jun 29, 2024",
        kind: "asteroid",
        photo: {
          url: "https://images-assets.nasa.gov/image/PIA26383/PIA26383~large.jpg",
          credit: "NASA/JPL-Caltech",
          caption: "Radar images of asteroid 2024 MK from NASA's Goldstone antennas, made about 16 hours after its closest pass, on Jun 30, 2024 (UTC).",
        },
      },
    ]);
    // The photo each card shows is the first its night sheet shows (8.7.1).
    const nights = (await call(nightsRoute, "cards", "tz=America/Chicago&from=2024-04&to=2024-10")).body.nights;
    for (const card of body.wild) {
      const n = nights.find((x: { date: string }) => x.date === card.date);
      const gallery = [...(typeof n.space.epic === "object" ? [n.space.epic.url] : []), ...n.space.photos.map((p: { url: string }) => p.url)];
      expect(card.photo.url).toBe(gallery[0]);
      expect([card.plays, card.usual]).toEqual([n.plays, n.usualForWeekday]);
    }
  });

  it("leaves a card's photo null when the night has none, so it draws a sky", async () => {
    // Oct 3's SDO image gone: nothing to show for an X-flare night with no EPIC or curated photo.
    await writeMonth(month("sdo", "2024-10", []));
    await seed("nophoto", chicagoListener);
    const { body } = await call(highlightsRoute, "nophoto");
    expect(body.wild.find((w: { date: string }) => w.date === "2024-10-03").photo).toBeNull();
  });
});

/** A night NASA's sources cover, with nothing logged unless given. */
const quiet = (extra: Partial<SpaceNight> = {}): SpaceNight => ({
  known: { storms: true, flares: true, asteroids: true, fireballs: true },
  kp: null,
  stormGrade: null,
  biggestFlare: null,
  xFlare: false,
  asteroid: null,
  fireballs: [],
  flybys: 0,
  epic: "none",
  ...extra,
});

describe("a night's photo gallery (spec 8.7.1)", () => {
  const epic = { url: "https://epic.gsfc.nasa.gov/archive/natural/2024/04/08/jpg/x.jpg", time: "2024-04-08T17:00:00Z", credit: "NASA EPIC team" };
  const sun = { url: "https://sdo.gsfc.nasa.gov/x.jpg", time: at("2024-04-08T18:00:00Z") };
  const credits = (n: string, s: SpaceNight, withSun = true) => nightGallery(night(n), s, withSun ? sun : undefined, chicago).map((p) => p.credit);

  it("runs EPIC, then the curated photo, then SDO's Sun on a storm or flare night", () => {
    const all = nightGallery(night("2024-04-08"), quiet({ kp: 6, epic }), sun, chicago);
    expect(all.map((p) => p.credit)).toEqual(["NASA EPIC team", "NASA/GRC/Jordan Salkin", "NASA/SDO and the AIA science team"]);
    expect(all[0].caption).toBe("Earth at 12:00 p.m. CDT on Apr 8, 2024, from NASA's EPIC camera, a million miles out.");
    expect(all[2].caption).toBe("The Sun at 1:00 p.m. CDT on Apr 8, 2024, from NASA's Solar Dynamics Observatory.");
    expect(credits("2024-04-08", quiet())).toEqual(["NASA/GRC/Jordan Salkin"]); // a quiet night: no Sun
    expect(credits("2024-10-03", quiet({ xFlare: true }))).toEqual(["NASA/SDO and the AIA science team"]);
    expect(credits("2024-07-01", quiet({ epic: "unknown" }), false)).toEqual([]);
  });

  it("never puts the MAVEN photo on a night, May 10 included (7.3)", () => {
    for (const d of ["2024-05-10", "2024-05-14", "2024-05-17", "2024-05-20"]) expect(credits(d, quiet({ kp: 9 }), false)).toEqual([]);
  });
});

describe("the Surprise me pool (spec 7.5)", () => {
  it("holds the songs with a chip, every wild night, and dated facts from this history", async () => {
    await seed("pool", chicagoListener);
    const { body } = await call(highlightsRoute, "pool");
    const evensongId = songIdOf(songKey(evensong.artist, evensong.track));
    expect(body.surprise).toEqual([
      // The first scrobble has no chip, so it's left out; Evensong was first played in the G5 storm.
      { id: `song:${evensongId}`, kind: "song", songId: evensongId },
      { id: "night:2024-04-08", kind: "night", date: "2024-04-08" },
      { id: "night:2024-05-10", kind: "night", date: "2024-05-10" },
      { id: "night:2024-10-03", kind: "night", date: "2024-10-03" },
      { id: "night:2024-06-29", kind: "night", date: "2024-06-29" },
      {
        id: "fact:flybys",
        kind: "fact",
        date: "2024-06-29",
        // The spec's own example (7.5), word for word.
        text: "1,655 asteroid flybys closer than about 4 lunar distances in these three years. On Jun 29, 2024, one of them was about 140 m wide.",
      },
      {
        id: "fact:storms",
        kind: "fact",
        date: "2024-05-10",
        text: "3 solar storms in NASA's log in these three years. On the night of May 10, 2024, one of them reached Kp 9: a G5 storm, the top of the scale.",
      },
      {
        id: "fact:xflares",
        kind: "fact",
        date: "2024-10-03",
        text: "4 X-class flares in NASA's log in these three years. On Oct 3, 2024, one of them reached X9.0, peaking at 7:18 a.m. CDT.",
      },
      {
        id: "fact:eclipses",
        kind: "fact",
        date: "2024-04-08",
        // Oct 14, 2023 to Aug 28, 2026: 14 of the Sun and Moon, penumbral ones included.
        text: "14 eclipses in these three years. On Apr 8, 2024, one of them was a total solar eclipse.",
      },
      {
        id: "fact:fireballs",
        kind: "fact",
        date: "2024-10-03",
        text: "3 fireballs in JPL's log in these three years. On Oct 3, 2024, one of them lit up the sky at 4:30 p.m. CDT.",
      },
      {
        id: "fact:venus",
        kind: "fact",
        date: "2024-09-22",
        // From Leo in Sept 2023 round to Scorpio in Sept 2026 is 39 sign
        // boundaries, plus her retrograde back into Pisces and out again in 2025.
        text: "Venus changed sign 41 times in these three years. On Sept 22, 2024, she entered Scorpio, where she's in her detriment.",
      },
      {
        id: "fact:photo:PIA26304",
        kind: "fact",
        date: "2024-05-17", // the first night with plays while MAVEN watched, May 14 to 20
        text: MAVEN_CAPTION,
        photo: {
          url: "https://images-assets.nasa.gov/image/PIA26304/PIA26304~medium.jpg",
          credit: "NASA/University of Colorado/LASP",
          caption: MAVEN_CAPTION,
        },
      },
    ]);
    for (const item of body.surprise) if (item.text) expect(item.text).not.toMatch(NEVER);
    for (const card of body.wild) expect(`${card.line} ${card.dateLine} ${card.photo?.caption ?? ""}`).not.toMatch(NEVER);
  });

  it("is empty for a listener with no wild night, no chip and no fact, and nothing fails", async () => {
    // Six plays of one song on one quiet evening (Tue Mar 5, 2019): its first
    // play opens the history, so it's never news.
    await seed("quiet", evening("2019-03-05", 6, () => ({ artist: "Artist C", track: "Only" })));
    const quiet = await call(highlightsRoute, "quiet");
    expect(quiet.status).toBe(200);
    expect(quiet.body).toMatchObject({ wild: [], wildCount: 0, wildest: null, surprise: [] });
    // Every play is noise: the record is empty.
    await seed("noise", evening("2024-05-10", 6, (i) => ({ artist: "Rain Sounds", track: `rain ${i}` })));
    const noise = await call(highlightsRoute, "noise");
    expect(noise.status).toBe(200);
    expect(noise.body).toMatchObject({ wild: [], wildCount: 0, wildest: null, strangest: null, surprise: [] });
  });

  it("serves a record stored before the facts without them, then rebuilds it with them", async () => {
    await seed("old", chicagoListener);
    await call(highlightsRoute, "old");
    // The record as version 1 stored it: no facts.
    const { surpriseFacts, ...v1 } = (await readListener("old", "America/Chicago"))!;
    expect(surpriseFacts).toBeDefined();
    await getBlobStore().put(userKey("listener", "old"), gzipSync(Buffer.from(JSON.stringify({ records: [{ ...v1, version: 1 }] }))));
    const stale = await call(highlightsRoute, "old");
    expect(stale.body.status).toBe("updating");
    // Only the photo fact, which reads the nights alone, is there to give.
    expect(stale.body.surprise.map((i: { id: string }) => i.id).filter((id: string) => id.startsWith("fact:"))).toEqual(["fact:photo:PIA26304"]);
    await Promise.all(background.splice(0));
    const fresh = await call(highlightsRoute, "old");
    expect(fresh.body.status).toBe("ready");
    expect(fresh.body.surprise.filter((i: { kind: string }) => i.kind === "fact")).toHaveLength(7);
  });

  it("agrees with the songs and nights routes over a big made-up history", async () => {
    const plays = [
      ...synthHistory(8_000, 7, 2016),
      ...["2024-04-08T23:00:00Z", "2024-05-10T23:00:00Z", "2024-06-29T23:00:00Z"].flatMap((iso) =>
        [0, 1, 2].map((i) => ({ uts: at(iso) + i * 240, artist: "Artist 3", track: `Evening ${iso.slice(5, 10)} ${i}` })),
      ),
    ].sort((a, b) => a.uts - b.uts);
    await seed("big", plays);
    const { body } = await call(highlightsRoute, "big");
    const KIND = ["eclipse", "eclipse", "eclipse", "storm", "storm", "flare", "asteroid"];
    expect(body.wild.length).toBe(10);
    for (const card of body.wild) {
      expect(card.kind).toBe(KIND[card.rank]);
      expect(card.line).toMatch(/^\d{1,3}(,\d{3})* songs? · a usual (Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day is \d{1,3}(,\d{3})*$/);
      expect(card.dateLine).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Oct|Nov|Dec) \d{1,2}, \d{4}$/);
    }
    // The pool's ids never repeat; it holds every wild night, not only the row's 10.
    const ids = body.surprise.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nightItems = body.surprise.filter((i: { kind: string }) => i.kind === "night");
    expect(body.wildCount).toBeGreaterThan(10);
    expect(nightItems).toHaveLength(body.wildCount);
    // Its songs are exactly the songs with a highlight chip.
    const songs = await call(songsRoute, "big");
    const chipped = new Set(
      [...songs.body.row, ...songs.body.listed].filter((s: { highlight: string | null }) => s.highlight).map((s: { songId: string }) => s.songId),
    );
    expect(chipped.size).toBeGreaterThan(0);
    expect(new Set(body.surprise.filter((i: { kind: string }) => i.kind === "song").map((i: { songId: string }) => i.songId))).toEqual(chipped);
    // Every fact opens a night with plays: a sheet for a night without any wouldn't open (8.7).
    const facts = body.surprise.filter((i: { kind: string }) => i.kind === "fact");
    expect(facts.length).toBeGreaterThanOrEqual(3);
    for (const f of facts) {
      expect(f.text).not.toMatch(NEVER);
      const m = f.date.slice(0, 7);
      const nights = (await call(nightsRoute, "big", `tz=America/Chicago&from=${m}&to=${m}`)).body.nights;
      expect(nights.find((n: { date: string }) => n.date === f.date).plays).toBeGreaterThan(0);
    }
  });
});

describe("a fact's example (spec 7.5)", () => {
  it("names a flyby only with a size, since the fact gives one", () => {
    const pass = (meters: number | null) => ({ name: "x", time: at("2024-06-29T12:00:00Z"), ld: 3.5, meters });
    const seeds = (meters: number | null) =>
      factSeeds({
        clock: chicago,
        first: at("2024-06-01T00:00:00Z"),
        last: at("2024-07-01T00:00:00Z"),
        listened: () => true,
        space: new Map([[night("2024-06-29"), quiet({ flybys: 1, asteroid: pass(meters) })]]),
        eclipses: new Map(),
        xflares: [],
      }).flyby;
    expect(seeds(null)).toBeNull();
    expect(seeds(8.2)).toEqual({ night: night("2024-06-29"), time: at("2024-06-29T12:00:00Z"), meters: 8.2 });
  });
});

describe("a fact's words (spec 7.5, 9.2)", () => {
  // Five months of history, Apr 1 to Sept 2, 2026, in Chicago.
  const base = {
    zone: "America/Chicago",
    historyStart: at("2026-04-01T23:00:00Z"),
    historyEnd: at("2026-09-02T23:00:00Z"),
    counts: { plays: 10, venusSignChanges: 1, storms: 1, flybys: 1 },
    nights: [
      [night("2026-04-01"), 5, 0],
      [night("2026-05-14"), 5, 0],
    ] as [number, number, number][],
  };
  const texts = (surpriseFacts: FactSeeds | undefined, extra: Partial<typeof base> = {}) =>
    factItems({ ...base, ...extra, surpriseFacts }).map((f) => f.text);

  it("says it, not one of them, for a count of one, and names the night of an after-midnight event", () => {
    expect(
      texts({
        ...NO_FACTS,
        flyby: { night: night("2026-05-14"), time: at("2026-05-14T15:00:00Z"), meters: 8.2 },
        storm: { night: night("2026-04-01"), kp: 5.67 },
        // 1:30 a.m. CDT on May 15 belongs to May 14's night.
        xflare: { count: 1, night: night("2026-05-14"), peak: at("2026-05-15T06:30:00Z"), cls: "X5.8" },
        eclipse: { count: 1, night: night("2026-05-14"), kind: "annular solar", time: at("2026-05-14T20:00:00Z") },
        fireball: { count: 1, night: night("2026-04-01"), time: at("2026-04-02T07:10:00Z") },
        venus: { night: night("2026-04-01"), time: at("2026-04-01T23:30:00Z"), sign: "Leo" },
      }),
    ).toEqual([
      "1 asteroid flyby closer than about 4 lunar distances in these five months. On May 14, 2026, it was about 8 m wide.",
      "1 solar storm in NASA's log in these five months. On the night of Apr 1, 2026, it reached Kp 6-: a G2 storm.",
      "1 X-class flare in NASA's log in these five months. On the night of May 14, 2026, it reached X5.8, peaking at 1:30 a.m. CDT.",
      "1 eclipse in these five months. On May 14, 2026, it was an annular solar eclipse.",
      "1 fireball in JPL's log in these five months. On the night of Apr 1, 2026, it lit up the sky at 2:10 a.m. CDT.",
      "Venus changed sign once in these five months. On Apr 1, 2026, she entered Leo.",
    ]);
  });

  it("says twice, gives Venus her dignity in 9.3's words, and spans a few weeks", () => {
    const venus = { night: night("2026-04-01"), time: at("2026-04-01T23:30:00Z"), sign: "Pisces" as const };
    expect(texts({ ...NO_FACTS, venus }, { counts: { ...base.counts, venusSignChanges: 2 } })).toEqual([
      "Venus changed sign twice in these five months. On Apr 1, 2026, she entered Pisces, where she's exalted.",
    ]);
    expect(texts({ ...NO_FACTS, venus: { ...venus, sign: "Virgo" } }, { historyEnd: at("2026-04-20T23:00:00Z") })).toEqual([
      "Venus changed sign once in these few weeks. On Apr 1, 2026, she entered Virgo, where she's in her fall.",
    ]);
  });

  it("says nothing it can't count: no count, no history or no stored facts", () => {
    const storm = { night: night("2026-04-01"), kp: 9 };
    expect(texts({ ...NO_FACTS, storm }, { counts: { ...base.counts, storms: 0 } })).toEqual([]);
    expect(texts({ ...NO_FACTS, storm }, { nights: [] })).toEqual([]);
    expect(texts(undefined)).toEqual([]);
  });
});
