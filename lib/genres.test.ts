import { describe, expect, it } from "vitest";
import { analyzeGenres } from "./genres";
import { PHENOMENA } from "./ephemeris/phenomena";
import type { Scrobble } from "./analysis/nostalgia";

/* The genre panel runs its own scramble test, and it had the p-value defect
   the trials had: a result no shuffle could match came out p = 0. */

const DAY = 86400;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

describe("genre p-values", () => {
  it("never reports p = 0, even for a pattern no shuffle can match", () => {
    // Rock every day. Folk once a day, and 30 a day while Mercury is
    // retrograde: a swing far beyond anything a shuffled calendar produces.
    const from = utc(2022, 1, 1);
    const to = utc(2026, 1, 1);
    const windows = PHENOMENA.mercury.bounds.filter(([a, b]) => b >= from && a <= to);
    const inRetro = (t: number) => windows.some(([a, b]) => t >= a && t <= b);
    const plays: Scrobble[] = [];
    for (let day = from; day < to; day += DAY) {
      for (let i = 0; i < 20; i++) plays.push({ uts: day + 3600 * 9 + i * 60, artist: "Rock Band", track: `r${i}` });
      const folk = inRetro(day + 12 * 3600) ? 30 : 1;
      for (let i = 0; i < folk; i++) plays.push({ uts: day + 3600 * 12 + i * 60, artist: "Folk Singer", track: `f${i}` });
    }
    const analysis = analyzeGenres(plays, {
      artists: { "rock band": ["rock"], "folk singer": ["folk"] },
    });

    const folk = analysis.affinity.mercury.find((a) => a.genre === "folk");
    expect(folk).toBeDefined();
    expect(folk!.index).toBeGreaterThan(5);
    // With 400 shuffles and none matching, the honest floor is 1 in 401.
    expect(folk!.p).toBeGreaterThan(0);
    expect(folk!.p).toBeGreaterThanOrEqual(1 / 401);
  });

  it("counts shuffles with none of a genre inside the windows as matches", () => {
    /* Rock every day. Folk in one big burst that happens to land inside the
       2023 Venus retrograde, and a few smaller bursts elsewhere. Most shuffled
       calendars put no folk at all inside a window: a total swing, at least
       as big as the real one. Dropping those shuffles left mostly the ones
       that caught a small burst, which read as p = 0.20; counting them, it's
       0.74, which is what chance really does here. */
    const plays: Scrobble[] = [];
    for (let day = utc(2022, 3, 1); day < utc(2026, 1, 1); day += DAY) {
      for (let i = 0; i < 20; i++) plays.push({ uts: day + 3600 * 9 + i * 60, artist: "Rock Band", track: `r${i}` });
    }
    for (let i = 0; i < 600; i++) plays.push({ uts: utc(2023, 8, 10) + i * 300, artist: "Folk Singer", track: `f${i % 50}` });
    for (let b = utc(2022, 3, 20); b < utc(2025, 12, 1); b += 300 * DAY) {
      if (b > utc(2023, 7, 20) && b < utc(2023, 9, 8)) continue;
      for (let i = 0; i < 250; i++) plays.push({ uts: b + i * 300, artist: "Folk Singer", track: `f${i % 50}` });
    }
    const analysis = analyzeGenres(plays, {
      artists: { "rock band": ["rock"], "folk singer": ["folk"] },
    });
    const folk = analysis.affinity.venus.find((a) => a.genre === "folk")!;
    expect(folk.index).toBeGreaterThan(3);
    expect(folk.p).toBeGreaterThan(0.5);
  });
});
