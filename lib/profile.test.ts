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
  const profile = buildProfile(history(utc(2025, 1, 1), utc(2026, 1, 15), 5), "UTC")!;

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
    const young = buildProfile(history(utc(2026, 1, 1), utc(2026, 4, 1), 8, 1), "UTC")!;
    const labels = young.archetypes.map((a) => a.label);
    expect(labels).toContain("Night Owl");
    expect(labels).toContain("Selective Ears");
    expect(young.pending.map((p) => p.habit)).toEqual(["old-favorites", "first-listens", "reunions"]);
  });
});

describe("buildProfile on an old history", () => {
  it("reports every habit and has nothing pending", () => {
    const old = buildProfile(history(utc(2023, 1, 1), utc(2026, 1, 1), 5), "UTC")!;
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
    const p = buildProfile(withCountedPlays(499), "UTC")!;
    expect(p.oldFavoriteShare).toBeNull();
    expect(p.pending.find((x) => x.habit === "old-favorites")?.countedPlays).toBe(499);
  });

  it("reports at 500", () => {
    const p = buildProfile(withCountedPlays(500), "UTC")!;
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
    const p = buildProfile(history(utc(2026, 1, 1), utc(2026, 4, 1), 20), "UTC")!;
    expect(Math.abs(p.topMonth.delta)).toBeLessThan(0.05);
  });

  it("finds a month you really did listen harder in", () => {
    // January and February at 10 a day, March at 20: March, at about +49%
    // over the 13.4 a day the whole stretch averages.
    const plays = [
      ...history(utc(2026, 1, 1), utc(2026, 3, 1), 10),
      ...history(utc(2026, 3, 1), utc(2026, 4, 1), 20),
    ];
    const p = buildProfile(plays, "UTC")!;
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


describe("the profile reads the listener's zone, and counts nights (spec 7.1)", () => {
  /* Each history is built so that the old reading (calendar days at one
     fixed offset) gives a different answer from nights in a real zone. */
  const at = (iso: string) => Date.parse(iso) / 1000;
  const plays = (instants: number[]): Scrobble[] =>
    instants.map((uts, i) => ({ uts, artist: `Artist ${i % 9}`, track: `Track ${i % 40}` }));
  /** `count` plays a minute apart from `start`. */
  const burst = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i * 60);

  it("counts a 1 a.m. Saturday play toward Friday", () => {
    // 50 plays from 1:00 a.m. CDT on ten Saturdays, 9 May to 11 July 2026.
    const saturdays = Array.from({ length: 10 }, (_, k) => at("2026-05-09T06:00:00Z") + k * 7 * DAY);
    const history = plays(saturdays.flatMap((s) => burst(s, 50)));
    expect(buildProfile(history, "America/Chicago")!.topWeekday).toEqual({ day: "Friday", share: 1 });
    // The same plays at 6 a.m. UTC are Saturday's.
    expect(buildProfile(history, "UTC")!.topWeekday.day).toBe("Saturday");
  });

  it("reads each play with the offset in force then, across a daylight-saving change", () => {
    // 13 plays from 11:30 p.m. Chicago time, 20 February to 31 March 2026.
    // Daylight saving starts 8 March: 11:30 p.m. is 05:30 UTC before, 04:30 after.
    const instants: number[] = [];
    for (let day = at("2026-02-20T00:00:00Z"); day <= at("2026-03-31T00:00:00Z"); day += DAY) {
      const offset = day < at("2026-03-08T00:00:00Z") ? 6 : 5;
      instants.push(...burst(day + 23.5 * 3600 + offset * 3600, 13));
    }
    const p = buildProfile(plays(instants), "America/Chicago")!;
    expect(p.hourShares[23]).toBe(1);
  });

  it("names the busiest night by the date it starts on, and counts nights in a row", () => {
    // Ten nights, 10 to 19 June 2026, each with 25 plays at 11:30 p.m. CDT and
    // 25 at 12:30 a.m.; the night of 12 June has 40 at 12:30 a.m. By calendar
    // date that's 11 days in a row, and 13 June (65 plays) is the busiest.
    const instants: number[] = [];
    for (let k = 0; k < 10; k++) {
      const night = at("2026-06-10T00:00:00Z") + k * DAY;
      instants.push(...burst(night + 28.5 * 3600, 25)); // 11:30 p.m. CDT
      instants.push(...burst(night + 29.5 * 3600, k === 2 ? 40 : 25)); // 12:30 a.m. CDT
    }
    const p = buildProfile(plays(instants), "America/Chicago")!;
    expect(p.busiestDay).toEqual({ date: "2026-06-12", count: 65 });
    expect(p.longestStreakDays).toBe(10);
  });

  it("takes the longest run of nights, not the total, and the earliest night on a tie", () => {
    // Nights 1 to 4 June 2026, none on 5 June, then 6 to 10 June: 9 nights,
    // longest run 5. Each has 30 plays at 11:30 p.m. CDT and 30 at 12:30 a.m.,
    // so by calendar date the second run is 6 days long. Every night ties at 60.
    const instants: number[] = [];
    for (const d of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
      const night = at(`2026-06-${String(d).padStart(2, "0")}T00:00:00Z`);
      instants.push(...burst(night + 28.5 * 3600, 30), ...burst(night + 29.5 * 3600, 30));
    }
    const p = buildProfile(plays(instants), "America/Chicago")!;
    expect(p.longestStreakDays).toBe(5);
    expect(p.busiestDay).toEqual({ date: "2026-06-01", count: 60 });
  });

  it("puts a 1 a.m. play on the first of the month in the month before", () => {
    // January to March 2026 at 10 plays a day at noon CST, plus 150 plays from
    // 1:00 to 3:29 a.m. CST on 1 February, all January 31's night. By night,
    // January runs 460 plays over 31 days and February 280 over 28; by
    // calendar date it's 310 against 430, and February would win.
    const instants: number[] = [];
    for (let day = at("2026-01-01T00:00:00Z"); day < at("2026-04-01T00:00:00Z"); day += DAY) {
      instants.push(...burst(day + 18 * 3600, 10)); // noon CST
    }
    instants.push(...burst(at("2026-02-01T07:00:00Z"), 150));
    expect(buildProfile(plays(instants), "America/Chicago")!.topMonth.month).toBe("January");
  });

  it("counts a month's days by night, as it counts its plays", () => {
    // From 1:00 a.m. CST on each of 1 to 14 February 2026: 100 plays on the
    // first, 40 on the rest. Those are the nights of 31 January to 13
    // February, so January has one night (100 plays) and February 13 (520).
    // Neither has the 14 a month needs, so both stay in and January's rate
    // wins. Counting days by calendar date instead gives January none and
    // February 14, and February wins.
    const instants: number[] = [];
    for (let d = 1; d <= 14; d++) {
      instants.push(...burst(at(`2026-02-${String(d).padStart(2, "0")}T07:00:00Z`), d === 1 ? 100 : 40));
    }
    expect(buildProfile(plays(instants), "America/Chicago")!.topMonth.month).toBe("January");
  });
});

describe("the profile route takes the zone", () => {
  afterEach(() => setBlobStore(null));

  // 600 plays at 03:00 UTC through July 2026: 10 p.m. CDT, noon in Tokyo.
  const july = () =>
    Array.from({ length: 600 }, (_, i) => ({
      uts: Date.parse("2026-07-01T03:00:00Z") / 1000 + (i % 30) * DAY + Math.floor(i / 30) * 60,
      artist: `Artist ${i % 9}`,
      track: `Track ${i % 40}`,
    }));
  const get = async (name: string, query: string) => {
    const res = await profileRoute(new Request(`http://test/api/user/${name}/profile?${query}`), {
      params: Promise.resolve({ name }),
    });
    expect(res.status).toBe(200);
    return res.json();
  };

  it("reads the history in the zone it's sent, and names it", async () => {
    setBlobStore(new MemoryBlobStore());
    await getStore().appendScrobbles("zoned", july());
    const chicago = await get("zoned", "tz=America/Chicago");
    expect(chicago).toMatchObject({ zone: "America/Chicago", zoneFellBack: false });
    expect(chicago.hourShares[22]).toBe(1);
    const tokyo = await get("zoned", "tz=Asia/Tokyo");
    expect(tokyo).toMatchObject({ zone: "Asia/Tokyo", zoneFellBack: false });
    expect(tokyo.hourShares[12]).toBe(1);
  });

  it("falls back to UTC and says so when the zone is missing, refused or today's tzm", async () => {
    setBlobStore(new MemoryBlobStore());
    await getStore().appendScrobbles("unzoned", july());
    for (const query of ["", "tz=Not/AZone", "tzm=-300"]) {
      const p = await get("unzoned", query);
      expect(p, query).toMatchObject({ zone: "UTC", zoneFellBack: true });
      expect(p.hourShares[3], query).toBe(1);
    }
    expect(await get("unzoned", "tz=UTC")).toMatchObject({ zone: "UTC", zoneFellBack: false });
  });
});
