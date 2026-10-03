import { describe, expect, it } from "vitest";
import { nightName, zoneClock } from "@/lib/zone";
import { conditionNotes, moonAt, moonPhaseAt, nightChanges, ninePm, skyNights, timeSpan } from "./skyNights";

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

  it("keeps the angle to 0.01° and the lit fraction to the whole percent, so every Node version writes the same digits", () => {
    // astronomy-engine gives 186.01034891630906 and 0.9959460870531737 here.
    expect(moonAt(ninePm(chicago, night("2024-05-23")))).toMatchObject({ phaseAngle: 186.01, illumination: 1 });
    // Jun 22, 2024: 0.98498 lit, which reads 98%, never 99% by way of 0.985.
    expect(moonAt(ninePm(chicago, night("2024-06-22"))).illumination).toBe(0.98);
  });

  it("finds 9 p.m. on the night a clock goes back", () => {
    expect(new Date(ninePm(chicago, night("2024-11-03")) * 1000).toISOString()).toBe("2024-11-04T03:00:00.000Z"); // 9 p.m. CST
  });
});

describe("what changed during a night (spec 8.7.2, item 4)", () => {
  /* Times as every clock in the app reads them, the minute an instant falls
     in. The Moon entered Cancer May 11, 2024, 03:12:57 UT: astronomy-engine
     has her at 89.32° at 9 p.m. CDT May 10 and 90.08° at 10:22 p.m. (finding
     10). Mercury turned retrograde Apr 1, 2024 22:13 UT (published 22:14);
     Saturn retrograde Jun 29, 2024 and direct Nov 15, 2024, 14:27 UT, 8:27
     a.m. CST; the Sun entered Libra Sept 23, 2026, 00:05 UT; Venus backed
     into Libra Oct 25, 2026, 08:56 UT, 3:56 a.m. CDT, still Oct 24's night. */
  const LATER = at("2026-12-31T00:00:00Z");
  const changes = (date: string, now = LATER) => nightChanges(chicago, night(date), night(date), now).get(night(date)) ?? [];

  it("says when the Moon changed sign, as the night sheet's wheel needs (finding 10)", () => {
    expect(changes("2024-05-10")).toEqual([
      { time: at("2024-05-11T03:12:57Z"), body: "Moon", kind: "sign", text: "The Moon entered Cancer at 10:12 p.m. CDT." },
    ]);
  });

  it("gives every planet's stations and sign changes, the Sun's too, in time order", () => {
    expect(changes("2024-04-01").map((c) => c.text)).toContain("Mercury turned retrograde at 5:13 p.m. CDT.");
    expect(changes("2024-04-01").find((c) => c.body === "Mercury")?.kind).toBe("station");
    const clock = zoneClock("America/Chicago", at("2026-01-01T00:00:00Z"), at("2026-12-31T00:00:00Z"));
    const of = (date: string) => nightChanges(clock, night(date), night(date), LATER).get(night(date))!.map((c) => c.text);
    expect(of("2026-09-22")).toContain("The Sun entered Libra at 7:05 p.m. CDT.");
    expect(of("2026-10-24")).toContain("Venus backed into Libra at 3:56 a.m. CDT.");
    const all = [...nightChanges(chicago, night("2024-01-01"), night("2024-12-31"), LATER)].sort(([a], [b]) => a - b).flatMap(([n, list]) => {
      // Each on the night that holds it, in time order.
      for (const c of list) expect(chicago.nightOf(c.time)).toBe(n);
      return list;
    });
    expect(all.map((c) => c.time)).toEqual([...all.map((c) => c.time)].sort((a, b) => a - b));
    // The Moon changes sign about 160 times a year; every body shows up.
    expect(all.filter((c) => c.body === "Moon").length).toBeGreaterThan(150);
    expect(new Set(all.map((c) => c.body))).toEqual(new Set(["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]));
  });

  it("gives Jupiter's and Saturn's to the day only, as the sky data has them", () => {
    expect(changes("2024-11-15").filter((c) => c.body === "Saturn")).toEqual([
      { time: at("2024-11-15T14:27:18Z"), body: "Saturn", kind: "station", text: "Saturn turned direct that night." },
    ]);
    expect(changes("2024-06-29").map((c) => c.text)).toContain("Saturn turned retrograde that night.");
  });

  it("puts tonight's changes still to come in the present tense, and says tonight", () => {
    // 8 p.m. CDT, May 10, 2024.
    expect(changes("2024-05-10", at("2024-05-11T01:00:00Z")).map((c) => c.text)).toEqual(["The Moon enters Cancer at 10:12 p.m. CDT."]);
    // 6 a.m. CST Nov 15, 2024, before Saturn's station.
    expect(changes("2024-11-15", at("2024-11-15T12:00:00Z")).find((c) => c.body === "Saturn")?.text).toBe("Saturn turns direct tonight.");
    // After it, tonight: the past tense, still "tonight".
    expect(changes("2024-11-15", at("2024-11-15T20:00:00Z")).find((c) => c.body === "Saturn")?.text).toBe("Saturn turned direct tonight.");
  });
});

describe("when a condition began or ended inside a night (spec 8.7.2, item 6)", () => {
  const notes = conditionNotes(chicago, night("2024-01-01"), night("2025-12-31"));

  it("says from when, on the night it began: the sample's May 10, 2024", () => {
    expect(notes.get(night("2024-05-10"))).toEqual({ moonstrong: "from 10:12 p.m. CDT" });
  });

  it("says until when, on the night it ended", () => {
    // She left Cancer May 13, 10:36 UT, 5:36 a.m. CDT; Mercury turned direct Apr 25, 12:51 UT.
    expect(notes.get(night("2024-05-13"))?.moonstrong).toBe("until 5:36 a.m. CDT");
    expect(notes.get(night("2024-04-25"))?.mercury).toBe("until 7:51 a.m. CDT");
    expect(notes.get(night("2024-04-01"))?.mercury).toBe("from 5:13 p.m. CDT");
  });

  it("says nothing for a night the condition held throughout", () => {
    // May 11 and 12: the Moon in Cancer all night; Apr 10: Mercury retrograde all night.
    expect(notes.get(night("2024-05-11"))?.moonstrong).toBeUndefined();
    expect(notes.get(night("2024-05-12"))?.moonstrong).toBeUndefined();
    expect(notes.get(night("2024-04-10"))?.mercury).toBeUndefined();
    // Never storms or flares: their condition is the whole night.
    const ids = new Set([...notes.values()].flatMap((n) => Object.keys(n)));
    expect(ids.has("storms") || ids.has("flares")).toBe(false);
    expect(ids.size).toBe(10);
  });

  it("writes a span inside one night with one zone name, and both when they differ", () => {
    expect(timeSpan("America/Chicago", at("2024-05-11T02:05:00Z"), at("2024-05-11T04:50:00Z"))).toBe("9:05 to 11:50 p.m. CDT");
    expect(timeSpan("America/Chicago", at("2024-05-11T04:05:00Z"), at("2024-05-11T06:50:00Z"))).toBe("11:05 p.m. to 1:50 a.m. CDT");
    // The clock went back at 2 a.m. CDT, Nov 3, 2024.
    expect(timeSpan("America/Chicago", at("2024-11-03T06:30:00Z"), at("2024-11-03T07:10:00Z"))).toBe("1:30 a.m. CDT to 1:10 a.m. CST");
  });
});

describe("the Moon's phase at a minute (8.9, for songs and wild nights)", () => {
  it("reads JPL Horizons' Moon minus Sun around the Sept 26, 2026 full moon and the Oct 3 last quarter, to 0.01°", () => {
    // Horizons (tonight.test.ts): 179.92 at 16:40 UT and 180.01 at 16:50; 269.95 at 13:20 Oct 3 and 270.05 at 13:30.
    expect(Math.abs(moonPhaseAt(at("2026-09-26T16:40:00Z")) - 179.92)).toBeLessThan(0.03);
    expect(Math.abs(moonPhaseAt(at("2026-09-26T16:50:00Z")) - 180.01)).toBeLessThan(0.03);
    expect(Math.abs(moonPhaseAt(at("2026-10-03T13:20:00Z")) - 269.95)).toBeLessThan(0.03);
    expect(Math.abs(moonPhaseAt(at("2026-10-03T13:30:00Z")) - 270.05)).toBeLessThan(0.03);
    // Two decimals at most, so every Node version writes the same digits.
    expect(String(moonPhaseAt(at("2024-05-24T02:00:00Z")))).toBe("186.01");
  });
});
