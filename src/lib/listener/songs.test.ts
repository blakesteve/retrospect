import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { selectSongs, songIdOf, songKey, songsOf } from "./songs";

const DAY = 86_400;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;
/** `n` plays of one song, a day apart, starting `day` days into the history. */
const plays = (artist: string, track: string, n: number, day: number): Scrobble[] =>
  Array.from({ length: n }, (_, i) => ({ uts: T0 + (day + i) * DAY + 3600, artist, track }));
const history = (...parts: Scrobble[][]) => parts.flat().sort((a, b) => a.uts - b.uts);
const select = (h: Scrobble[]) => selectSongs(songsOf(h), h[0].uts);

describe("a song", () => {
  it("is its lowercased artist and track, with a stable URL-safe id", () => {
    expect(songKey("Chappell Roan", "Good Luck, Babe!")).toBe("chappell roan good luck, babe!");
    // Pinned: an id that changed would break every shared link.
    expect(songIdOf("chappell roan good luck, babe!")).toBe("XAllheiMHQj");
    expect(songIdOf("chappell roan good luck, babe!")).toMatch(/^[A-Za-z0-9_-]{11}$/);
    // A remaster is another song (spec 14).
    expect(songIdOf(songKey("Tame Impala", "The Less I Know the Better - Remastered"))).not.toBe(
      songIdOf(songKey("Tame Impala", "The Less I Know the Better")),
    );
  });

  it("counts plays across spellings and keeps the first play's", () => {
    const songs = songsOf(
      history([{ uts: T0, artist: "MGMT", track: "Kids" }], [{ uts: T0 + DAY, artist: "mgmt", track: "KIDS" }]),
    );
    expect([...songs.values()]).toEqual([{ key: "mgmt kids", artist: "MGMT", track: "Kids", plays: 2, firstPlayUts: T0 }]);
    // The id comes with selection.
    const picked = selectSongs(songs, T0 - 365 * DAY).row[0];
    expect(picked.songId).toBe(songIdOf("mgmt kids"));
  });
});

describe("the songs shown (spec 7.5)", () => {
  it("takes the 12 most-played with 5 plays, first played after the first 90 days, plus the first scrobble", () => {
    const later = Array.from({ length: 14 }, (_, i) => plays("Artist", `Song ${i}`, 20 - i, 100 + i));
    const h = history(
      plays("Opener", "First", 1, 0), // the first scrobble
      plays("Old", "Favorite", 40, 10), // first played in the first 90 days: never news
      plays("Few", "Plays", 4, 200), // under 5 plays
      ...later,
    );
    const s = select(h);
    expect(s.state).toBe("ready");
    expect(s.settleRuleDropped).toBe(false);
    expect(s.row.map((x) => x.track)).toEqual([...Array.from({ length: 12 }, (_, i) => `Song ${i}`), "First"]);
    expect(s.row.at(-1)).toMatchObject({ firstScrobble: true, early: true });
    expect(s.listed.map((x) => x.track)).toEqual(Array.from({ length: 14 }, (_, i) => `Song ${i}`));
    expect(s.listed.every((x) => !x.early && !x.firstScrobble)).toBe(true);
  });

  it("breaks a tie by the earlier first play, and lists at most 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => plays("A", `S${i}`, 6, 200 + (59 - i)));
    const s = select(history(plays("A", "first", 1, 0), ...many));
    expect(s.listed).toHaveLength(50);
    expect(s.listed[0].track).toBe("S59"); // all 6 plays: the earliest first play leads
  });

  it("drops the 90-day rule when fewer than 3 qualify, and marks those songs early", () => {
    const s = select(history(plays("A", "early one", 9, 1), plays("A", "early two", 8, 5), plays("A", "late", 7, 200)));
    expect(s.settleRuleDropped).toBe(true);
    expect(s.row.map((x) => [x.track, x.early])).toEqual([
      ["early one", true],
      ["early two", true],
      ["late", false],
    ]);
  });

  it("drops the rule with exactly 2 qualifying, and keeps it with 3", () => {
    const two = select(history(plays("A", "early", 9, 1), plays("A", "late one", 7, 200), plays("A", "late two", 6, 210)));
    expect(two.settleRuleDropped).toBe(true);
    expect(two.listed.map((x) => x.track)).toEqual(["early", "late one", "late two"]);
    const three = select(history(plays("A", "early", 9, 1), plays("A", "l1", 7, 200), plays("A", "l2", 6, 210), plays("A", "l3", 5, 220)));
    expect(three.settleRuleDropped).toBe(false);
    expect(three.listed.map((x) => x.track)).toEqual(["l1", "l2", "l3"]);
  });

  it("has nothing to show until a song has 2 plays", () => {
    const s = select(history(plays("A", "one", 1, 0), plays("A", "two", 1, 3)));
    expect(s.state).toBe("too-few-plays");
    expect(s.row.map((x) => x.track)).toEqual(["one"]);
    expect(s.listed).toEqual([]);
  });
});
