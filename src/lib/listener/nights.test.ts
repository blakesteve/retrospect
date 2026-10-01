import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { nightName, zoneClock } from "@/lib/zone";
import { genreFacts, genreMap, nightMix } from "./genres";
import { tallyNights, usualByWeekday } from "./nights";

const at = (iso: string) => Date.parse(iso) / 1000;
const chicago = zoneClock("America/Chicago", at("2024-01-01T00:00:00Z"), at("2025-12-31T00:00:00Z"));
const play = (iso: string, artist = "A", track = "t"): Scrobble => ({ uts: at(iso), artist, track });
const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

describe("nights (spec 7.1)", () => {
  it("puts a 1 a.m. play on the night before, and counts it after midnight", () => {
    const nights = tallyNights(
      [
        play("2024-05-11T01:30:00Z"), // 8:30 p.m. CDT, Fri May 10
        play("2024-05-11T06:59:00Z"), // 1:59 a.m. CDT, Sat May 11: still Friday night
        play("2024-05-11T09:00:00Z"), // 4:00 a.m. CDT: Saturday night begins
      ],
      chicago,
    );
    expect([...nights.values()].map((n) => [nightName(n.night), n.plays, n.afterMidnight])).toEqual([
      ["2024-05-10", 2, 1],
      ["2024-05-11", 1, 0],
    ]);
  });

  it("follows daylight saving: 3:30 a.m. after clocks go back is still the night before", () => {
    // Nov 3, 2024: 2 a.m. CDT becomes 1 a.m. CST. 09:30 UTC is 3:30 a.m. CST.
    const nights = tallyNights([play("2024-11-03T09:30:00Z"), play("2024-11-03T10:30:00Z")], chicago);
    expect([...nights.values()].map((n) => [nightName(n.night), n.afterMidnight])).toEqual([
      ["2024-11-02", 1],
      ["2024-11-03", 0],
    ]);
  });

  it("calls the median of nights with a play on that weekday usual, rounded", () => {
    // Fridays: 10, 30, 31 and 50 plays (median 30.5, so 31); one Sunday of 3.
    const fridays = [
      ["2024-05-03", 10],
      ["2024-05-10", 30],
      ["2024-05-17", 31],
      ["2024-05-24", 50],
    ] as const;
    const tallies = [
      ...fridays.map(([d, plays]) => ({ night: night(d), plays, afterMidnight: 0, genres: new Map() })),
      { night: night("2024-05-05"), plays: 3, afterMidnight: 0, genres: new Map() },
      { night: night("2024-05-06"), plays: 0, afterMidnight: 0, genres: new Map() }, // a Monday with none
    ];
    expect(usualByWeekday(tallies)).toEqual([3, null, null, null, null, 31, null]);
  });
});

describe("genres as facts (spec 7.6)", () => {
  const genres = genreMap({
    artists: {
      "beach house": ["dream pop", "seen live"],
      slowdive: ["shoegaze"],
      mbv: ["shoegaze"],
      "bit part": ["2007", "indie"], // a number isn't a genre
      untagged: [],
    },
  });

  it("maps each artist to its first useful tag", () => {
    expect(Object.fromEntries(genres)).toEqual({ "beach house": "dream pop", slowdive: "shoegaze", mbv: "shoegaze", "bit part": "indie" });
  });

  it("lists genres from 50 plays, with share, top artists, a peak night and rising", () => {
    const plays: Scrobble[] = [];
    // 2024: 60 dream pop plays, 40 by Slowdive and 15 by MBV (55 shoegaze),
    // 49 indie (under 50: not listed), 36 untagged.
    for (let i = 0; i < 60; i++) plays.push(play(`2024-01-${String((i % 28) + 1).padStart(2, "0")}T20:00:00Z`, "Beach House"));
    for (let i = 0; i < 40; i++) plays.push(play(`2024-02-${String((i % 28) + 1).padStart(2, "0")}T20:00:00Z`, "Slowdive"));
    for (let i = 0; i < 15; i++) plays.push(play("2024-03-14T23:00:00Z", "MBV")); // 6 p.m. CDT: shoegaze's biggest night
    for (let i = 0; i < 49; i++) plays.push(play(`2024-04-${String((i % 28) + 1).padStart(2, "0")}T20:00:00Z`, "Bit Part"));
    for (let i = 0; i < 36; i++) plays.push(play(`2024-05-${String((i % 28) + 1).padStart(2, "0")}T20:00:00Z`, "Untagged"));
    // The last 90 days: 25 more Slowdive plays and 5 Beach House.
    for (let i = 0; i < 25; i++) plays.push(play(`2024-09-${String((i % 28) + 1).padStart(2, "0")}T20:00:00Z`, "Slowdive"));
    for (let i = 0; i < 5; i++) plays.push(play(`2024-09-${String(i + 1).padStart(2, "0")}T21:00:00Z`, "Beach House"));
    plays.sort((a, b) => a.uts - b.uts);
    const nights = tallyNights(plays, chicago, (a) => genres.get(a) ?? null);
    const facts = genreFacts(plays, genres, nights);

    expect(facts.map((f) => [f.genre, f.plays])).toEqual([
      ["shoegaze", 80],
      ["dream pop", 65],
    ]);
    const [shoegaze, dreamPop] = facts;
    expect(shoegaze.share).toBeCloseTo(80 / 230, 10);
    expect(shoegaze.topArtists).toEqual(["Slowdive", "MBV"]);
    expect(shoegaze.peakNight).toEqual({ date: "2024-03-14", plays: 15 });
    // Last 90 days: 25 of 30 plays shoegaze, against 80 of 230 overall.
    expect(shoegaze.rising).toEqual({ ratio: 25 / 30 / (80 / 230), recentPlays: 25 });
    // Dream pop's 5 recent plays are under 20: not rising, whatever the ratio.
    expect(dreamPop.rising).toBeNull();
  });

  it("calls a genre rising only with 20 recent plays and a share above its usual", () => {
    // 1,000 plays a year apart from the last 90 days: "steady" is 30% of the
    // history and 30% of the last 90 days (not rising, though 60 recent
    // plays); "fresh" is 2% overall but 19 of the last 90 days' 200 (rising
    // share, too few plays).
    // A tag equal to the artist's own name isn't a genre, so the artists differ.
    const g = genreMap({ artists: { "band a": ["steady"], "band b": ["fresh"], "band c": ["other"] } });
    const ps: Scrobble[] = [];
    const add = (artist: string, n: number, from: string) => {
      for (let i = 0; i < n; i++) ps.push({ uts: at(from) + i * 3600, artist, track: "t" });
    };
    add("Band A", 240, "2024-01-01T00:00:00Z");
    add("Band C", 560, "2024-02-01T00:00:00Z");
    add("Band A", 60, "2024-11-01T00:00:00Z");
    add("Band B", 19, "2024-11-10T00:00:00Z");
    add("Band C", 121, "2024-11-15T00:00:00Z");
    ps.sort((a, b) => a.uts - b.uts);
    const facts = genreFacts(ps, g, tallyNights(ps, chicago, (a) => g.get(a) ?? null));
    expect(facts.find((f) => f.genre === "steady")!.rising).toBeNull();
    // Under 50 plays, "fresh" isn't listed at all; give it 50 and it's still not rising.
    add("Band B", 31, "2024-03-01T00:00:00Z");
    ps.sort((a, b) => a.uts - b.uts);
    const more = genreFacts(ps, g, tallyNights(ps, chicago, (a) => g.get(a) ?? null));
    expect(more.find((f) => f.genre === "fresh")!.rising).toBeNull();
  });

  it("names a night's top 3 genres with 3 plays or more", () => {
    const mix = nightMix({
      night: 0,
      plays: 20,
      afterMidnight: 0,
      genres: new Map([
        ["pop", 9],
        ["indie pop", 4],
        ["bedroom pop", 4],
        ["shoegaze", 3],
        ["jazz", 2],
      ]),
    });
    expect(mix).toEqual([
      { genre: "pop", plays: 9 },
      { genre: "bedroom pop", plays: 4 },
      { genre: "indie pop", plays: 4 },
    ]);
    // Two plays never make the mix, even with room in it.
    const thin = nightMix({ night: 0, plays: 5, afterMidnight: 0, genres: new Map([["pop", 3], ["jazz", 2]]) });
    expect(thin).toEqual([{ genre: "pop", plays: 3 }]);
  });
});
