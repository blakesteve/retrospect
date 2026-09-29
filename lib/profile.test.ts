import { afterEach, describe, expect, it } from "vitest";
import { buildProfile, loudestMonth } from "./profile";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { getStore } from "./store/jsonStore";
import { GET as profileRoute } from "@/app/api/user/[name]/profile/route";
import type { Scrobble } from "./analysis/nostalgia";

/* Around a year old, three habits were computed from whatever few plays had
   passed their warm-up, and an empty list came back as 0%: a 365-day history
   was told "Only 0% of your plays are old favorites". These pin that those
   habits are withheld below 500 counted plays and listed as pending, that the
   timing habits are not, and that an old history still gets its badges. */

const DAY = 86400;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

/** `perDay` plays a day, at `hour` UTC, over 40 repeating tracks. */
function history(from: number, to: number, perDay: number, hour = 12): Scrobble[] {
  const out: Scrobble[] = [];
  let n = 0;
  for (let day = from; day < to; day += DAY) {
    for (let i = 0; i < perDay; i++) {
      const k = n++ % 40;
      out.push({ uts: day + hour * 3600 + i * 60, artist: `Artist ${k % 9}`, track: `Track ${k}` });
    }
  }
  return out;
}

const HABIT_BADGES = ["Comfort Creature", "Restless Explorer", "Balanced Diet", "Crate Digger", "Rekindler"];

describe("buildProfile on a history just past a year", () => {
  // 2025-01-01 to 2026-01-15, 5 plays a day at noon: the last two weeks are
  // the only plays past the one-year warm-up, 70 of them.
  const profile = buildProfile(history(utc(2025, 1, 1), utc(2026, 1, 15), 5), 0)!;

  it("withholds the habits that only count plays after a warm-up", () => {
    expect(profile.oldFavoriteShare).toBeNull();
    expect(profile.discoveryShare).toBeNull();
    expect(profile.reunionShare).toBeNull();
    const labels = profile.archetypes.map((a) => a.label);
    for (const badge of HABIT_BADGES) expect(labels).not.toContain(badge);
    // The sentence this ticket was filed over.
    for (const a of profile.archetypes) expect(a.why).not.toContain("Only 0% of your plays are old favorites");
  });

  it("says when each withheld habit can start", () => {
    const noon = 12 * 3600;
    expect(profile.pending).toEqual([
      { habit: "old-favorites", readyFromUts: utc(2026, 1, 1) + noon, countedPlays: 70, minPlays: 500 },
      { habit: "first-listens", readyFromUts: utc(2026, 1, 1) + noon, countedPlays: 70, minPlays: 500 },
      // 548 days after 1 January 2025 is 3 July 2026.
      { habit: "reunions", readyFromUts: utc(2026, 7, 3) + noon, countedPlays: 0, minPlays: 500 },
    ]);
  });
});

describe("buildProfile keeps what doesn't need a warm-up", () => {
  it("still reports night listening and pace on a three-month history", () => {
    const young = buildProfile(history(utc(2026, 1, 1), utc(2026, 4, 1), 8, 1), 0)!;
    const labels = young.archetypes.map((a) => a.label);
    expect(labels).toContain("Night Owl");
    expect(labels).toContain("Selective Ears");
    expect(young.pending.map((p) => p.habit)).toEqual(["old-favorites", "first-listens", "reunions"]);
  });
});

describe("buildProfile on an old history", () => {
  it("reports every habit and has nothing pending", () => {
    const old = buildProfile(history(utc(2023, 1, 1), utc(2026, 1, 1), 5), 0)!;
    expect(old.pending).toEqual([]);
    expect(old.oldFavoriteShare).toBeTypeOf("number");
    expect(old.discoveryShare).toBeTypeOf("number");
    expect(old.reunionShare).toBeTypeOf("number");
    // Every song repeats daily, so nearly everything after year one is an old favorite.
    expect(old.archetypes.map((a) => a.label)).toContain("Comfort Creature");
  });
});

describe("the 500-play floor", () => {
  /** A year of one play a day, then exactly `after` plays past the warm-up. */
  function withCountedPlays(after: number): Scrobble[] {
    const start = utc(2024, 1, 1);
    const year = history(start, start + 365 * DAY, 1);
    const rest = Array.from({ length: after }, (_, i) => ({
      uts: start + 365 * DAY + 12 * 3600 + i,
      artist: `Artist ${i % 9}`,
      track: `Track ${i % 40}`,
    }));
    return [...year, ...rest];
  }

  it("withholds at 499 counted plays", () => {
    const p = buildProfile(withCountedPlays(499), 0)!;
    expect(p.oldFavoriteShare).toBeNull();
    expect(p.pending.find((x) => x.habit === "old-favorites")?.countedPlays).toBe(499);
  });

  it("reports at 500", () => {
    const p = buildProfile(withCountedPlays(500), 0)!;
    expect(p.oldFavoriteShare).toBeTypeOf("number");
    expect(p.pending.map((x) => x.habit)).not.toContain("old-favorites");
  });
});

describe("the profile route on a very small history", () => {
  afterEach(() => setBlobStore(null));

  it("says how many plays it has and needs, so the page can say so", async () => {
    setBlobStore(new MemoryBlobStore());
    await getStore().appendScrobbles("tiny", history(utc(2026, 6, 1), utc(2026, 7, 1), 10));
    const res = await profileRoute(new Request("http://test/api/user/tiny/profile"), {
      params: Promise.resolve({ name: "tiny" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ have: 300, needed: 500 });
  });
});

describe("loudest month", () => {
  it("compares against the months the history has, not a twelfth", () => {
    // Three steady months used to read "+200%" or more: a third of the plays
    // in each month, set against a twelfth.
    const p = buildProfile(history(utc(2026, 1, 1), utc(2026, 4, 1), 20), 0)!;
    expect(Math.abs(p.topMonth.delta)).toBeLessThan(0.05);
  });

  it("finds a month you really did listen harder in", () => {
    // January and February at 10 a day, March at 20: March, at about +49%
    // over the 13.4 a day the whole stretch averages.
    const plays = [
      ...history(utc(2026, 1, 1), utc(2026, 3, 1), 10),
      ...history(utc(2026, 3, 1), utc(2026, 4, 1), 20),
    ];
    const p = buildProfile(plays, 0)!;
    expect(p.topMonth.month).toBe("March");
    expect(Math.round(p.topMonth.delta * 100)).toBe(49);
  });

  it("doesn't let a partial month win on a few heavy days", () => {
    // 26 to 31 December at 60 a day, then January and February at 20.
    const counts = new Array<number>(12).fill(0);
    counts[11] = 6 * 60;
    counts[0] = 31 * 20;
    counts[1] = 28 * 20;
    const top = loudestMonth(counts, utc(2025, 12, 26), utc(2026, 2, 28) + 12 * 3600);
    expect(top.month).not.toBe("December");
  });

  it("never crowns a month with no plays, and never reads NaN", () => {
    // 20 to 31 December, nothing at all in January, then 1 to 10 February.
    const counts = new Array<number>(12).fill(0);
    counts[11] = 300;
    counts[1] = 300;
    const top = loudestMonth(counts, utc(2025, 12, 20), utc(2026, 2, 10) + 12 * 3600);
    expect(top.month).not.toBe("January");
    expect(Number.isFinite(top.delta)).toBe(true);
  });

  it("never calls the loudest month quieter than usual", () => {
    // 20 to 31 December at 60 a day, then January at 20. December can't win
    // on 12 days, and it mustn't drag January to "-36% vs your usual pace".
    const counts = new Array<number>(12).fill(0);
    counts[11] = 12 * 60;
    counts[0] = 31 * 20;
    const top = loudestMonth(counts, utc(2025, 12, 20), utc(2026, 1, 31) + 12 * 3600);
    expect(top.month).toBe("January");
    expect(top.delta).toBeGreaterThanOrEqual(0);
  });
});

