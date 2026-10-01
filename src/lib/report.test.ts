import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { getStore } from "./store/jsonStore";
import { buildReport, type ReportOutcome } from "./report";
import type { Scrobble } from "./analysis/nostalgia";
import { GET as reportRoute } from "@/app/api/user/[name]/report/route";

/* A 3-month-old history used to get null from buildReport, which the route
   turned into 404 "No scrobbles synced yet" and the page into an error screen
   asking whether the username was right. These pin what it gets instead, and
   pair each "too young" case with one old enough to run, so a test can't pass
   by the function giving up on everything. */

const DAY = 86400;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

/** `perDay` plays a day from `from` (inclusive) to `to` (exclusive), over a
    small pool of tracks so that songs repeat. Deterministic. */
function history(from: number, to: number, perDay: number): Scrobble[] {
  const out: Scrobble[] = [];
  let n = 0;
  for (let day = from; day < to; day += DAY) {
    for (let i = 0; i < perDay; i++) {
      const k = n++ % 40;
      out.push({ uts: day + 3600 * (8 + (i % 14)) + i, artist: `Artist ${k % 9}`, track: `Track ${k}` });
    }
  }
  return out;
}

const defaults = { thresholdDays: 365, level: "track" as const };

function report(outcome: ReportOutcome) {
  if (outcome.kind !== "report") throw new Error(`expected a report, got ${outcome.kind}`);
  return outcome.report;
}

beforeEach(() => setBlobStore(new MemoryBlobStore()));
afterEach(() => setBlobStore(null));

describe("buildReport on a young history", () => {
  it("gives a history under a year old a report, not an error", async () => {
    // 90 days from 1 Jan 2026, 20 plays a day.
    await getStore().appendScrobbles("young-default", history(utc(2026, 1, 1), utc(2026, 4, 1), 20));
    const r = report(await buildReport("young-default", { ...defaults, body: "mercury" }));

    expect(r.trialStatus).toBe("warming-up");
    expect(r.warmup).toEqual({
      reason: "young-history",
      days: 365,
      historyStartUts: utc(2026, 1, 1) + 8 * 3600,
      // First play + 365 days: the first moment a play can be an old favorite.
      readyFromUts: utc(2027, 1, 1) + 8 * 3600,
    });
    // The parts of the report that don't need the warm-up are all there.
    expect(r.scrobbleCount).toBe(90 * 20);
    expect(r.yearlyCounts).toEqual([{ year: 2026, count: 1800 }]);
    // The trial's own numbers are empty, not zero.
    expect(Number.isFinite(r.index)).toBe(false);
    expect(Number.isFinite(r.p)).toBe(false);
    expect(r.nullSamples).toEqual([]);
    // Plain English with the date, and not the old false sentence.
    expect(r.verdict.headline).toBe("Too soon to tell.");
    expect(r.verdict.detail).toContain("January 2027");
    expect(r.verdict.detail).not.toMatch(/synced/i);
  });

  it("runs the measures with no warm-up on the same young history", async () => {
    await getStore().appendScrobbles("young-nightowl", history(utc(2026, 1, 1), utc(2026, 4, 1), 20));
    const r = report(
      await buildReport("young-nightowl", { ...defaults, body: "mercury", metric: "nightowl" }),
    );
    expect(r.trialStatus).toBe("ran");
    expect(r.warmup).toBeNull();
  });

  it("runs the default trial once the history is past its first year", async () => {
    // 14 months: January 2025 to March 2026.
    await getStore().appendScrobbles("past-a-year", history(utc(2025, 1, 1), utc(2026, 3, 1), 20));
    const r = report(await buildReport("past-a-year", { ...defaults, body: "mercury" }));
    expect(r.trialStatus).toBe("ran");
    expect(r.warmup).toBeNull();
    expect(Number.isFinite(r.p)).toBe(true);
  });

  it("uses each measure's own warm-up: 548 days for Old Flame, a fixed year for Discovery", async () => {
    // 400 days: past a year, short of 548.
    await getStore().appendScrobbles("four-hundred", history(utc(2025, 1, 1), utc(2025, 1, 1) + 400 * DAY, 20));
    const flame = report(
      await buildReport("four-hundred", { thresholdDays: 548, level: "track", body: "mercury", metric: "oldflame" }),
    );
    expect(flame.trialStatus).toBe("warming-up");
    expect(flame.warmup?.days).toBe(548);

    await getStore().appendScrobbles("ninety-days", history(utc(2026, 1, 1), utc(2026, 4, 1), 20));
    // Discovery ignores the slider's threshold; its warm-up is always a year.
    const discovery = report(
      await buildReport("ninety-days", { thresholdDays: 90, level: "track", body: "eclipse", metric: "discovery" }),
    );
    expect(discovery.warmup?.days).toBe(365);
  });

  it("calls an early era of an old history 'era-in-warmup', not 'young-history'", async () => {
    await getStore().appendScrobbles("old-history", history(utc(2020, 1, 1), utc(2026, 1, 1), 5));
    const r = report(
      await buildReport("old-history", {
        ...defaults,
        body: "mercury",
        fromMonth: "2020-02",
        toMonth: "2020-06",
      }),
    );
    expect(r.trialStatus).toBe("warming-up");
    expect(r.warmup?.reason).toBe("era-in-warmup");
    // 2020 is a leap year: 1 Jan 2020 + 365 days is 31 Dec 2020.
    expect(r.warmup?.readyFromUts).toBe(utc(2020, 12, 31) + 8 * 3600);
  });
});

describe("the report cache", () => {
  it("doesn't serve a report built part-way through a sync once older plays arrive", async () => {
    // Backfill reads newest first, so the newest play is fixed from page 1
    // while older ones keep arriving. A link unfurl mid-sync would otherwise
    // pin "Too soon to tell." on what turns out to be a long history.
    const recent = history(utc(2026, 1, 1), utc(2026, 4, 1), 20);
    await getStore().appendScrobbles("mid-sync", recent);
    const early = report(await buildReport("mid-sync", { ...defaults, body: "mercury" }));
    expect(early.trialStatus).toBe("warming-up");

    await getStore().appendScrobbles("mid-sync", history(utc(2023, 1, 1), utc(2026, 1, 1), 20));
    const later = report(await buildReport("mid-sync", { ...defaults, body: "mercury" }));
    expect(later.trialStatus).toBe("ran");
    expect(later.scrobbleCount).toBeGreaterThan(early.scrobbleCount);
  });
});

describe("buildReport keeps 'no data' and 'too young' apart", () => {
  it("answers no-scrobbles for a user with nothing stored", async () => {
    expect(await buildReport("nobody-here", { ...defaults, body: "mercury" })).toEqual({ kind: "no-scrobbles" });
  });

  it("answers empty-era for an era with no listening in it", async () => {
    await getStore().appendScrobbles("gap-year", [
      ...history(utc(2023, 1, 1), utc(2023, 7, 1), 5),
      ...history(utc(2024, 7, 1), utc(2026, 1, 1), 5),
    ]);
    expect(
      await buildReport("gap-year", { ...defaults, body: "mercury", fromMonth: "2023-09", toMonth: "2024-03" }),
    ).toEqual({ kind: "empty-era" });
  });
});

describe("the report route", () => {
  const call = (name: string, query = "") =>
    reportRoute(new Request(`http://test/api/user/${name}/report${query}`), {
      params: Promise.resolve({ name }),
    });

  it("returns 200 for a young history, where it used to return 404", async () => {
    await getStore().appendScrobbles("route-young", history(utc(2026, 1, 1), utc(2026, 4, 1), 20));
    const res = await call("route-young");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trialStatus).toBe("warming-up");
    // NaN travels as null: a consumer checking isFinite skips it, as before.
    expect(body.index).toBeNull();
  });

  it("says an account that synced and is empty has no scrobbles", async () => {
    await getStore().setSyncState({
      username: "route-empty",
      status: "ready",
      pagesDone: 1,
      totalPages: 0,
      totalScrobbles: 0,
      newestUts: 0,
      updatedAt: Date.now(),
    });
    const res = await call("route-empty");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "no-scrobbles" });
  });

  it("says why, when the sync failed, rather than 'not read yet'", async () => {
    await getStore().setSyncState({
      username: "route-failed",
      status: "error",
      pagesDone: 0,
      totalPages: 0,
      totalScrobbles: 0,
      newestUts: 0,
      error: "User not found",
      errorCode: "user-not-found",
      updatedAt: Date.now(),
    });
    const res = await call("route-failed");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "user-not-found" });
  });

  it("says a history that hasn't been read yet hasn't been read", async () => {
    const res = await call("route-unsynced");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not-synced" });
  });

  it("never says 'No scrobbles synced yet'", async () => {
    await getStore().appendScrobbles("route-sentence", history(utc(2026, 1, 1), utc(2026, 4, 1), 20));
    for (const name of ["route-sentence", "route-unsynced-2"]) {
      const text = await (await call(name)).text();
      expect(text).not.toContain("No scrobbles synced yet");
    }
  });
});

describe("windows 'on you' mean one thing", () => {
  it("counts every window over your listening, on a normal trial as on a young one", async () => {
    /* 1 Jan 2025 to 1 Mar 2026. Mercury was retrograde from 15 Mar 2025,
       18 Jul 2025, 9 Nov 2025 and 26 Feb 2026: four windows over the history.
       The trial itself skips the first year, so it can only use the last.
       This used to report 1, while the reveal said "happened 1 time on you". */
    await getStore().appendScrobbles("fourteen-months", history(utc(2025, 1, 1), utc(2026, 3, 1), 20));
    const r = report(await buildReport("fourteen-months", { ...defaults, body: "mercury" }));
    expect(r.trialStatus).toBe("ran");
    expect(r.windowCount).toBe(4);
    expect(r.eventsTested).toBe(1);

    // The young path uses the same definition: 1 Jan to 1 Apr 2025 overlaps
    // the 15 Mar 2025 retrograde only.
    await getStore().appendScrobbles("three-months", history(utc(2025, 1, 1), utc(2025, 4, 1), 20));
    const young = report(await buildReport("three-months", { ...defaults, body: "mercury" }));
    expect(young.trialStatus).toBe("warming-up");
    expect(young.windowCount).toBe(1);
  });

  it("counts every play inside those windows for 'songs played when Mercury is retrograde'", async () => {
    await getStore().appendScrobbles("window-plays", history(utc(2025, 1, 1), utc(2026, 3, 1), 20));
    const r = report(await buildReport("window-plays", { ...defaults, body: "mercury" }));
    // 15 Mar to 7 Apr, 18 Jul to 11 Aug, 9 Nov to 29 Nov 2025 and 26 Feb 2026
    // on: 24 + 25 + 20 + 3 whole days of 20 plays, give or take the edge days.
    expect(r.windowPlays).toBeGreaterThan(70 * 20);
    expect(r.windowPlays).toBeLessThan(76 * 20);
    // The trial tests only the plays after its first year.
    expect(r.retroN).toBeLessThan(r.windowPlays);
  });
});

describe("a conviction needs separate events, not just plays", () => {
  /** Daytime plays every day, and a burst after midnight during each full moon. */
  function nightOwlUnderFullMoons(from: number, to: number) {
    const out = history(from, to, 30);
    // A little late-night listening every night, so there's a usual rate.
    for (let day = from; day < to; day += DAY) {
      for (let i = 0; i < 3; i++) out.push({ uts: day + 7200 + i * 60, artist: "Late", track: `l${i}` });
    }
    // Full moon windows (3 days each), from the ephemeris.
    const moons = [
      utc(2025, 2, 11), utc(2025, 3, 12), utc(2025, 4, 11), utc(2025, 5, 11),
      utc(2025, 6, 9), utc(2025, 7, 9), utc(2025, 8, 7),
    ].filter((m) => m >= from && m < to);
    for (const m of moons) {
      for (let day = 1; day <= 2; day++) {
        for (let i = 0; i < 120; i++) {
          out.push({ uts: m + day * DAY + 3600 + i * 20, artist: "Night", track: `n${i % 30}` });
        }
      }
    }
    return out.sort((a, b) => a.uts - b.uts);
  }
  const nightOwl = { ...defaults, body: "fullmoon" as const, metric: "nightowl" as const };

  it("withholds a verdict resting on three full moons, however strong", async () => {
    // 20 Jan to 20 Apr 2025: the full moons of February, March and April.
    await getStore().appendScrobbles("three-moons", nightOwlUnderFullMoons(utc(2025, 1, 20), utc(2025, 4, 20)));
    const r = report(await buildReport("three-moons", nightOwl));
    expect(r.eventsTested).toBe(3);
    expect(r.retroN).toBeGreaterThanOrEqual(500);
    expect(r.verdict.status).toBe("too-few-events");
    expect(r.verdict.significant).toBe(false);
    expect(r.verdict.detail).toContain(
      "A full moon comes about once a month, so this test has only 3 full moons to go on, not enough to call a pattern.",
    );
  });

  it("gives the same pattern over seven full moons a verdict", async () => {
    // 20 Jan to 20 Aug 2025: seven full moons.
    await getStore().appendScrobbles("seven-moons", nightOwlUnderFullMoons(utc(2025, 1, 20), utc(2025, 8, 20)));
    const r = report(await buildReport("seven-moons", nightOwl));
    expect(r.eventsTested).toBe(7);
    expect(r.verdict.status).toBe("tested");
    expect(r.verdict.significant).toBe(true);
  });
});

describe("the report's own numbers", () => {
  it("never reports p = 0 and never puts a p-value in the verdict", async () => {
    await getStore().appendScrobbles("p-floor", history(utc(2023, 1, 1), utc(2026, 1, 1), 20));
    for (const metric of ["nostalgia", "intensity"] as const) {
      const r = report(await buildReport("p-floor", { ...defaults, body: "mercury", metric }));
      expect(r.p).toBeGreaterThan(0);
      expect(r.matches).toBeGreaterThanOrEqual(0);
      expect(r.verdict.detail).not.toMatch(/\bp ?[=<]/);
    }
  });
});
