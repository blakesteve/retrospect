import { describe, expect, it } from "vitest";
import { easeInOut, lonAt, nextElapsed, travelAt, travelMs, type SkyPath } from "./wheelPath";

/* Spec 8.11 item 1 and 7.4's path shape. Expected values are worked out by
   hand from the samples, not by the module. */

const DAY = 86_400;
const T0 = 1_790_000_000;
const path = (bodies: SkyPath["bodies"], days: number): SkyPath => ({ from: T0, to: T0 + days * DAY, step: { moon: 3600, others: DAY }, bodies });

describe("a planet's longitude along the path", () => {
  it("is the sample itself at a sample's time", () => {
    expect(lonAt(path({ venus: [10, 20, 30] }, 2), "Venus", T0 + DAY)).toBe(20);
  });

  it("is between its two samples between them", () => {
    expect(lonAt(path({ mars: [10, 20, 30] }, 2), "Mars", T0 + DAY / 2)).toBe(15);
  });

  it("goes the short way across 0° Aries", () => {
    expect(lonAt(path({ sun: [359, 1] }, 1), "Sun", T0 + DAY / 2)).toBe(0);
    expect(lonAt(path({ sun: [1, 359] }, 1), "Sun", T0 + DAY / 4)).toBe(0.5);
  });

  it("slows, stops and turns at a station, as its samples do", () => {
    const p = path({ venus: [10, 10.5, 10.6, 10.4, 10.0] }, 4);
    const at = (d: number) => lonAt(p, "Venus", T0 + d * DAY)!;
    expect(at(0.5)).toBeCloseTo(10.25, 10);
    expect(at(1.5)).toBeCloseTo(10.55, 10);
    expect(at(2.5)).toBeCloseTo(10.5, 10);
    expect(at(3.5)).toBeCloseTo(10.2, 10);
  });

  it("reads the Moon's samples hourly", () => {
    const p: SkyPath = { from: T0, to: T0 + 2 * 3600, step: { moon: 3600, others: DAY }, bodies: { moon: [100, 100.5, 101] } };
    expect(lonAt(p, "Moon", T0 + 5400)).toBe(100.75);
  });

  it("treats the last sample as `to`, however short the last step", () => {
    // Daily samples, a trip of a day and a half: samples at 0, 1 and 1.5 days.
    const p: SkyPath = { from: T0, to: T0 + 1.5 * DAY, step: { moon: 3600, others: DAY }, bodies: { jupiter: [0, 10, 15] } };
    expect(lonAt(p, "Jupiter", T0 + 1.25 * DAY)).toBe(12.5);
    expect(lonAt(p, "Jupiter", T0 + 1.5 * DAY)).toBe(15);
  });

  it("holds at the nearer end outside the path, and knows no body it wasn't sent", () => {
    const p = path({ saturn: [5, 6] }, 1);
    expect(lonAt(p, "Saturn", T0 - 3600)).toBe(5);
    expect(lonAt(p, "Saturn", T0 + 2 * DAY)).toBe(6);
    expect(lonAt(p, "Pluto", T0)).toBeNull();
  });
});

describe("the trip's length (8.11: 420 to 1,500ms by distance)", () => {
  it("is 420ms for a moment close by", () => {
    expect(travelMs(T0, T0)).toBe(420);
    expect(travelMs(T0, T0 + 3600)).toBe(421);
  });
  it("is 960ms halfway to 45 days, and 1,500ms at 45 days or more", () => {
    expect(travelMs(T0, T0 + 22.5 * DAY)).toBe(960);
    expect(travelMs(T0, T0 + 45 * DAY)).toBe(1500);
    expect(travelMs(T0, T0 + 90 * DAY)).toBe(1500);
  });
  it("is the same either way, out and back", () => {
    expect(travelMs(T0 + 10 * DAY, T0)).toBe(travelMs(T0, T0 + 10 * DAY));
  });
});

describe("the easing and the moment it shows", () => {
  it("eases in and out, as the Orrery does", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.25)).toBe(0.0625);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(0.75)).toBe(0.9375);
    expect(easeInOut(1)).toBe(1);
  });
  it("starts at the start, ends at the end, and says when it's done", () => {
    expect(travelAt(T0, T0 + 10 * DAY, 0, 1000)).toEqual({ t: T0, done: false });
    expect(travelAt(T0, T0 + 10 * DAY, 500, 1000)).toEqual({ t: T0 + 5 * DAY, done: false });
    expect(travelAt(T0, T0 + 10 * DAY, 1000, 1000)).toEqual({ t: T0 + 10 * DAY, done: true });
    expect(travelAt(T0, T0 + 10 * DAY, 4000, 1000)).toEqual({ t: T0 + 10 * DAY, done: true });
  });
  it("travels back as well as out", () => {
    expect(travelAt(T0 + 10 * DAY, T0, 250, 1000).t).toBe(T0 + 10 * DAY - 0.0625 * 10 * DAY);
  });
});

describe("the trip's clock (8.11: paused while the tab is hidden)", () => {
  it("starts at nothing, then follows the frames", () => {
    expect(nextElapsed(0, null, 1000)).toBe(0);
    expect(nextElapsed(0, 1000, 1016)).toBe(16);
    expect(nextElapsed(16, 1016, 1033)).toBe(33);
  });
  it("advances at most 50ms a frame, so a hidden tab picks up where it stopped", () => {
    // Ten seconds without frames: the trip moves on by one short frame.
    expect(nextElapsed(200, 1000, 11_000)).toBe(250);
  });
  it("never runs backward", () => {
    expect(nextElapsed(200, 1000, 990)).toBe(200);
  });
});
