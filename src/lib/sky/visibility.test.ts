import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cities from "@/data/tz/cities.json";
import { parseCoordinates, parseLinks, parseZoneTab } from "./tzTables";
import { cityOf, eclipseView, eclipseVisible, findCity } from "./visibility";

/* The wild nights' eclipse ranking (spec 7.5, changed 2 Oct 2026). The
   expected numbers are 7.5's, measured from Chicago with astronomy-engine:
   Apr 8, 2024 covered 93.9% of the Sun and Oct 14, 2023 42.9%; Aug 12, 2026
   0.08%; Oct 2, 2024 and Feb 17, 2026 weren't visible at all; the Moon was
   up for Mar 14, 2025 (48°) and Mar 3, 2026 (9°), down for Sept 7, 2025
   (-54°). The peaks are the sky data's greatest eclipse. */

const at = (iso: string) => Date.parse(iso) / 1000;
const DIR = path.resolve(__dirname, "../../data/tz");

describe("each zone's principal city (zone.tab, then zone1970.tab, tzdata 2026b)", () => {
  it("reads ISO 6709, with and without seconds", () => {
    expect(parseCoordinates("+415100-0873900")).toEqual([41.85, -87.65]); // Chicago
    expect(parseCoordinates("+2232+08822")).toEqual([22.5333, 88.3667]); // Kolkata
    expect(parseCoordinates("-3352+15113")).toEqual([-33.8667, 151.2167]); // Sydney
    expect(() => parseCoordinates("4151-08739")).toThrow();
  });

  it("finds Chicago for America/Chicago", () => {
    expect(cityOf("America/Chicago")).toEqual({ lat: 41.85, lon: -87.65 });
  });

  it("finds a zone's own city where zone1970.tab merged it into another country's (ruling, 3 Oct 2026)", () => {
    // zone1970.tab has no Reykjavik, Oslo or Nassau: backward links them to
    // Abidjan, Berlin and Toronto. zone.tab lists each with its own.
    expect(cityOf("Atlantic/Reykjavik")).toEqual({ lat: 64.15, lon: -21.85 });
    expect(cityOf("Europe/Oslo")).toEqual({ lat: 59.9167, lon: 10.75 });
    expect(cityOf("America/Nassau")).toEqual({ lat: 25.0833, lon: -77.35 });
    expect(cities.links["Atlantic/Reykjavik"]).toBe("Africa/Abidjan");
  });

  it("finds a zone under its old name too, both ways round", () => {
    // V8 reports the old names: Asia/Calcutta, Europe/Kiev, Asia/Saigon.
    expect(cityOf("Asia/Kolkata")).toEqual({ lat: 22.5333, lon: 88.3667 });
    expect(cityOf("Asia/Calcutta")).toEqual(cityOf("Asia/Kolkata"));
    expect(cityOf("Europe/Kyiv")).toEqual({ lat: 50.4333, lon: 30.5167 });
    expect(cityOf("Europe/Kiev")).toEqual(cityOf("Europe/Kyiv"));
    expect(cityOf("Asia/Saigon")).toEqual(cityOf("Asia/Ho_Chi_Minh"));
    expect(cityOf("US/Central")).toEqual(cityOf("America/Chicago"));
  });

  it("follows a link the other way, for a table that lists a zone under an old name", () => {
    // 2026b lists every linked zone under its new name, so a made-up table.
    const table: Record<string, [number, number]> = { "Old/Name": [1, 2] };
    expect(findCity("New/Name", table, { "Old/Name": "New/Name" })).toEqual({ lat: 1, lon: 2 });
    expect(findCity("Old/Name", { "New/Name": [3, 4] }, { "Old/Name": "New/Name" })).toEqual({ lat: 3, lon: 4 });
    expect(findCity("Other/Name", table, { "Old/Name": "New/Name" })).toBeNull();
  });

  it("has none for UTC and Etc zones, or a name it doesn't know", () => {
    for (const z of ["UTC", "Etc/UTC", "Etc/GMT+5", "Etc/GMT", "Nowhere/Atlantis"]) expect(cityOf(z), z).toBeNull();
  });

  it("is the committed tables, as scripts/zone-cities.mjs wrote them", () => {
    expect(cities.byCountry).toEqual(parseZoneTab(readFileSync(path.join(DIR, "zone.tab"), "utf8")));
    expect(Object.keys(cities.byCountry).length).toBeGreaterThan(400);
    expect(cities.cities).toEqual(parseZoneTab(readFileSync(path.join(DIR, "zone1970.tab"), "utf8")));
    expect(cities.links).toEqual(parseLinks(readFileSync(path.join(DIR, "backward"), "utf8")));
    // Reach: the whole table and its links were read.
    expect(Object.keys(cities.cities).length).toBeGreaterThan(300);
    expect(Object.keys(cities.links).length).toBeGreaterThan(200);
    expect(cities.links["Asia/Calcutta"]).toBe("Asia/Kolkata");
  });
});

describe("whether an eclipse was seen from the zone (7.5)", () => {
  const CHICAGO = "America/Chicago";

  it("measures the solar eclipses from Chicago as 7.5 does", () => {
    const apr8 = eclipseView(CHICAGO, "total solar", at("2024-04-08T18:17:19Z"));
    expect(apr8.obscuration! * 100).toBeCloseTo(93.9, 1);
    expect(apr8.visible).toBe(true);
    const oct14 = eclipseView(CHICAGO, "annular solar", at("2023-10-14T17:59:27Z"));
    expect(oct14.obscuration! * 100).toBeCloseTo(42.9, 1);
    expect(oct14.visible).toBe(true);
    const aug12 = eclipseView(CHICAGO, "total solar", at("2026-08-12T17:45:47Z"));
    expect(aug12.obscuration! * 100).toBeCloseTo(0.08, 2);
    expect(aug12.visible).toBe(false);
    // Not reaching Chicago at all: the local search finds a later eclipse.
    expect(eclipseView(CHICAGO, "annular solar", at("2024-10-02T18:44:56Z"))).toEqual({ obscuration: 0, altitude: null, visible: false });
    expect(eclipseView(CHICAGO, "annular solar", at("2026-02-17T12:11:54Z"))).toEqual({ obscuration: 0, altitude: null, visible: false });
  });

  it("sees Aug 12, 2026 from Reykjavik, where it was total (ruling, 3 Oct 2026)", () => {
    const reykjavik = eclipseView("Atlantic/Reykjavik", "total solar", at("2026-08-12T17:45:47Z"));
    expect(reykjavik.obscuration!).toBeGreaterThan(0.99);
    expect(reykjavik.altitude!).toBeCloseTo(24.5, 0);
    expect(reykjavik.visible).toBe(true);
    expect(eclipseVisible("Atlantic/Reykjavik", "total solar", at("2026-08-12T17:45:47Z"))).toBe(true);
  });

  it("sees from another zone what Chicago didn't", () => {
    // Aug 12, 2026 from Madrid: nearly total, the Sun low in the west (review, 3 Oct 2026).
    const madrid = eclipseView("Europe/Madrid", "total solar", at("2026-08-12T17:45:47Z"));
    expect(madrid.obscuration!).toBeGreaterThan(0.99);
    expect(madrid.altitude!).toBeCloseTo(7.3, 0);
    expect(madrid.visible).toBe(true);
  });

  it("asks whether the Moon was up at a lunar eclipse's greatest moment", () => {
    const up = (iso: string) => eclipseView(CHICAGO, "total lunar", at(iso));
    expect(up("2025-03-14T06:58:42Z").altitude!).toBeCloseTo(48, 0);
    expect(up("2025-03-14T06:58:42Z").visible).toBe(true);
    expect(up("2026-03-03T11:33:40Z").altitude!).toBeCloseTo(9, 0);
    expect(up("2026-03-03T11:33:40Z").visible).toBe(true);
    expect(up("2025-09-07T18:11:42Z").altitude!).toBeCloseTo(-54, 0);
    expect(up("2025-09-07T18:11:42Z").visible).toBe(false);
  });

  it("reads an old zone name as its city does", () => {
    // Mar 14, 2025: the Moon over the Western Hemisphere, below Kolkata's horizon.
    const peak = at("2025-03-14T06:58:42Z");
    expect(eclipseVisible("Asia/Calcutta", "total lunar", peak)).toBe(false);
    expect(eclipseView("Asia/Calcutta", "total lunar", peak)).toEqual(eclipseView("Asia/Kolkata", "total lunar", peak));
    expect(eclipseView("Europe/Kiev", "total lunar", at("2025-09-07T18:11:42Z"))).toEqual(
      eclipseView("Europe/Kyiv", "total lunar", at("2025-09-07T18:11:42Z")),
    );
    // Sept 7, 2025 was seen across Asia and Europe, Kyiv's Moon up.
    expect(eclipseVisible("Europe/Kiev", "total lunar", at("2025-09-07T18:11:42Z"))).toBe(true);
  });

  it("treats every eclipse as seen from a zone with no city", () => {
    for (const [kind, peak] of [
      ["total solar", "2026-08-12T17:45:47Z"],
      ["annular solar", "2024-10-02T18:44:56Z"],
      ["total lunar", "2025-09-07T18:11:42Z"],
    ]) {
      expect(eclipseVisible("UTC", kind, at(peak)), peak).toBe(true);
      expect(eclipseVisible("Etc/GMT+5", kind, at(peak)), peak).toBe(true);
    }
  });
});
