import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/analysis/rng";
import {
  SKY_RANGE,
  eclipseEvents,
  harmonyWindows,
  moonEvents,
  retrogradeWindows,
  signWindows,
  type SignWindow,
} from "./windows";
import {
  BODIES,
  HARMONY_TARGETS,
  SIGNS,
  harmonySeparation,
  longitude,
  offFrom,
  signOf,
  skyAt,
  type Sign,
  type SkyBody,
} from "./sky";
import oldMercury from "@/lib/ephemeris/mercury-retrogrades.json";
import oldVenus from "@/lib/ephemeris/venus-retrogrades.json";
import oldMars from "@/lib/ephemeris/mars-retrogrades.json";
import oldFullMoons from "@/lib/ephemeris/full-moons.json";
import oldEclipses from "@/lib/ephemeris/eclipses.json";

/* The generated sky (spec 7.2), checked against the module that made it, the
   old files it must agree with, and published sources. */

const ms = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;

describe("coverage", () => {
  it("runs 2002 through 2035", () => {
    expect(new Date(SKY_RANGE.from).toISOString()).toBe("2002-01-01T00:00:00.000Z");
    expect(new Date(SKY_RANGE.to).toISOString()).toBe("2036-01-01T00:00:00.000Z");
  });

  /* ClickUp 86e3f7fct: this ran out once on a date nobody was watching. The
     coverage is the generated range, not the last event in a file: a sparse
     list ends on its last event, long before its range does. */
  it("covers at least a year ahead of today, new data and old", () => {
    const yearAhead = Date.now() + 365 * DAY;
    expect(SKY_RANGE.to).toBeGreaterThan(yearAhead);
    for (const file of [oldMercury, oldVenus, oldMars, oldFullMoons, oldEclipses]) {
      expect(Date.UTC(file.endYear + 1, 0, 1), file.body).toBeGreaterThan(yearAhead);
    }
  });

  /* The ranges above are headers. These check the events themselves reach
     them, so a hand-edited header or a generator that stopped early fails. */
  it("has events right up to the end of each range", () => {
    const lastPeak = (list: { peak: string }[]) => ms(list[list.length - 1].peak);
    expect(lastPeak(moonEvents.filter((m) => m.phase === "full"))).toBeGreaterThan(SKY_RANGE.to - 31 * DAY);
    expect(lastPeak(moonEvents.filter((m) => m.phase === "new"))).toBeGreaterThan(SKY_RANGE.to - 31 * DAY);
    // Mercury turns retrograde every 116 days or so.
    const lastMercury = retrogradeWindows.filter((w) => w.body === "Mercury").at(-1)!;
    expect(ms(lastMercury.start)).toBeGreaterThan(SKY_RANGE.to - 130 * DAY);
    const oldEnd = (file: { endYear: number }) => Date.UTC(file.endYear + 1, 0, 1);
    expect(ms(oldFullMoons.windows.at(-1)!.peak)).toBeGreaterThan(oldEnd(oldFullMoons) - 31 * DAY);
    expect(ms(oldMercury.windows.at(-1)!.start)).toBeGreaterThan(oldEnd(oldMercury) - 130 * DAY);
  });

  it("holds the event the old data ran out before: Mars retrograde from January 2027", () => {
    // The ticket's first missing event, "11-12 Jan 2027" on a daily grid.
    const mars2027 = (list: { start: string; end: string }[]) =>
      list.find((w) => w.start.startsWith("2027-01"));
    expect(mars2027(retrogradeWindows.filter((w) => w.body === "Mars"))?.start).toBe("2027-01-10T13:00:49Z");
    expect(mars2027(oldMars.windows)?.start.slice(0, 16)).toBe("2027-01-10T13:00");
  });
});

describe("sign windows", () => {
  const byBody = (body: SkyBody) => signWindows.filter((w) => w.body === body);

  it.each(BODIES)("%s tiles the whole range, one sign at a time", (body) => {
    const list = byBody(body);
    expect(ms(list[0].start)).toBeLessThanOrEqual(SKY_RANGE.from);
    expect(ms(list[list.length - 1].end)).toBeGreaterThanOrEqual(SKY_RANGE.to);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].start, `${body} gap before ${list[i].start}`).toBe(list[i - 1].end);
      const step = (SIGNS.indexOf(list[i].sign) - SIGNS.indexOf(list[i - 1].sign) + 12) % 12;
      expect([1, 11]).toContain(step); // forward one sign, or back one while retrograde
    }
  });

  it.each(BODIES)("%s agrees with the sky module inside every window and on both sides of every boundary", (body) => {
    for (const w of byBody(body)) {
      const a = ms(w.start), b = ms(w.end);
      expect(signOf(longitude(body, new Date((a + b) / 2))), `${body} mid ${w.start}`).toBe(w.sign);
      expect(signOf(longitude(body, new Date(a + 2000))), `${body} after ${w.start}`).toBe(w.sign);
      expect(signOf(longitude(body, new Date(b - 2000))), `${body} before ${w.end}`).toBe(w.sign);
    }
  });

  it("only moves backward a sign while the body is retrograde", () => {
    for (const body of BODIES) {
      const list = byBody(body);
      for (let i = 1; i < list.length; i++) {
        const back = (SIGNS.indexOf(list[i].sign) - SIGNS.indexOf(list[i - 1].sign) + 12) % 12 === 11;
        if (back) expect(list[i].retrogradeAtStart, `${body} ${list[i].start}`).toBe(true);
      }
    }
    expect(signWindows.filter((w) => (w.body === "Sun" || w.body === "Moon") && (w.retrogradeAtStart || w.retrogradeAtEnd))).toEqual([]);
  });

  it("has the counts a 34-year range should", () => {
    // Literal expectations: the Sun changes sign 12 times a year, the Moon
    // about 160.
    expect(byBody("Sun")).toHaveLength(34 * 12 + 1);
    expect(byBody("Moon").length).toBeGreaterThan(5_400);
    expect(byBody("Moon").length).toBeLessThan(5_500);
  });
});

describe("retrogrades", () => {
  it.each([
    ["Mercury", oldMercury.windows],
    ["Venus", oldVenus.windows],
    ["Mars", oldMars.windows],
  ] as const)("%s matches the old file to the second", (body, old) => {
    const fresh = retrogradeWindows.filter((w) => w.body === body);
    expect(fresh).toHaveLength(old.length);
    fresh.forEach((w, i) => {
      expect(Math.abs(ms(w.start) - ms(old[i].start))).toBeLessThanOrEqual(1000);
      expect(Math.abs(ms(w.end) - ms(old[i].end))).toBeLessThanOrEqual(1000);
      expect(w.sign).toBe(old[i].sign);
      expect(w.signAtDirect).toBe(old[i].signAtDirect);
    });
  });

  it("now includes Jupiter and Saturn", () => {
    expect(retrogradeWindows.filter((w) => w.body === "Jupiter").length).toBeGreaterThan(30);
    expect(retrogradeWindows.filter((w) => w.body === "Saturn").length).toBeGreaterThan(30);
  });
});

describe("moons and eclipses", () => {
  it("alternates full and new, a lunar month apart, each 36 hours either side", () => {
    for (let i = 1; i < moonEvents.length; i++) {
      expect(moonEvents[i].phase).not.toBe(moonEvents[i - 1].phase);
    }
    for (const phase of ["full", "new"] as const) {
      const list = moonEvents.filter((m) => m.phase === phase);
      for (let i = 1; i < list.length; i++) {
        const gap = (ms(list[i].peak) - ms(list[i - 1].peak)) / DAY;
        expect(gap).toBeGreaterThan(29.2);
        expect(gap).toBeLessThan(29.95);
      }
    }
    for (const m of moonEvents) {
      expect(ms(m.peak) - ms(m.start)).toBe(36 * 3_600_000);
      expect(ms(m.end) - ms(m.peak)).toBe(36 * 3_600_000);
    }
  });

  it("matches the old full moons, and the old eclipses, to the second", () => {
    const fresh = moonEvents.filter((m) => m.phase === "full");
    for (const o of oldFullMoons.windows) {
      const hit = fresh.find((m) => Math.abs(ms(m.peak) - ms(o.peak)) <= 1000);
      expect(hit, `full moon ${o.peak}`).toBeDefined();
      expect(hit!.sign).toBe(o.sign);
    }
    for (const o of oldEclipses.windows) {
      const hit = eclipseEvents.find((e) => Math.abs(ms(e.peak) - ms(o.peak)) <= 1000);
      expect(hit, `eclipse ${o.peak}`).toBeDefined();
      expect(hit!.kind).toBe(o.kind);
    }
  });
});

describe("Venus and Mars harmony", () => {
  it("opens and closes each window at 3 degrees, with the right aspect and side", () => {
    for (const w of harmonyWindows) {
      const target = HARMONY_TARGETS.find((t) => t.aspect === w.aspect && t.side === w.side)!.target;
      const off = (t: number) => Math.abs(offFrom(harmonySeparation(new Date(t)), target));
      expect(off(ms(w.start) + 2000), `${w.start} inside`).toBeLessThanOrEqual(3);
      expect(off(ms(w.end) - 2000), `${w.end} inside`).toBeLessThanOrEqual(3);
      expect(off(ms(w.start) - 2000), `${w.start} outside`).toBeGreaterThan(3);
      expect(off(ms(w.end) + 2000), `${w.end} outside`).toBeGreaterThan(3);
    }
  });

  it("reproduces spec 6.2's worked example", () => {
    // "Jan 23 to 28, Apr 2 to 12 and May 13 to 29, 2025 are one event ... Oct 4
    // to 12, 2024, near 240, is its own." Merging is step 3; the windows are here.
    const span = (w: { start: string; end: string }) => `${w.start.slice(0, 10)}..${w.end.slice(0, 10)}`;
    const found = harmonyWindows
      .filter((w) => w.start >= "2024-09" && w.start < "2025-07")
      .map((w) => `${w.aspect}${w.side} ${span(w)}`);
    expect(found).toEqual([
      "120- 2024-10-04..2024-10-12",
      "120+ 2025-01-23..2025-01-28",
      "120+ 2025-04-02..2025-04-12",
      "120+ 2025-05-13..2025-05-29",
    ]);
    // The rule that merges the three: the separation turned around between them.
    const [, jan, apr, may] = harmonyWindows.filter((w) => w.start >= "2024-09" && w.start < "2025-07");
    expect(Math.sign(jan.rateAtEnd)).not.toBe(Math.sign(apr.rateAtStart));
    expect(Math.sign(apr.rateAtEnd)).not.toBe(Math.sign(may.rateAtStart));
  });
});

describe("the sky at an instant agrees with the windows", () => {
  const within = (list: { start: string; end: string }[], t: number) =>
    list.some((w) => ms(w.start) <= t && t <= ms(w.end));
  const signAt = (body: SkyBody, t: number): Sign =>
    (signWindows as SignWindow[]).find((w) => w.body === body && ms(w.start) <= t && t < ms(w.end))!.sign;

  it("on 300 seeded instants across the range", () => {
    const rng = mulberry32(20261001);
    for (let i = 0; i < 300; i++) {
      const t = SKY_RANGE.from + Math.floor(rng() * (SKY_RANGE.to - SKY_RANGE.from));
      const fromData = [
        within(retrogradeWindows.filter((w) => w.body === "Mercury"), t) && "mercury",
        within(moonEvents.filter((m) => m.phase === "full"), t) && "fullmoon",
        within(moonEvents.filter((m) => m.phase === "new"), t) && "newmoon",
        ["Taurus", "Libra"].includes(signAt("Venus", t)) && "venushome",
        ["Cancer", "Taurus"].includes(signAt("Moon", t)) && "moonstrong",
        within(harmonyWindows, t) && "venusmars",
        ["Cancer", "Scorpio", "Pisces"].includes(signAt("Mars", t)) && "marswater",
        ["Aries", "Scorpio"].includes(signAt("Venus", t)) && "venusdet",
        within(retrogradeWindows.filter((w) => w.body === "Venus"), t) && "venusrx",
        within(retrogradeWindows.filter((w) => w.body === "Mars"), t) && "marsrx",
      ].filter(Boolean);
      expect(skyAt(new Date(t)).conditions, new Date(t).toISOString()).toEqual(fromData);
    }
  });
});

/* Published sources. Each time is the source's; the tolerance is set per kind
   of event from what astronomy-engine can do (see the step 1 write-up):
   eclipses within seconds, the Moon and Sun within a minute or so of the
   minute a source prints, inner-planet stations and Venus and Mars window
   edges within a few minutes (the separation can change as slowly as half a
   degree a day, which stretches small position errors into minutes), and
   Jupiter and Saturn within half an hour (astronomy-engine's own positions
   for the slow planets are off by up to ~8 arcseconds against JPL, which is
   up to 25 minutes of Saturn's motion). */
describe("against published sources", () => {
  const near = <T extends Record<K, string>, K extends string>(list: T[], ref: number, key: K): T =>
    list.reduce((best, e) => (Math.abs(ms(e[key]) - ref) < Math.abs(ms(best[key]) - ref) ? e : best));

  it.each([
    // US Naval Observatory, Astronomical Applications API, /api/moon/phases (UT, to the minute)
    ["new", "2027-01-07T20:24:00Z"],
    ["full", "2027-01-22T12:17:00Z"],
    ["full", "2035-12-15T00:33:00Z"],
    ["new", "2035-12-29T14:31:00Z"],
  ] as const)("USNO %s moon at %s, within 90 s", (phase, ref) => {
    const e = near(moonEvents.filter((m) => m.phase === phase), ms(ref), "peak");
    expect(Math.abs(ms(e.peak) - ms(ref)) / 1000).toBeLessThanOrEqual(90);
  });

  it.each([
    // USNO /api/seasons: equinoxes and solstices are the Sun's ingresses (UT)
    ["Aries", "2030-03-20T13:52:00Z"],
    ["Cancer", "2030-06-21T07:31:00Z"],
    ["Libra", "2035-09-23T04:39:00Z"],
    ["Capricorn", "2035-12-22T01:31:00Z"],
  ] as const)("USNO: the Sun enters %s at %s, within 90 s", (sign, ref) => {
    const w = near(signWindows.filter((x) => x.body === "Sun" && x.sign === sign), ms(ref), "start");
    expect(Math.abs(ms(w.start) - ms(ref)) / 1000).toBeLessThanOrEqual(90);
  });

  it.each([
    // NASA GSFC eclipse catalog (Espenak), greatest eclipse in TD. Ours in UT
    // plus astronomy-engine's own delta T, so no second delta T model mixes in.
    ["total solar", "2027-08-02T10:07:49Z", 76.0],
    ["total lunar", "2029-06-26T03:23:22Z", 77.3],
    ["total solar", "2035-09-02T01:56:46Z", 81.5],
  ] as const)("NASA: %s eclipse at %s TD, within 10 s", (kind, refTd, deltaT) => {
    const e = near(eclipseEvents, ms(refTd), "peak");
    expect(e.kind).toBe(kind);
    expect(Math.abs(ms(e.peak) + deltaT * 1000 - ms(refTd)) / 1000).toBeLessThanOrEqual(10);
  });

  it.each([
    // JPL Horizons, apparent geocentric ecliptic-of-date longitude (quantity 31),
    // station from a quadratic fit to 10-minute samples, ingresses and window
    // edges interpolated between minute samples. Queried 30 Sept 2026.
    ["Mercury stations retrograde", () => retrogradeWindows.find((w) => w.body === "Mercury" && w.start.startsWith("2027-02"))!.start, "2027-02-09T17:36:01Z", 180],
    ["Mars stations retrograde", () => retrogradeWindows.find((w) => w.body === "Mars" && w.start.startsWith("2027-01"))!.start, "2027-01-10T12:59:06Z", 180],
    ["the Moon enters Capricorn", () => signWindows.find((w) => w.body === "Moon" && w.sign === "Capricorn" && w.start.startsWith("2033-07-10"))!.start, "2033-07-10T21:43:36Z", 90],
    ["Venus and Mars open a window near 240", () => harmonyWindows.find((w) => w.start.startsWith("2031-01-29"))!.start, "2031-01-29T00:43:00Z", 180],
    ["Venus and Mars close a window near 240", () => harmonyWindows.find((w) => w.end.startsWith("2027-02-10"))!.end, "2027-02-10T02:01:54Z", 180],
    ["Venus and Mars open a window near 60", () => harmonyWindows.find((w) => w.start.startsWith("2034-01-17"))!.start, "2034-01-17T04:41:55Z", 180],
    ["Venus and Mars close a window near 60", () => harmonyWindows.find((w) => w.end.startsWith("2034-01-28"))!.end, "2034-01-28T05:26:53Z", 180],
    ["Jupiter stations retrograde", () => retrogradeWindows.find((w) => w.body === "Jupiter" && w.start.startsWith("2031-04"))!.start, "2031-04-15T12:02:29Z", 1800],
    ["Saturn enters Taurus", () => signWindows.find((w) => w.body === "Saturn" && w.sign === "Taurus" && w.start.startsWith("2028"))!.start, "2028-04-13T03:39:58Z", 1800],
    ["Saturn enters Cancer", () => signWindows.find((w) => w.body === "Saturn" && w.sign === "Cancer" && w.start.startsWith("2032"))!.start, "2032-07-14T02:16:12Z", 1800],
  ] as const)("Horizons: %s at %s", (_what, ours, ref, toleranceSec) => {
    expect(Math.abs(ms(ours()) - ms(ref)) / 1000).toBeLessThanOrEqual(toleranceSec);
  });
});
