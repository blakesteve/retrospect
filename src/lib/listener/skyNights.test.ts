import { describe, expect, it } from "vitest";
import { nightName, zoneClock } from "@/lib/zone";
import { moonAt, ninePm, skyNights } from "./skyNights";

const at = (iso: string) => Date.parse(iso) / 1000;
const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const chicago = zoneClock("America/Chicago", at("2024-01-01T00:00:00Z"), at("2025-12-31T00:00:00Z"));
const names = (s: Iterable<number>) => [...s].sort((a, b) => a - b).map(nightName);

describe("the sky on each night (spec 7.3, 8.5)", () => {
  const sky = skyNights(chicago, night("2024-01-01"), night("2025-12-31"));

  it("holds a condition on every night its window touches", () => {
    // Mercury stationed retrograde Apr 1, 2024 at 22:14 UTC (5:14 p.m. CDT)
    // and direct Apr 25 at 12:54 UTC (7:54 a.m. CDT): 25 nights.
    const mercury = names(sky.conditions.get("mercury")!).filter((d) => d.startsWith("2024-04") || d === "2024-03-31");
    expect(mercury[0]).toBe("2024-04-01");
    expect(mercury.at(-1)).toBe("2024-04-25");
    expect(mercury).toHaveLength(25);
  });

  it("lights only the night of a full or new moon's exact instant", () => {
    // The Mar 14, 2025 full moon peaked at 06:54 UTC, 1:54 a.m. CDT: Mar 13's night.
    expect([...sky.fullMoon.keys()].map(nightName)).toContain("2025-03-13");
    expect([...sky.fullMoon.keys()].map(nightName)).not.toContain("2025-03-14");
    // One door per moon: about 12 or 13 a year.
    expect(sky.fullMoon.size).toBeGreaterThanOrEqual(24);
    expect(sky.fullMoon.size).toBeLessThanOrEqual(26);
    // Yet the question's ±36-hour window holds on the nights around it.
    expect(sky.conditions.get("fullmoon")!.has(night("2025-03-12"))).toBe(true);
  });

  it("puts an eclipse on the night of greatest eclipse", () => {
    expect(Object.fromEntries([...sky.eclipse].map(([n, e]) => [nightName(n), e.kind]))).toMatchObject({
      "2024-04-08": "total solar",
      "2025-03-13": "total lunar",
    });
  });

  it("marks Mars at home, in Aries or Scorpio", () => {
    // Mars was in Aries from Apr 30, 2024 (afternoon UTC) to Jun 9 at 04:35 UTC,
    // 11:35 p.m. CDT on Jun 8.
    const spring = names(sky.marsHome).filter((d) => d >= "2024-04-01" && d <= "2024-06-30");
    expect([spring[0], spring.at(-1)]).toEqual(["2024-04-30", "2024-06-08"]);
  });

  it("keeps only the nights asked for", () => {
    const one = skyNights(chicago, night("2024-04-10"), night("2024-04-12"));
    expect(names(one.conditions.get("mercury")!)).toEqual(["2024-04-10", "2024-04-11", "2024-04-12"]);
  });
});

describe("the Moon at 9 p.m.", () => {
  it("reads the full moon of May 23, 2024 as nearly full, in Sagittarius", () => {
    const t = ninePm(chicago, night("2024-05-23"));
    expect(new Date(t * 1000).toISOString()).toBe("2024-05-24T02:00:00.000Z"); // 9 p.m. CDT
    const moon = moonAt(t);
    expect(moon.sign).toBe("Sagittarius");
    expect(moon.phaseAngle).toBeGreaterThan(180);
    expect(moon.phaseAngle).toBeLessThan(190);
    expect(moon.illumination).toBeGreaterThan(0.98);
  });

  it("finds 9 p.m. on the night a clock goes back", () => {
    expect(new Date(ninePm(chicago, night("2024-11-03")) * 1000).toISOString()).toBe("2024-11-04T03:00:00.000Z"); // 9 p.m. CST
  });
});
