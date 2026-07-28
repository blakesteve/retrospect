import { describe, expect, it } from "vitest";
import type { WindowBounds } from "@/lib/ephemeris/retrogrades";
import { makeInWindow } from "@/lib/ephemeris/retrogrades";
import {
  computeIndex,
  firstListens,
  permutationTest,
  tagScrobbles,
  verdict,
  type Scrobble,
} from "./nostalgia";
import { mulberry32 } from "./rng";

const DAY = 86400;
const T0 = Date.parse("2010-01-01T00:00:00Z") / 1000;

/**
 * Synthetic listener: `years` of history, `perDay` scrobbles/day, drawing from
 * a growing library. Each scrobble is a re-listen of an old track with
 * probability pOld (optionally boosted inside windows), else a new track.
 */
function syntheticHistory(opts: {
  years: number;
  perDay?: number;
  pOld: number;
  boostInWindows?: { bounds: WindowBounds[]; pOld: number };
  seed?: number;
}): Scrobble[] {
  const rng = mulberry32(opts.seed ?? 42);
  const perDay = opts.perDay ?? 10;
  const inBoost = opts.boostInWindows ? makeInWindow(opts.boostInWindows.bounds) : () => false;
  const scrobbles: Scrobble[] = [];
  const catalogue: string[] = [];
  let nextTrack = 0;

  const totalDays = Math.floor(opts.years * 365);
  for (let d = 0; d < totalDays; d++) {
    for (let k = 0; k < perDay; k++) {
      const uts = T0 + d * DAY + Math.floor(rng() * DAY);
      const pOld = inBoost(uts) && opts.boostInWindows ? opts.boostInWindows.pOld : opts.pOld;
      // "Old" here means: re-listen to something from the catalogue's oldest half.
      if (catalogue.length > 20 && rng() < pOld) {
        const idx = Math.floor(rng() * (catalogue.length / 2));
        scrobbles.push({ uts, artist: "Artist", track: catalogue[idx] });
      } else {
        const name = `Track ${nextTrack++}`;
        catalogue.push(name);
        scrobbles.push({ uts, artist: "Artist", track: name });
      }
    }
  }
  return scrobbles.sort((a, b) => a.uts - b.uts);
}

/** Evenly spaced synthetic "retrograde" windows: ~22 days, ~3.2/year. */
function syntheticWindows(years: number): WindowBounds[] {
  const bounds: WindowBounds[] = [];
  const period = 116 * DAY; // Mercury synodic period, near enough
  for (let t = T0 + 30 * DAY; t < T0 + years * 365 * DAY; t += period) {
    bounds.push([t, t + 22 * DAY]);
  }
  return bounds;
}

describe("firstListens", () => {
  it("finds earliest listen per track regardless of input order", () => {
    const scrobbles: Scrobble[] = [
      { uts: 300, artist: "A", track: "x" },
      { uts: 100, artist: "A", track: "X" }, // case-insensitive same track
      { uts: 200, artist: "B", track: "x" },
    ];
    const first = firstListens(scrobbles, "track");
    expect(first.get("a x")).toBe(100);
    expect(first.get("b x")).toBe(200);
  });

  it("collapses to artist at artist level", () => {
    const scrobbles: Scrobble[] = [
      { uts: 100, artist: "A", track: "one" },
      { uts: 900, artist: "A", track: "two" },
    ];
    expect(firstListens(scrobbles, "artist").get("a")).toBe(100);
  });
});

describe("tagScrobbles", () => {
  it("excludes the warm-up period and tags re-listens past the threshold", () => {
    const scrobbles: Scrobble[] = [
      { uts: T0, artist: "A", track: "old" },
      { uts: T0 + 10 * DAY, artist: "A", track: "young" },
      { uts: T0 + 400 * DAY, artist: "A", track: "old" }, // 400d after first: nostalgic
      { uts: T0 + 400 * DAY + 1, artist: "A", track: "young" }, // 390d after: nostalgic
      { uts: T0 + 400 * DAY + 2, artist: "A", track: "brand new" }, // first listen: not
    ];
    const { tagged, spanStart } = tagScrobbles(scrobbles, "track", 365);
    expect(spanStart).toBe(T0 + 365 * DAY);
    expect(tagged).toHaveLength(3);
    expect(tagged.map((t) => t.nostalgic)).toEqual([true, true, false]);
  });

  it("handles empty input", () => {
    expect(tagScrobbles([], "track", 365).tagged).toEqual([]);
  });
});

describe("computeIndex + permutationTest", () => {
  it("finds no effect when nostalgia is independent of the windows", () => {
    const years = 10;
    const scrobbles = syntheticHistory({ years, pOld: 0.4 });
    const bounds = syntheticWindows(years);
    const { tagged, spanStart, spanEnd } = tagScrobbles(scrobbles, "track", 365);
    const result = computeIndex(tagged, bounds);

    expect(result.index).toBeGreaterThan(0.93);
    expect(result.index).toBeLessThan(1.07);

    const test = permutationTest(tagged, bounds, spanStart, spanEnd, result.index, 300);
    expect(test.p).toBeGreaterThan(0.05);
  });

  it("detects a planted retrograde effect", () => {
    const years = 10;
    const bounds = syntheticWindows(years);
    const scrobbles = syntheticHistory({
      years,
      pOld: 0.35,
      boostInWindows: { bounds, pOld: 0.55 }, // strong planted effect
    });
    const { tagged, spanStart, spanEnd } = tagScrobbles(scrobbles, "track", 365);
    const result = computeIndex(tagged, bounds);

    expect(result.index).toBeGreaterThan(1.15);

    const test = permutationTest(tagged, bounds, spanStart, spanEnd, result.index, 300);
    expect(test.p).toBeLessThan(0.05);
  });

  it("is deterministic under a fixed rng seed", () => {
    const years = 6;
    const scrobbles = syntheticHistory({ years, pOld: 0.4, perDay: 4 });
    const bounds = syntheticWindows(years);
    const { tagged, spanStart, spanEnd } = tagScrobbles(scrobbles, "track", 365);
    const { index } = computeIndex(tagged, bounds);
    const a = permutationTest(tagged, bounds, spanStart, spanEnd, index, 200, mulberry32(7));
    const b = permutationTest(tagged, bounds, spanStart, spanEnd, index, 200, mulberry32(7));
    expect(a.p).toBe(b.p);
    expect(a.samples).toEqual(b.samples);
  });
});

describe("verdict", () => {
  it("maps the three outcome states", () => {
    expect(verdict(1.23, 0.01, true).headline).toMatch(/grip/);
    expect(verdict(0.8, 0.01, true).headline).toMatch(/Reverse/);
    expect(verdict(1.02, 0.6, true).headline).toMatch(/innocent/);
    expect(verdict(1.4, 0.01, false).significant).toBe(false);
  });
});
