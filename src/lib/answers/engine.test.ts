import { describe, expect, it, vi } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { signWindows } from "@/lib/sky/windows";
import * as conditions from "./conditions";
import { conditionFor, mergeAspectWindows, mergeSignWindows } from "./conditions";
import {
  MAX_NULL_SAMPLES,
  ROTATIONS,
  computeAnswers,
  drawsFor,
  rangeHalfWidth,
  runQuestion,
  seedFor,
  tagMeasures,
  typicalSwingOf,
} from "./engine";
import { QUESTIONS } from "./questions";
import { synthHistory } from "./synthHistory";
import { permutationP } from "@/lib/analysis/confidence";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("events and merges (spec 6.2)", () => {
  const eventsBetween = (id: Parameters<typeof conditionFor>[0], from: string, to: string) => {
    const c = conditionFor(id)!;
    const inside = c.windows.filter((w) => w.end >= at(from) && w.start <= at(to));
    return { windows: inside.length, events: new Set(inside.map((w) => w.event)).size };
  };

  it("Venus in Aries, Feb 4 to Jun 5, 2025, is one event: she backed out while retrograde", () => {
    expect(eventsBetween("venusdet", "2025-02-01T00:00:00Z", "2025-06-30T00:00:00Z")).toEqual({ windows: 2, events: 1 });
  });

  it("Mars in Cancer, Sept 2024 to Apr 2025, is one event: he came back while retrograde", () => {
    expect(eventsBetween("marswater", "2024-09-01T00:00:00Z", "2025-04-30T00:00:00Z")).toEqual({ windows: 2, events: 1 });
  });

  it("the 2025 trines are one event; Oct 2024's 240 degrees is its own", () => {
    expect(eventsBetween("venusmars", "2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z")).toEqual({ windows: 3, events: 1 });
    expect(eventsBetween("venusmars", "2024-10-01T00:00:00Z", "2025-06-30T00:00:00Z")).toEqual({ windows: 4, events: 2 });
  });

  it("doesn't merge the same aspect on the other side", () => {
    const sides = mergeAspectWindows([
      { aspect: 120, side: "+", start: "2030-01-01T00:00:00Z", end: "2030-01-05T00:00:00Z", rateAtStart: 0.5, rateAtEnd: 0.4 },
      { aspect: 120, side: "-", start: "2030-03-01T00:00:00Z", end: "2030-03-05T00:00:00Z", rateAtStart: -0.3, rateAtEnd: -0.2 },
    ]);
    expect(sides.map((w) => w.event)).toEqual([0, 1]);
  });

  it("merges only what the rules say", () => {
    // Left into the next sign directly, came back directly: two events.
    const direct = mergeSignWindows([
      { body: "Venus", sign: "Taurus", start: "2030-01-01T00:00:00Z", end: "2030-02-01T00:00:00Z", retrogradeAtStart: false, retrogradeAtEnd: false },
      { body: "Venus", sign: "Libra", start: "2030-06-01T00:00:00Z", end: "2030-07-01T00:00:00Z", retrogradeAtStart: false, retrogradeAtEnd: false },
    ]);
    expect(direct.map((w) => w.event)).toEqual([0, 1]);
    // Same aspect and side, but the separation kept going the same way: two.
    const sameWay = mergeAspectWindows([
      { aspect: 120, side: "+", start: "2030-01-01T00:00:00Z", end: "2030-01-05T00:00:00Z", rateAtStart: 0.5, rateAtEnd: 0.4 },
      { aspect: 120, side: "+", start: "2030-03-01T00:00:00Z", end: "2030-03-05T00:00:00Z", rateAtStart: 0.3, rateAtEnd: 0.2 },
    ]);
    expect(sameWay.map((w) => w.event)).toEqual([0, 1]);
    // Turned around, but a different aspect between: two.
    const otherAspect = mergeAspectWindows([
      { aspect: 120, side: "+", start: "2030-01-01T00:00:00Z", end: "2030-01-05T00:00:00Z", rateAtStart: 0.5, rateAtEnd: 0.4 },
      { aspect: 60, side: "+", start: "2030-03-01T00:00:00Z", end: "2030-03-05T00:00:00Z", rateAtStart: -0.3, rateAtEnd: -0.2 },
    ]);
    expect(otherAspect.map((w) => w.event)).toEqual([0, 1]);
  });

  it("keeps every question's windows sorted and disjoint, which the rotated count needs", () => {
    for (const q of QUESTIONS.filter((x) => !x.nasa)) {
      const ws = conditionFor(q.id)!.windows;
      expect(ws.length, q.id).toBeGreaterThan(5);
      for (let i = 1; i < ws.length; i++) expect(ws[i].start, `${q.id} ${i}`).toBeGreaterThan(ws[i - 1].end);
    }
  });

  it("has no planet sign window under a day, so 6.2's short-window rule has nothing to apply to", () => {
    /* Spec 6.2: a sign window shorter than a day that touches a station
       belongs to the loop around it (a generator's tolerance can make one).
       The data is bisected to the second and has none; the shortest Venus
       window is 12.7 days. If a regeneration ever makes one, this fails, and
       the rule needs building before it ships. */
    const short = signWindows.filter(
      (w) => w.body !== "Moon" && w.body !== "Sun" && Date.parse(w.end) - Date.parse(w.start) < 86_400_000,
    );
    expect(short).toEqual([]);
  });
});

/* Histories with no sky effect, all 12 run for real. */
const twenty = synthHistory(40_000, 101, 2006);
const young = synthHistory(20_000, 202, 2024);
const chicago = computeAnswers("engine-test", twenty, "America/Chicago");
const youngAnswers = computeAnswers("engine-test", young, "America/Chicago");
const byId = (rec: typeof chicago, id: string) => rec.questions.find((q) => q.id === id)!;

describe("the 12 on a whole history", () => {
  it("tests the ten sky questions and leaves NASA's two not checked", () => {
    expect(chicago.questions.map((q) => q.status ?? q.notChecked)).toEqual([
      "tested", "tested", "tested", "tested", "tested", "tested", "nasa", "nasa",
      "tested", "tested", "tested", "tested",
    ]);
    expect(chicago.incomplete).toBe(false);
  });

  it("gives a range that excludes zero exactly when p is under 0.05 (6.4)", () => {
    // Over every tested question of several histories, not one.
    const histories = [chicago, ...[7, 8, 9].map((s) => computeAnswers(`r${s}`, synthHistory(20_000, s, 2008), "UTC"))];
    let checked = 0;
    for (const rec of histories) {
      for (const q of rec.questions.filter((x) => x.status === "tested" && x.rangeC !== null)) {
        checked++;
        expect(Math.abs(Math.log(q.index!)) > q.rangeC!, q.id).toBe(q.p! < 0.05);
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("takes c from the 100th largest of 2,000 rotations (6.4)", () => {
    const values = Array.from({ length: 2000 }, (_, i) => i + 1); // 1 to 2,000
    expect(rangeHalfWidth([...values].reverse())).toBe(1901);
    expect(rangeHalfWidth([Infinity, ...values])).toBe(1902); // an infinite swing counts as a value
    // 19 rotations can't give p under 0.05 ((0 + 1) / 20 is 0.05), so no range excludes zero.
    expect(rangeHalfWidth(Array.from({ length: 19 }, (_, i) => i))).toBe(Infinity);
  });

  it("so the range excludes zero exactly when p < 0.05, at the boundary too", () => {
    const values = Array.from({ length: 2000 }, (_, i) => i + 1);
    const c = rangeHalfWidth(values);
    for (const observed of [1900.5, 1901, 1901.5]) {
      const matches = values.filter((v) => v >= observed).length; // 100, 100, 99
      const p = permutationP(matches, values.length);
      expect(observed > c, String(observed)).toBe(p < 0.05);
    }
  });

  it("sends at most 600 shuffles for the histogram", () => {
    for (const q of chicago.questions.filter((x) => x.status === "tested")) {
      expect(q.nullSamples.length).toBeLessThanOrEqual(MAX_NULL_SAMPLES);
      expect(q.nullSamples.length).toBeGreaterThan(400);
    }
  });

  it("draws the same shuffles in every zone: the zone isn't in the seed (6.6)", () => {
    const tokyo = computeAnswers("engine-test", twenty, "Asia/Tokyo");
    expect(seedFor("Engine-Test", "mercury")).toBe(seedFor("engine-test", "mercury"));
    expect(drawsFor("engine-test", "mercury")).toHaveLength(ROTATIONS);
    // Old favorites don't depend on the clock, so the zone changes nothing...
    expect(byId(tokyo, "mercury")).toEqual(byId(chicago, "mercury"));
    // ...while after-midnight plays do.
    expect(byId(tokyo, "fullmoon").index).not.toBe(byId(chicago, "fullmoon").index);
  });
});

describe("the measures", () => {
  it("counts after-midnight plays from 0:00 to 3:59 on the listener's clock (6.7)", () => {
    // Chicago in July is UTC-5: 04:59:59 UTC is 11:59:59 p.m., 08:59:59 is 3:59:59 a.m.
    const plays = ["2026-07-10T04:59:59Z", "2026-07-10T05:00:00Z", "2026-07-10T08:59:59Z", "2026-07-10T09:00:00Z"].map(
      (iso, i) => ({ uts: at(iso), artist: "Artist", track: `Track ${i}` }),
    );
    expect(tagMeasures(plays, "America/Chicago").aftermidnight.tags).toEqual([false, true, true, false]);
  });

  it("leaves sleep noise out, as the report does", () => {
    const noisy = [
      ...young,
      ...young.slice(0, 500).map((s) => ({ ...s, uts: s.uts + 1, artist: "Rain Sounds" })),
    ].sort((a, b) => a.uts - b.uts);
    expect(computeAnswers("engine-test", noisy, "UTC").plays).toBe(young.length);
  });
});

describe("a young history (spec 14)", () => {
  it("warms up the questions that need a year, and reads the rare ones early", () => {
    // 2024 to 30 Sept 2026: under three years.
    const words = Object.fromEntries(youngAnswers.questions.map((q) => [q.id, q.status ?? q.notChecked]));
    expect(words.venusrx).toBe("too-few-events");
    expect(words.marsrx).toBe("too-few-events");
    const venus = byId(youngAnswers, "venusrx");
    // Venus turned retrograde Jul 2023 (before), Mar 2025 and Oct 2026 (after):
    // the history holds one, from Mar 1 to Apr 12, 2025.
    expect(venus.earlyReads.map((r) => new Date(r.start * 1000).toISOString().slice(0, 10))).toEqual(["2025-03-02"]);
    expect(venus.earlyReads[0].path).toMatch(/^from \d+°\d\d′ Aries back to \d+°\d\d′ Pisces$/);
    expect(venus.typicalSingleSwing).toBeGreaterThan(0);
  });

  it("calls a first-year retrograde unmeasurable for old favorites", () => {
    // Plays from 1 Jan 2024: Mercury's retrogrades that year fall in the warm-up.
    const short = computeAnswers("engine-test", synthHistory(20_000, 303, 2024, 2025), "UTC");
    // Mercury turned retrograde Apr 1, Aug 5 and Nov 26, 2024, then Mar 15,
    // Jul 18 and Nov 9, 2025: three in the first year, three measured.
    const mercury = byId(short, "mercury");
    expect(mercury.status).toBe("too-few-events");
    expect(mercury.events).toBe(3);
    const day = (r: { start: number }) => new Date(r.start * 1000).toISOString().slice(0, 10);
    expect(mercury.earlyReads.filter((r) => r.firstYear).map(day)).toEqual(["2024-04-01", "2024-08-05", "2024-11-26"]);
    expect(mercury.earlyReads.filter((r) => !r.firstYear).map(day)).toEqual(["2025-03-15", "2025-07-18", "2025-11-09"]);
    for (const r of mercury.earlyReads) expect(r.swing === null).toBe(r.firstYear);
  });

  it("says too few plays, without testing, for a tiny history", () => {
    const tiny: Scrobble[] = synthHistory(20_000, 404, 2025).slice(0, 300);
    const rec = computeAnswers("engine-test", tiny, "UTC");
    for (const q of rec.questions.filter((x) => !QUESTIONS.find((d) => d.id === x.id)!.nasa)) {
      expect(["too-few-plays", "warming-up"], q.id).toContain(q.status);
      expect(q.iterations).toBe(0);
    }
  });

  it("finds nothing to compare when no play is ever after midnight", () => {
    const daytime = synthHistory(20_000, 505, 2016).map((s) => ({ ...s, uts: s.uts - (s.uts % 86_400) + 15 * 3600 }));
    const rec = computeAnswers("engine-test", daytime, "UTC");
    expect(byId(rec, "fullmoon").status).toBe("no-comparison");
  });
});

describe("early reads (6.5)", () => {
  const DAY = 86_400;
  const S = 1_700_000_000;

  it("compares one event against everything outside the windows", () => {
    // 100 days: 25 plays a day, but 50 a day in the window, days 40 to 49.
    const times: number[] = [];
    for (let d = 0; d < 100; d++) {
      const n = d >= 40 && d < 50 ? 50 : 25;
      for (let i = 0; i < n; i++) times.push(S + d * DAY + 3600 + i * 60);
    }
    const condition = { kind: "sign" as const, windows: [{ start: S + 40 * DAY, end: S + 50 * DAY - 1, event: 0 }], eventCount: 1 };
    const listening = QUESTIONS.find((q) => q.measure === "listening")!;
    const rec = runQuestion(
      listening,
      condition,
      { times, tags: null, spanStart: S, spanEnd: times[times.length - 1] },
      { first: S, last: times[times.length - 1] },
      drawsFor("engine-test", listening.id),
    );
    expect(rec.status).toBe("too-few-events");
    // Twice the usual rate: +100%. Against all plays it would read +82%.
    expect(rec.earlyReads[0].swing).toBeCloseTo(1, 1);
  });

  it("marks an event still going when the history ends", () => {
    // Plays from Jun 2023 to 15 Jan 2025: Mars turned retrograde 6 Dec 2024.
    const plays = synthHistory(20_000, 606, 2023, 2025).filter(
      (s) => s.uts >= at("2023-06-01T00:00:00Z") && s.uts < at("2025-01-15T00:00:00Z"),
    );
    const mars = byId(computeAnswers("engine-test", plays, "UTC"), "marsrx");
    expect(mars.status).toBe("too-few-events");
    expect(mars.earlyReads.map((r) => [new Date(r.start * 1000).toISOString().slice(0, 10), r.inProgress])).toEqual([
      ["2024-12-06", true],
    ]);
  });

  it("measures an event that straddles the end of the first year, by its end", () => {
    // From 25 Mar 2024, old favorites start counting 25 Mar 2025, in the
    // middle of Mercury's retrograde of Mar 15 to Apr 7, 2025.
    const plays = synthHistory(20_000, 303, 2024, 2025).filter((s) => s.uts >= at("2024-03-25T00:00:00Z"));
    const mercury = byId(computeAnswers("engine-test", plays, "UTC"), "mercury");
    expect(mercury.status).toBe("too-few-events");
    const straddling = mercury.earlyReads.find((r) => new Date(r.start * 1000).toISOString().startsWith("2025-03-15"))!;
    expect(straddling.firstYear).toBe(false);
    expect(straddling.swing).not.toBeNull();
    expect(mercury.earlyReads.filter((r) => r.firstYear)).toHaveLength(3); // Apr, Aug and Nov 2024
  });

  it("takes the larger of the 5th and 95th percentiles of one stretch's swings", () => {
    const swings = Array.from({ length: 100 }, (_, i) => (i - 50) / 100); // -0.50 to 0.49
    // Nearest rank: the 5th percentile is -0.45, the 95th 0.44.
    expect(typicalSwingOf(swings)).toBeCloseTo(0.45, 10);
    expect(typicalSwingOf([])).toBeNull();
  });
});

describe("the seed (6.6)", () => {
  it("is FNV-1a of the lowercased username, the question and the version", () => {
    // Written out independently: 32-bit FNV-1a of "engine-test|mercury|1".
    let h = 2166136261;
    for (const ch of "engine-test|mercury|1") {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    expect(seedFor("Engine-Test", "mercury")).toBe(h >>> 0);
  });
});

describe("a single play", () => {
  it("is too few plays for the questions with no warm-up, and says how many", () => {
    const rec = computeAnswers("engine-test", [{ uts: at("2026-01-10T03:00:00Z"), artist: "Artist", track: "Track" }], "UTC");
    for (const id of ["fullmoon", "venushome", "moonstrong", "venusmars", "marswater", "venusdet", "marsrx"]) {
      expect(byId(rec, id).status, id).toBe("too-few-plays");
    }
    expect(byId(rec, "mercury").status).toBe("warming-up");
  });
});

describe("a question that throws", () => {
  it("is not checked, the other 11 stand, and the record asks to be recomputed (6.6)", () => {
    const real = conditions.conditionFor;
    const spy = vi.spyOn(conditions, "conditionFor").mockImplementation((id) => {
      if (id === "venusdet") throw new Error("boom");
      return real(id);
    });
    try {
      const rec = computeAnswers("engine-test", young, "UTC");
      expect(byId(rec, "venusdet")).toMatchObject({ status: null, notChecked: "error" });
      expect(byId(rec, "venushome").status).not.toBeNull();
      expect(rec.incomplete).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
