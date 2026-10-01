import { describe, expect, it } from "vitest";
import { aboutMeters, dateIn, lunarDistanceWords, nightDate, spelled, timeIn } from "./words";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("times and dates as the redesign writes them (spec 9.2)", () => {
  it("writes times with a.m., p.m. and the zone", () => {
    expect(timeIn("America/Chicago", at("2024-10-03T12:18:00Z"))).toBe("7:18 a.m. CDT");
    expect(timeIn("America/Chicago", at("2024-12-03T06:05:00Z"))).toBe("12:05 a.m. CST");
    expect(timeIn("America/Chicago", at("2024-05-11T03:22:00Z"))).toBe("10:22 p.m. CDT");
    expect(timeIn("Europe/Berlin", at("2024-07-01T12:00:00Z"))).toBe("2:00 p.m. GMT+2");
    expect(timeIn("UTC", at("2024-07-01T00:00:00Z"))).toBe("12:00 a.m. UTC");
  });

  it("writes Sept, not Sep, and dates in the zone", () => {
    expect(dateIn("America/Chicago", at("2024-09-07T12:00:00Z"))).toBe("Sept 7, 2024");
    // 1 a.m. UTC on Oct 4 is still Oct 3 in Chicago.
    expect(dateIn("America/Chicago", at("2024-10-04T01:00:00Z"))).toBe("Oct 3, 2024");
    expect(nightDate("2024-09-30")).toBe("Sept 30, 2024");
  });

  it("writes sizes, distances and small numbers", () => {
    expect([aboutMeters(141.4), aboutMeters(8.4), aboutMeters(1_234), aboutMeters(0.4)]).toEqual([
      "about 140 m",
      "about 8 m",
      "about 1,200 m",
      "under 1 m",
    ]);
    expect([lunarDistanceWords(0.767), lunarDistanceWords(1.04), lunarDistanceWords(12.6)]).toEqual([
      "0.8 lunar distances",
      "1.0 lunar distance",
      "13 lunar distances",
    ]);
    expect([spelled(5), spelled(10), spelled(1_234)]).toEqual(["five", "10", "1,234"]);
  });
});
