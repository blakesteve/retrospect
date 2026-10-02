import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { nasaLogFrom } from "@/lib/space/compact";
import { forgetFinalMonths, writeMonth, writeSpaceJson, type SpaceMonth, type SpaceSource, type SpaceRecords } from "@/lib/space/store";
import { synthCompact } from "@/lib/space/synthLog";
import { nightName, zoneClock } from "@/lib/zone";
import { flareSize, lunarDistances, metersFromH, spaceNights, zoneLongitude } from "./spaceNights";

const at = (iso: string) => Date.parse(iso) / 1000;
const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const chicago = zoneClock("America/Chicago", at("2009-01-01T00:00:00Z"), at("2025-12-31T00:00:00Z"));

const month = <S extends SpaceSource>(source: S, m: string, records: SpaceRecords[S][]): SpaceMonth<S> => ({
  source,
  month: m,
  firstDate: "x",
  refreshedAt: "2026-10-01T00:00:00.000Z",
  records,
});

beforeEach(async () => {
  forgetFinalMonths();
  setBlobStore(new MemoryBlobStore());
  await writeMonth(
    month("jpl-cad", "2024-06", [
      { name: "2024 MK", time: "2024-06-29T13:49:00Z", au: 0.00197, h: 22 },
      { name: "far one", time: "2024-06-29T20:00:00Z", au: 0.04, h: 25 },
      { name: "2024 XX", time: "2024-06-30T12:00:00Z", au: 0.01, h: null },
      { name: "just out", time: "2024-06-30T13:00:00Z", au: 0.0101, h: 26 },
    ]),
  );
  await writeMonth(month("jpl-fireball", "2024-06", [{ time: "2024-06-29T23:30:00Z", kt: 0.2 }]));
  await writeMonth(
    month("donki-flr", "2024-06", [
      { id: "a", peak: "2024-06-29T15:00:00Z", class: "M9.9" },
      { id: "b", peak: "2024-06-29T18:00:00Z", class: "C3.0" },
    ]),
  );
  await writeMonth(
    month("epic", "2024-06", [
      {
        date: "2024-06-29",
        images: [
          { name: "east", time: "2024-06-29T00:30:00Z", lat: 0, lon: 120 },
          { name: "west", time: "2024-06-29T08:30:00Z", lat: 0, lon: -80 },
        ],
      },
      { date: "2024-06-28", images: [] },
    ]),
  );
  await writeSpaceJson("space/epic-done.json", { days: ["2024-06-28", "2024-06-29"] });
});
afterEach(() => setBlobStore(null));

describe("NASA's facts for a night (spec 7.3, 7.4)", () => {
  const log = nasaLogFrom(
    synthCompact("2026-10-01T12:00:00Z", {
      kp: [
        ["2024-06-29T21:00:00Z", 6.33], // 4 to 7 p.m. CDT on Jun 29
        ["2024-06-30T00:00:00Z", 7.67], // 7 to 10 p.m.: the night's highest
      ],
      xflares: [["2024-06-29T16:00:00Z", "X1.1"]],
    }),
  )!;

  it("gives the night's highest Kp, the biggest flare, the nearest asteroid and its fireballs", async () => {
    const nights = await spaceNights(chicago, night("2024-06-28"), night("2024-06-30"), log, { allFlares: true, epic: true, longitude: -90 });
    const jun29 = nights.get(night("2024-06-29"))!;
    expect(jun29).toMatchObject({
      known: { storms: true, flares: true, asteroids: true, fireballs: true },
      kp: 7.67,
      stormGrade: "G4",
      // The log's X1.1 counts though the month file lacks it: every endpoint agrees on X flares.
      biggestFlare: "X1.1",
      xFlare: true,
      asteroid: { name: "2024 MK", time: at("2024-06-29T13:49:00Z") },
      fireballs: [{ time: at("2024-06-29T23:30:00Z"), kt: 0.2 }],
      epic: {
        url: "https://epic.gsfc.nasa.gov/archive/natural/2024/06/29/jpg/west.jpg",
        time: "2024-06-29T08:30:00Z",
        credit: "NASA EPIC team",
      },
    });
    expect(jun29.asteroid!.ld).toBeCloseTo(0.7667, 4);
    expect(jun29.asteroid!.meters).toBeCloseTo(141.4, 1);
    // Jun 30's night has the 0.01 AU pass, with no size.
    expect(nights.get(night("2024-06-30"))!.asteroid).toMatchObject({ name: "2024 XX", meters: null });
    // Flybys count passes within 0.01 AU (7.3): 2024 MK, and 2024 XX at exactly 0.01.
    expect([jun29.flybys, nights.get(night("2024-06-30"))!.flybys]).toEqual([1, 1]);
    // EPIC listed Jun 28 with no photo: none. Jun 30 isn't read yet: unknown.
    expect(nights.get(night("2024-06-28"))!.epic).toBe("none");
    expect(nights.get(night("2024-06-30"))!.epic).toBe("unknown");
    // A quiet night: checked, and nothing.
    expect(nights.get(night("2024-06-28"))).toMatchObject({ kp: null, stormGrade: null, biggestFlare: null, asteroid: null, fireballs: [] });
  });

  it("calls an EPIC date none only when EPIC's own list has passed it", async () => {
    // EPIC lists Jun 29 and Jul 2; Jun 28 was read with no photo; Jul 1 isn't
    // listed (none); Jul 2 is listed but not read yet (unknown); Jul 4 is
    // after the list (unknown).
    await writeSpaceJson("space/epic-done.json", { days: ["2024-06-28", "2024-06-29"], available: ["2024-06-28", "2024-06-29", "2024-07-02"] });
    const nights = await spaceNights(chicago, night("2024-06-28"), night("2024-07-04"), log, { epic: true, longitude: -90 });
    const epic = (d: string) => nights.get(night(d))!.epic;
    expect([epic("2024-06-28"), epic("2024-07-01"), epic("2024-07-02"), epic("2024-07-04")]).toEqual(["none", "none", "unknown", "unknown"]);
    expect(epic("2024-06-29")).toMatchObject({ credit: "NASA EPIC team" });
  });

  it("takes the log's X flares when it doesn't read every flare", async () => {
    const nights = await spaceNights(chicago, night("2024-06-29"), night("2024-06-29"), log);
    expect(nights.get(night("2024-06-29"))).toMatchObject({ biggestFlare: "X1.1", xFlare: true, epic: "unknown" });
  });

  it("calls a night before a source's start unknown, never quiet", async () => {
    const nights = await spaceNights(chicago, night("2009-06-01"), night("2009-06-01"), log, { epic: true });
    expect(nights.get(night("2009-06-01"))).toMatchObject({
      known: { storms: false, flares: false, asteroids: false, fireballs: false },
      epic: "unknown",
    });
    // No log at all: storms and flares unknown; a JPL month not stored yet, unknown.
    const none = await spaceNights(chicago, night("2024-07-10"), night("2024-07-10"), null);
    expect(none.get(night("2024-07-10"))!.known).toEqual({ storms: false, flares: false, asteroids: false, fireballs: false });
  });
});

describe("the arithmetic", () => {
  it("measures lunar distances, sizes from H and flare classes", () => {
    expect(lunarDistances(0.01)).toBeCloseTo(3.89, 2); // "about 4 lunar distances" (7.3)
    expect(metersFromH(22)).toBeCloseTo(141.4, 1);
    expect(metersFromH(17.75)).toBeCloseTo(1_000, -1);
    // Six decimals, the same on every Node version (pow's last digits aren't).
    expect(metersFromH(22)).toBe(141.403762);
    expect(["M9.9", "X1.0", "C3.0", "X9.3", "X10"].sort((a, b) => flareSize(b) - flareSize(a))).toEqual(["X10", "X9.3", "X1.0", "M9.9", "C3.0"]);
  });

  it("faces EPIC at the zone's standard offset", () => {
    const lon = (zone: string) => zoneLongitude(zoneClock(zone, at("2024-01-01T00:00:00Z")), 2024);
    expect([lon("America/Chicago"), lon("Australia/Sydney"), lon("Asia/Kolkata"), lon("UTC"), lon("Pacific/Kiritimati")]).toEqual([
      -90, 150, 82.5, 0, -150,
    ]);
    expect(nightName(night("2024-06-29"))).toBe("2024-06-29");
  });
});
