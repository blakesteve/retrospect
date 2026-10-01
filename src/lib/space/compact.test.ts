import { describe, expect, it } from "vitest";
import { emptyCompact, nasaLogFrom, patchFlares, patchStorms } from "./compact";
import { synthCompact } from "./synthLog";
import { sdoDays } from "./work";

const at = (iso: string) => Date.parse(iso) / 1000;
const READ = "2026-10-01T12:00:00.000Z";

describe("the compact storm and flare log", () => {
  it("keeps the span each Kp reading covers, X flares only, and when each month was read", () => {
    const c = emptyCompact();
    patchStorms(
      c,
      "2024-05",
      [
        {
          id: "2024-05-10T15:00:00-GST-001",
          start: "2024-05-10T15:00:00Z",
          readings: [
            { time: "2024-05-10T18:00:00Z", kp: 8.33 },
            { time: "2024-05-10T21:00:00Z", kp: 9 },
          ],
        },
      ],
      READ,
    );
    patchFlares(
      c,
      "2024-05",
      [
        { id: "a", peak: "2024-05-14T16:51:00Z", class: "X8.7" },
        { id: "b", peak: "2024-05-14T12:00:00Z", class: "M9.9" },
        { id: "c", peak: "2024-05-15T08:00:00Z", class: "C1.0" },
      ],
      READ,
    );
    expect(c.kp["2024-05"]).toEqual([
      [at("2024-05-10T15:00:00Z"), at("2024-05-10T18:00:00Z"), 8.33],
      [at("2024-05-10T18:00:00Z"), at("2024-05-10T21:00:00Z"), 9],
    ]);
    expect(c.xflares["2024-05"]).toEqual([[at("2024-05-14T16:51:00Z"), "X8.7"]]);
    expect(c.starts["2024-05"]).toEqual([at("2024-05-10T15:00:00Z")]);
    expect([c.kpAt["2024-05"], c.xflaresAt["2024-05"]]).toEqual([READ, READ]);
    // A refreshed month replaces what was there.
    patchStorms(c, "2024-05", [], "2026-10-02T00:00:00.000Z");
    expect(c.kp["2024-05"]).toEqual([]);
    expect(c.kpAt["2024-05"]).toBe("2026-10-02T00:00:00.000Z");
  });

  it("never lets a reading cover time before its storm began", () => {
    // As DONKI has them: a 2011 storm's first reading is the moment it began,
    // off the 3-hour grid, and its next ends a window that opened before it.
    // A 2013 one starts on the grid with a reading at its start.
    const c = emptyCompact();
    patchStorms(
      c,
      "2011-08",
      [
        {
          id: "2011-08-05T20:57:00-GST-001",
          start: "2011-08-05T20:57:00Z",
          readings: [
            { time: "2011-08-05T20:57:00Z", kp: 6 },
            { time: "2011-08-05T21:00:00Z", kp: 8 },
            { time: "2011-08-06T00:00:00Z", kp: 7 },
          ],
        },
        { id: "b", start: "2011-08-20T15:52:00Z", readings: [{ time: "2011-08-20T16:30:00Z", kp: 6 }] },
      ],
      READ,
    );
    patchStorms(c, "2013-06", [{ id: "c", start: "2013-06-07T03:00:00Z", readings: [{ time: "2013-06-07T03:00:00Z", kp: 6 }] }], READ);
    // A few records have a reading before their own start: it keeps its 3 hours.
    patchStorms(c, "2015-06", [{ id: "d", start: "2015-06-22T18:00:00Z", readings: [{ time: "2015-06-22T06:00:00Z", kp: 6 }] }], READ);
    expect(c.kp["2011-08"]).toEqual([
      [at("2011-08-05T20:57:00Z"), at("2011-08-05T20:57:00Z"), 6],
      [at("2011-08-05T20:57:00Z"), at("2011-08-05T21:00:00Z"), 8],
      [at("2011-08-05T21:00:00Z"), at("2011-08-06T00:00:00Z"), 7],
      [at("2011-08-20T15:52:00Z"), at("2011-08-20T16:30:00Z"), 6],
    ]);
    expect(c.kp["2013-06"]).toEqual([[at("2013-06-07T03:00:00Z"), at("2013-06-07T03:00:00Z"), 6]]);
    expect(c.kp["2015-06"]).toEqual([[at("2015-06-22T03:00:00Z"), at("2015-06-22T06:00:00Z"), 6]]);
  });

  it("isn't a log until every month from DONKI's start to its refresh is in it", () => {
    const whole = synthCompact("2026-10-01T12:00:00Z");
    expect(nasaLogFrom(whole)).not.toBeNull();
    expect(nasaLogFrom(null)).toBeNull();
    expect(nasaLogFrom({ ...whole, refreshedAt: "" })).toBeNull();
    for (const [list, month] of [
      ["kp", "2010-04"],
      ["kp", "2017-09"],
      ["kp", "2026-10"],
      ["xflares", "2010-04"],
      ["xflares", "2026-10"],
    ] as const) {
      const holed = synthCompact("2026-10-01T12:00:00Z");
      delete holed[list][month];
      expect(nasaLogFrom(holed), `${list} ${month}`).toBeNull();
    }
    // A month before DONKI starts isn't needed.
    const early = synthCompact("2026-10-01T12:00:00Z");
    delete early.kp["2010-03"];
    expect(nasaLogFrom(early)).not.toBeNull();
  });

  it("starts each log at DONKI's first records, ends it 3 days before the refresh, and sorts across months", () => {
    const log = nasaLogFrom(
      synthCompact("2026-10-01T12:00:00Z", {
        kp: [
          ["2024-05-11T03:00:00Z", 9],
          ["2015-03-17T21:00:00Z", 7.67],
        ],
        xflares: [
          ["2024-10-03T12:18:00Z", "X9.0"],
          ["2017-09-06T12:02:00Z", "X9.3"],
        ],
      }),
    )!;
    expect(log.refreshedAt).toBe(at("2026-10-01T12:00:00Z"));
    // The start of the UTC day 3 days before the refresh.
    expect(log.coveredUntil).toBe(at("2026-09-28T00:00:00Z"));
    expect(log.stormsFrom).toBe(at("2010-04-05T00:00:00Z"));
    expect(log.flaresFrom).toBe(at("2010-04-03T00:00:00Z"));
    expect(log.kp).toEqual([
      [at("2015-03-17T18:00:00Z"), at("2015-03-17T21:00:00Z"), 7.67],
      [at("2024-05-11T00:00:00Z"), at("2024-05-11T03:00:00Z"), 9],
    ]);
    expect(log.xflares.map(([, cls]) => cls)).toEqual(["X9.3", "X9.0"]);
    // synthCompact keeps no storms, only readings.
    expect(log.stormStarts).toEqual([]);
  });

  it("moves its stamp at most daily, or when what NASA logged changes", () => {
    const stamp = (refreshed: string, kp: [string, number][] = []) => nasaLogFrom(synthCompact(refreshed, { kp }))!.stamp;
    const morning = stamp("2026-10-01T03:00:00Z");
    expect(morning).toMatch(/^2026-09-28\|[0-9a-f]{8}$/);
    // Refreshed all day with nothing new: the same stamp, so stored answers stand.
    expect(stamp("2026-10-01T21:00:00Z")).toBe(morning);
    // A new storm, or the next day, moves it.
    expect(stamp("2026-10-01T21:00:00Z", [["2026-09-30T21:00:00Z", 6]])).not.toBe(morning);
    expect(stamp("2026-10-02T00:30:00Z")).toMatch(/^2026-09-29\|/);
    // A log that gains storms' starts moves it too: records built before say 0 storms.
    const withStarts = synthCompact("2026-10-01T21:00:00Z");
    withStarts.starts["2024-05"] = [Date.parse("2024-05-10T15:00:00Z") / 1000];
    expect(nasaLogFrom(withStarts)!.stamp).not.toBe(morning);
  });
});

describe("the days that need a picture of the Sun", () => {
  it("aims at the middle of the day's strongest reading, or an X flare's peak", () => {
    const days = sdoDays(
      synthCompact("2026-10-01T12:00:00Z", {
        kp: [
          ["2024-05-10T18:00:00Z", 8.33],
          ["2024-05-10T21:00:00Z", 9],
          // Its 3 hours run 22:00 to 01:00, so its middle is the day before.
          ["2023-04-24T01:00:00Z", 7.33],
          ["2024-10-10T21:00:00Z", 8.67],
        ],
        xflares: [["2024-10-10T03:30:00Z", "X1.8"]],
      }),
    );
    expect(Object.fromEntries(days)).toEqual({
      "2024-05-10": "2024-05-10T19:30:00.000Z",
      "2023-04-23": "2023-04-23T23:30:00.000Z",
      // The flare wins its day over a stronger storm.
      "2024-10-10": "2024-10-10T03:30:00.000Z",
    });
  });
});
