import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProfile, loudestMonth, profileResponse } from "./profile";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { getStore } from "./store/jsonStore";
import { GET as profileRoute } from "@/app/api/user/[name]/profile/route";
import type { Scrobble } from "./analysis/nostalgia";

// Nothing here may reach the network: a fetch that slips through fails loudly.
beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("the night badges' words (9.2)", () => {
  const why = (scrobbles: Scrobble[], label: string) => buildProfile(scrobbles, "UTC")!.archetypes.find((a) => a.label === label)?.why;

  it("writes 4 a.m. as the spec does, and whole percents", () => {
    expect(why(history(utc(2026, 1, 1), utc(2026, 4, 1), 8, 1), "Night Owl")).toBe(
      "100% of your listening lands between midnight and 4 a.m. The small hours are your listening room.",
    );
    // 1 play in 31 after midnight: 3.2%, written 3%.
    const mostlyDay = [...history(utc(2023, 1, 1), utc(2026, 1, 1), 30), ...history(utc(2023, 1, 1), utc(2026, 1, 1), 1, 1)];
    expect(why(mostlyDay, "Daylight Listener")).toBe(
      "Almost none of your listening happens between midnight and 4 a.m. (3%). Your headphones sleep when you do.",
    );
    // Under half a percent: "less than 1%", never 0%; from half a percent, 1%.
    // 300 plays a day from 6 a.m., a minute apart, and 1 or 2 at 1 a.m.
    const daylight = (perNight: number) =>
      why([...history(utc(2023, 1, 1), utc(2026, 1, 1), 300, 6), ...history(utc(2023, 1, 1), utc(2026, 1, 1), perNight, 1)], "Daylight Listener");
    expect(daylight(1)).toBe("Almost none of your listening happens between midnight and 4 a.m. (less than 1%). Your headphones sleep when you do."); // 0.33%
    expect(daylight(2)).toBe("Almost none of your listening happens between midnight and 4 a.m. (1%). Your headphones sleep when you do."); // 0.66%
    expect(why(history(utc(2023, 1, 1), utc(2026, 1, 1), 5), "Daylight Listener")).toMatch(/\(less than 1%\)/);
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
    // The whole body: the 8.4 tiny-history line reads `have` and `needed`,
    // and `code` names the state the way the answers name it.
    expect(await res.json()).toEqual({
      error: "The profile needs at least 500 scrobbles.",
      code: "too-few-plays",
      have: 300,
      needed: 500,
    });
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

/* ------------------------------------------------------------------ */
/* Phase 3a: the "Your habits" row                                     */
/* ------------------------------------------------------------------ */

const getProfile = async (name: string, query = "") =>
  profileRoute(new Request(`http://test/api/user/${name}/profile${query ? `?${query}` : ""}`), {
    params: Promise.resolve({ name }),
  });

describe("the profile route writes the pending sentence (spec 13.5)", () => {
  beforeEach(() => setBlobStore(new MemoryBlobStore()));
  afterEach(() => setBlobStore(null));

  it("returns it for a history just past a year, every start already behind us", async () => {
    // 1 January 2023 to 14 January 2024, 5 plays a day at noon: 70 plays past
    // the one-year warm-up, none past the 548 days reunions wait. Every start
    // (January 2024, July 2024) is in the past on any day this runs, so the
    // sentence counts songs and never names a month.
    await getStore().appendScrobbles("young", history(utc(2023, 1, 1), utc(2024, 1, 15), 5));
    const res = await getProfile("young", "tz=UTC");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingSentence).toBe(
      "A few habits need more history before they mean anything: " +
        "whether you mostly replay old favorites or go looking for new music (needs about 430 more songs), " +
        "how often you try songs you've never played before (needs about 430 more songs), " +
        "and whether you go back to artists after long breaks (needs about 500 more songs).",
    );
    // `pending` stays alongside it, for anything that wants the numbers.
    expect(body.pending.map((p: { habit: string }) => p.habit)).toEqual(["old-favorites", "first-listens", "reunions"]);
  });

  it("returns null when nothing is pending", async () => {
    await getStore().appendScrobbles("settled", history(utc(2023, 1, 1), utc(2026, 1, 1), 5));
    const body = await (await getProfile("settled", "tz=UTC")).json();
    expect(body.pending).toEqual([]);
    expect(body.pendingSentence).toBeNull();
  });
});

describe("profileResponse writes the sentence for the request's clock", () => {
  // Three months from 1 January 2026, 8 plays a day at 1 a.m. UTC.
  const young = buildProfile(history(utc(2026, 1, 1), utc(2026, 4, 1), 8, 1), "UTC")!;

  it("names the month each habit can start while it's still ahead", () => {
    const r = profileResponse(young, "UTC", false, Date.UTC(2026, 3, 1));
    expect(r.pendingSentence).toBe(
      "A few habits need more history before they mean anything: " +
        "whether you mostly replay old favorites or go looking for new music (from January 2027, once you've played about 500 songs after that), " +
        "how often you try songs you've never played before (from January 2027, once you've played about 500 songs after that), " +
        "and whether you go back to artists after long breaks (from July 2027, once you've played about 500 songs after that).",
    );
    expect(r).toMatchObject({ zone: "UTC", zoneFellBack: false });
  });

  it("names the month in the zone the response is for", () => {
    // The first two habits start Jan 1, 2027 at 1 a.m. UTC: 7 p.m. Dec 31 in Chicago.
    const r = profileResponse(young, "America/Chicago", false, Date.UTC(2026, 3, 1));
    expect(r.pendingSentence).toContain("for new music (from December 2026, once");
  });

  it("counts songs instead once those months have passed, from the same profile", () => {
    const r = profileResponse(young, "UTC", false, Date.UTC(2027, 7, 1));
    expect(r.pendingSentence).toBe(
      "A few habits need more history before they mean anything: " +
        "whether you mostly replay old favorites or go looking for new music (needs about 500 more songs), " +
        "how often you try songs you've never played before (needs about 500 more songs), " +
        "and whether you go back to artists after long breaks (needs about 500 more songs).",
    );
  });
});

/** Any emoji, as spec 8.9 means it: pictographs and the dingbat block. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe("archetypes carry no emoji (spec 8.9, 9.5)", () => {
  afterEach(() => setBlobStore(null));

  it("the pattern catches the badges' old emoji", () => {
    // Positive control: these are three of the nine the badges carried.
    for (const old of ["\u{1F989}", "\u2696\uFE0F", "\u26CF"]) expect(EMOJI.test(old), old).toBe(true);
  });

  it("each badge is a label and a sentence, and the response has no emoji in it", async () => {
    setBlobStore(new MemoryBlobStore());
    // Three years at 5 plays a day at noon: three badges, each of which had one.
    await getStore().appendScrobbles("badged", history(utc(2023, 1, 1), utc(2026, 1, 1), 5));
    const res = await getProfile("badged", "tz=UTC");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.archetypes.map((a: { label: string }) => a.label)).toEqual([
      "Comfort Creature",
      "Daylight Listener",
      "Selective Ears",
    ]);
    for (const a of body.archetypes) expect(Object.keys(a).sort()).toEqual(["label", "why"]);
    expect(text).not.toContain("emoji");
    expect(text).not.toMatch(EMOJI);
  });
});

describe("noise is always excluded (spec 4)", () => {
  beforeEach(() => setBlobStore(new MemoryBlobStore()));
  afterEach(() => setBlobStore(null));

  /** `count` plays a minute apart from `start`, by `artist`. */
  const run = (start: number, count: number, artist: string): Scrobble[] =>
    Array.from({ length: count }, (_, i) => ({ uts: start + i * 60, artist, track: `Track ${i % 40}` }));

  it("doesn't count a noise artist's plays toward the 500, whatever `noise` says", async () => {
    // 450 songs and 100 plays of rain: 550 stored, 450 that count.
    const plays = [...run(utc(2026, 6, 1), 450, "Artist 1"), ...run(utc(2026, 6, 2), 100, "Rain Sounds")];
    await getStore().appendScrobbles("rainy", plays);
    for (const query of ["", "noise=exclude", "noise=include"]) {
      const res = await getProfile("rainy", query);
      expect(res.status, query).toBe(404);
      expect(await res.json(), query).toMatchObject({ code: "too-few-plays", have: 450, needed: 500 });
    }
  });

  it("would have counted those 550 plays had they been songs", async () => {
    // Control for the test above: the same 550 plays by a musician pass.
    const plays = [...run(utc(2026, 6, 1), 450, "Artist 1"), ...run(utc(2026, 6, 2), 100, "Artist 2")];
    await getStore().appendScrobbles("dry", plays);
    expect((await getProfile("dry")).status).toBe(200);
  });

  it("leaves a noise artist's hours out of the habits", async () => {
    // 600 songs at 03:00 UTC through July 2026, and 300 plays of rain at 08:00.
    const songs = Array.from({ length: 600 }, (_, i) => ({
      uts: Date.parse("2026-07-01T03:00:00Z") / 1000 + (i % 30) * DAY + Math.floor(i / 30) * 60,
      artist: `Artist ${i % 9}`,
      track: `Track ${i % 40}`,
    }));
    const rain = Array.from({ length: 300 }, (_, i) => ({
      uts: Date.parse("2026-07-01T08:00:00Z") / 1000 + (i % 30) * DAY + Math.floor(i / 30) * 60,
      artist: "Rain Sounds",
      track: "Thunder",
    }));
    await getStore().appendScrobbles("sleeper", [...songs, ...rain]);
    for (const query of ["tz=UTC", "tz=UTC&noise=include"]) {
      const body = await (await getProfile("sleeper", query)).json();
      expect(body.hourShares[3], query).toBe(1);
      expect(body.hourShares[8], query).toBe(0);
    }
  });

  it("reads a history that is all noise whole, as the answers do, rather than as nothing", async () => {
    await getStore().appendScrobbles("allrain", run(utc(2026, 6, 1), 600, "Rain Sounds"));
    const res = await getProfile("allrain", "tz=UTC");
    expect(res.status).toBe(200);
    expect((await res.json()).hourShares[0]).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* ListeningProfile.tsx, read as source                                */
/* ------------------------------------------------------------------ */

const root = path.resolve(__dirname, "../..");
const COMPONENT = path.join(root, "src/components/ListeningProfile.tsx");
const componentSource = readFileSync(COMPONENT, "utf8");

/** Every module a file names, `import type` included. */
const specifiersOf = (src: string): string[] =>
  [
    ...src.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ...src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);

/** A specifier as an "@/..." path, relative ones resolved from `fromFile`. */
const asAlias = (fromFile: string, spec: string): string =>
  spec.startsWith(".") ? `@/${path.relative(path.join(root, "src"), path.resolve(path.dirname(fromFile), spec))}` : spec;

/** The modules a client file must never import (spec 13.5). */
const BANNED = /^@\/lib\/(readiness|likelihood|report|ephemeris)(\/|\.|$)/;

/** Where a runtime import lands, or null for a package. */
function resolveFile(from: string, spec: string): string | null {
  const alias = asAlias(from, spec);
  if (!alias.startsWith("@/")) return null;
  const base = path.join(root, "src", alias.slice(2));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Every file a module reaches through runtime imports (`import type` never bundles). */
function reach(start: string): string[] {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith(".json")) continue;
    const src = readFileSync(f, "utf8");
    const runtime = [
      ...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
      ...src.matchAll(/^\s*export\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
      ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of runtime) {
      const file = resolveFile(f, spec);
      if (file) stack.push(file);
    }
  }
  return [...seen].map((f) => path.relative(root, f));
}

/** Window data a client bundle must never carry (spec 7.2, 13.5). */
const isWindowData = (f: string) =>
  /^src\/lib\/ephemeris\/.*\.json$/.test(f) || f === "src/lib/sky/windows.ts" || f.startsWith("src/lib/sky/data/");

describe("ListeningProfile.tsx, the habits row", () => {
  it("reads the file it means to: the row's copy from spec 8.4 and 9.5 is there", () => {
    // Positive control for every absence below.
    expect(componentSource).toMatch(/^"use client";/);
    expect(componentSource).toContain('const HEADING = "Your habits";');
    expect(componentSource).toContain(
      'const LINE = "Not the sky: when you listen, how much, and what you reach for, from every play.";',
    );
    expect(componentSource).toContain("of your plays to read. So far there are ");
  });

  it("asks for the profile in the zone the page sent, and nothing about noise", () => {
    // No DOM here, so the request is read from the source: `tz` and the
    // route, and no `noise` (the route always excludes it).
    expect(componentSource).toContain("new URLSearchParams({ tz: zone })");
    expect(componentSource).toContain("/api/user/${encodeURIComponent(username)}/profile${query}");
    // A `noise` parameter, however it's set (the comments may say "noise").
    expect(componentSource).not.toMatch(/noise=|["'`]noise["'`]|\bnoise:/);
    expect('params.set("noise", "exclude")').toMatch(/noise=|["'`]noise["'`]|\bnoise:/);
    expect("?tz=UTC&noise=exclude").toMatch(/noise=|["'`]noise["'`]|\bnoise:/);
  });

  it("is a row: a section and an h2 named Your habits, and one line when it fails (8.4, 11)", () => {
    // The heading, section and failed line are the shared row's, so check
    // the row draws them and that this one is named for the habits.
    const pieces = readFileSync(path.join(root, "src/components/listener/pieces.tsx"), "utf8");
    const row = pieces.slice(pieces.indexOf("export function Row("));
    expect(row).toMatch(/<section aria-labelledby=/);
    expect(row).toMatch(/<h2 id=/);
    expect(pieces).toMatch(/\{name\} didn(?:'|\u2019|&rsquo;)t load\. Refresh to try again\./);
    expect(componentSource).toMatch(/<Row id="your-habits" title=\{HEADING\} sub=\{LINE\}>/);
    expect(componentSource).toContain("<RowFailed name={HEADING} />");
  });

  it("imports none of the modules that reach the window JSON", () => {
    const specs = specifiersOf(componentSource);
    // Controls: the scan sees the imports that are there, and the matcher
    // fires on the banned ones however they're spelled.
    expect(specs).toContain("react");
    expect(specs).toContain("@blakesteve/roster");
    for (const bad of ["@/lib/readiness", "@/lib/likelihood", "@/lib/report", "@/lib/ephemeris/retrogrades"]) {
      expect(BANNED.test(bad), bad).toBe(true);
    }
    expect(BANNED.test(asAlias(COMPONENT, "../lib/readiness"))).toBe(true);
    expect(specs.map((s) => asAlias(COMPONENT, s)).filter((s) => BANNED.test(s))).toEqual([]);
  });

  it("reaches no window data, and no readiness, likelihood or report, at run time", () => {
    // Control: from the server's profile module the same walk does reach them.
    const fromServer = reach(path.join(root, "src/lib/profile.ts"));
    expect(fromServer).toContain("src/lib/readiness.ts");
    expect(fromServer.filter(isWindowData)).toContain("src/lib/ephemeris/mercury-retrogrades.json");

    const fromRow = reach(COMPONENT);
    expect(fromRow).toContain("src/components/ListeningProfile.tsx");
    expect(fromRow.filter(isWindowData)).toEqual([]);
    expect(fromRow.filter((f) => /^src\/lib\/(readiness|likelihood|report)\.ts$/.test(f))).toEqual([]);
  });

  it("has no emoji and none of the old copy", () => {
    expect(componentSource).not.toMatch(EMOJI);
    expect(componentSource).not.toContain("Sky aside");
    expect(componentSource).not.toContain("no horoscope required");
    expect(componentSource).not.toMatch(/innocent/i);
    expect(componentSource).not.toMatch(/\bemoji\b/);
  });
});
