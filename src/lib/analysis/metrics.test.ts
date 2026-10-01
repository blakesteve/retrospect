import { describe, expect, it } from "vitest";
import {
  tagDiscovery,
  tagNightOwl,
  tagOldFlame,
  volumeIndex,
  volumePermutationTest,
} from "./metrics";
import type { Scrobble } from "./nostalgia";
import type { WindowBounds } from "@/lib/ephemeris/retrogrades";
import { mulberry32 } from "./rng";

const DAY = 86400;
const T0 = Date.parse("2015-01-01T00:00:00Z") / 1000;

describe("tagOldFlame", () => {
  it("tags a return to a well-played artist after a long gap", () => {
    const scrobbles: Scrobble[] = [];
    // 12 plays of Artist A in the first month (well-played).
    for (let i = 0; i < 12; i++) scrobbles.push({ uts: T0 + i * DAY, artist: "A", track: `t${i}` });
    // 2 plays of Artist B (not enough history to count as a flame).
    scrobbles.push({ uts: T0 + 5 * DAY, artist: "B", track: "x" });
    scrobbles.push({ uts: T0 + 6 * DAY, artist: "B", track: "x" });
    // Both return after 2 years.
    scrobbles.push({ uts: T0 + 730 * DAY, artist: "A", track: "t0" }); // reunion
    scrobbles.push({ uts: T0 + 730 * DAY + 1, artist: "B", track: "x" }); // not: too few prior plays
    scrobbles.push({ uts: T0 + 730 * DAY + 2, artist: "A", track: "t1" }); // not: gap was reset seconds ago

    const { tagged } = tagOldFlame(scrobbles, 548);
    expect(tagged.map((t) => t.nostalgic)).toEqual([true, false, false]);
  });
});

describe("tagNightOwl", () => {
  it("uses local time via the tz offset", () => {
    const twoAmUtc = T0 + 2 * 3600;
    const scrobbles: Scrobble[] = [{ uts: twoAmUtc, artist: "A", track: "x" }];
    expect(tagNightOwl(scrobbles, 0).tagged[0].nostalgic).toBe(true); // 02:00 UTC
    expect(tagNightOwl(scrobbles, -300).tagged[0].nostalgic).toBe(false); // 21:00 in UTC-5
    expect(tagNightOwl(scrobbles, 120).tagged[0].nostalgic).toBe(false); // 04:00 in UTC+2
  });
});

describe("tagDiscovery", () => {
  it("tags only first-ever plays, after the warm-up", () => {
    const scrobbles: Scrobble[] = [
      { uts: T0, artist: "A", track: "old" },
      { uts: T0 + 400 * DAY, artist: "A", track: "new" }, // first play, past warm-up
      { uts: T0 + 401 * DAY, artist: "A", track: "new" }, // repeat
      { uts: T0 + 402 * DAY, artist: "A", track: "old" }, // repeat of pre-warm-up track
    ];
    const { tagged } = tagDiscovery(scrobbles, 365);
    expect(tagged.map((t) => t.nostalgic)).toEqual([true, false, false]);
  });
});

describe("volumeIndex", () => {
  const years = 6;
  const spanStart = T0;
  const spanEnd = T0 + years * 365 * DAY;
  const bounds: WindowBounds[] = [];
  for (let t = T0 + 100 * DAY; t < spanEnd; t += 500 * DAY) bounds.push([t, t + 30 * DAY]);

  function uniformPlays(perDay: number, boostInWindows = 1): number[] {
    const rng = mulberry32(9);
    const uts: number[] = [];
    const inWindow = (t: number) => bounds.some(([a, b]) => t >= a && t <= b);
    for (let d = 0; d < years * 365; d++) {
      const t0 = spanStart + d * DAY;
      const n = inWindow(t0) ? perDay * boostInWindows : perDay;
      for (let k = 0; k < n; k++) uts.push(t0 + Math.floor(rng() * DAY));
    }
    return uts;
  }

  it("is ~1 for uniform listening", () => {
    const { index } = volumeIndex(uniformPlays(8), bounds, spanStart, spanEnd);
    expect(index).toBeGreaterThan(0.9);
    expect(index).toBeLessThan(1.1);
  });

  it("detects a planted volume boost with a significant p", () => {
    const uts = uniformPlays(8, 2); // double volume inside windows
    const result = volumeIndex(uts, bounds, spanStart, spanEnd);
    expect(result.index).toBeGreaterThan(1.6);
    const test = volumePermutationTest(uts, bounds, spanStart, spanEnd, result.index, 200);
    expect(test.p).toBeLessThan(0.05);
  });
});
