import { describe, expect, it } from "vitest";
import { moonLight, skyBodies, skyPath, sunLongitude } from "./skyCompute";
import { lonAt } from "@/lib/motion/wheelPath";
import { skyAt } from "@/lib/sky/sky";

/* The Sky view's sky, computed in the browser (spec 8.6), checked against
   published positions and against the server's own sky, since the two must
   agree at every sign boundary (7.2). */

const at = (iso: string) => Date.parse(iso) / 1000;
const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("the sky at an instant, in the browser (8.6)", () => {
  /* 30 Sept 2026, 20:00 UTC. JPL Horizons, apparent geocentric longitude on
     the ecliptic of date (queried 30 Sept 2026, as sky.test.ts quotes it). */
  const HORIZONS = { Sun: 187.68, Venus: 218.37, Mars: 121.59, Jupiter: 139.56, Saturn: 11.59, Moon: 61.53 };
  const bodies = skyBodies(at("2026-09-30T20:00:00Z"));

  it("places each body where JPL Horizons does, to 0.02°", () => {
    for (const [body, lon] of Object.entries(HORIZONS)) {
      expect(off(bodies.find((b) => b.body === body)!.longitude, lon), body).toBeLessThan(0.02);
    }
  });

  it("is the server's sky exactly: signs, degrees, standings, retrograde flags and words", () => {
    expect(bodies).toEqual(skyAt(new Date("2026-09-30T20:00:00Z")).bodies);
    expect(bodies.find((b) => b.body === "Saturn")).toMatchObject({ sign: "Aries", dignity: "fall", retrograde: true });
    expect(bodies.find((b) => b.body === "Venus")!.name).toBe("Venus in Scorpio, in her detriment");
  });

  it("changes sign where the server does: the Sun enters Aries at the 2030 March equinox", () => {
    // USNO: 2030-03-20 13:52 UT.
    expect(skyBodies(at("2030-03-20T13:50:00Z")).find((b) => b.body === "Sun")!.sign).toBe("Pisces");
    expect(skyBodies(at("2030-03-20T13:54:00Z")).find((b) => b.body === "Sun")!.sign).toBe("Aries");
    expect(sunLongitude(at("2030-03-20T13:54:00Z"))).toBeLessThan(0.01);
  });

  it("lights the Moon fully at the Sept 26, 2026 full moon and not at all at the Oct 10 new moon", () => {
    // Horizons: Moon minus Sun 180° at about 16:46 UT on Sept 26; USNO: new moon Oct 10, 15:50 UT.
    expect(moonLight(at("2026-09-26T16:46:00Z"))).toBeGreaterThan(0.9999);
    expect(moonLight(at("2026-10-10T15:50:00Z"))).toBeLessThan(0.0001);
  });
});

describe("the wheel's path, in the browser (8.6, 8.11)", () => {
  const DAY = 86_400;
  const T = at("2024-05-10T02:00:00Z");

  it("has the server's shape: samples on the step, the last at `to` itself, daily and hourly over a day", () => {
    const p = skyPath(T, T + DAY + 1800);
    expect(p).toMatchObject({ from: T, to: T + DAY + 1800, step: { moon: 3600, others: DAY } });
    expect(p.bodies.moon).toHaveLength(26); // 25 on the hour, then `to`
    expect(p.bodies.sun).toHaveLength(3); // `from`, a day on, then `to`
    expect(p.bodies.moon.at(-1)).toBe(skyBodies(T + DAY + 1800).find((b) => b.body === "Moon")!.longitude);
  });

  it("is the same path asked either way round, so a trip into the past runs along it", () => {
    expect(skyPath(T + 5 * DAY, T)).toEqual(skyPath(T, T + 5 * DAY));
  });

  it("puts the Moon where the sky does, between samples, to 0.05°", () => {
    const p = skyPath(T, T + 3 * DAY);
    const mid = T + DAY + 1800;
    expect(off(lonAt(p, "Moon", mid)!, skyBodies(mid).find((b) => b.body === "Moon")!.longitude)).toBeLessThan(0.05);
  });

  it("asks for about 200 samples a planet across 20 years, and steps the Moon at most 8 days", () => {
    const p = skyPath(at("2006-01-01T00:00:00Z"), at("2026-01-01T00:00:00Z"));
    // 7,305 days at 37 a step: 198 on the step, then `to`.
    expect(p.step.others).toBe(37 * DAY);
    expect(p.bodies.mars).toHaveLength(199);
    expect(p.step.moon).toBeLessThanOrEqual(8 * DAY);
    expect(p.bodies.moon.length).toBeLessThanOrEqual(1001);
  });

  it("keeps the Moon running forward across the longest history Last.fm can hold, March 2002 to 2035", () => {
    // Read the short way round, a step over about 12 days would turn it back.
    const p = skyPath(at("2002-03-01T00:00:00Z"), at("2035-12-31T00:00:00Z"));
    expect(p.step.moon).toBeLessThanOrEqual(8 * DAY);
    const m = p.bodies.moon;
    for (let i = 1; i < m.length; i++) {
      const d = (((m[i] - m[i - 1]) % 360) + 360) % 360;
      expect(d, `sample ${i}`).toBeLessThan(180);
    }
    expect(m.length).toBeGreaterThan(1500);
  });
});
