import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { nasaLogFrom, patchStorms } from "@/lib/space/compact";
import { synthCompact } from "@/lib/space/synthLog";
import { zoneClock } from "@/lib/zone";
import { nightsCondition } from "./conditions";
import { computeAnswers, nasaNights } from "./engine";
import { answersPayload } from "./payload";

const at = (iso: string) => Date.parse(iso) / 1000;
/** A night by its date: the one that starts at 4 a.m. local that day. */
const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

describe("NASA's nights (spec 7.3)", () => {
  const log = (kp: [string, number][], xflares: [string, string][] = []) =>
    nasaLogFrom(synthCompact("2026-09-30T12:00:00Z", { kp, xflares }))!;
  const chicago = zoneClock("America/Chicago", at("2024-01-01T00:00:00Z"), at("2025-01-01T00:00:00Z"));
  const tokyo = zoneClock("Asia/Tokyo", at("2024-01-01T00:00:00Z"), at("2025-01-01T00:00:00Z"));
  const all = [night("2024-01-01"), night("2024-12-31")] as const;

  it("counts a storm on every night its 3-hour reading overlaps", () => {
    // In Chicago, CDT (UTC-5). Each reading covers the 3 hours before it.
    expect(nasaNights("storms", log([["2024-05-11T00:00:00Z", 9]]), chicago, ...all)).toEqual([night("2024-05-10")]); // 4 to 7 p.m.
    expect(nasaNights("storms", log([["2024-05-11T09:00:00Z", 9]]), chicago, ...all)).toEqual([night("2024-05-10")]); // 1 to 4 a.m.
    expect(nasaNights("storms", log([["2024-05-11T10:00:00Z", 9]]), chicago, ...all)).toEqual([
      night("2024-05-10"),
      night("2024-05-11"),
    ]); // 2 to 5 a.m., across the 4 a.m. line
  });

  it("counts an early storm's first reading on its own night only: the storm began then", () => {
    // 09:30 UTC is 4:30 a.m. CDT on Jun 7, just after the 4 a.m. line. Read
    // as the end of a 3-hour window, it would reach back into Jun 6's night,
    // before the storm began.
    const c = synthCompact("2026-09-30T12:00:00Z");
    patchStorms(
      c,
      "2013-06",
      [{ id: "a", start: "2013-06-07T09:30:00Z", readings: [{ time: "2013-06-07T09:30:00Z", kp: 6 }] }],
      "2026-09-30T12:00:00.000Z",
    );
    const clock = zoneClock("America/Chicago", at("2013-01-01T00:00:00Z"), at("2014-01-01T00:00:00Z"));
    expect(nasaNights("storms", nasaLogFrom(c)!, clock, night("2013-01-01"), night("2013-12-31"))).toEqual([night("2013-06-07")]);
  });

  it("counts a flare on the night of its peak, in the listener's zone", () => {
    const flare = log([], [["2024-05-11T01:23:00Z", "X5.8"]]);
    expect(nasaNights("flares", flare, chicago, ...all)).toEqual([night("2024-05-10")]); // 8:23 p.m. CDT
    expect(nasaNights("flares", flare, tokyo, ...all)).toEqual([night("2024-05-11")]); // 10:23 a.m. JST
  });

  it("counts only the nights it's asked about", () => {
    const two = log([["2024-05-11T10:00:00Z", 9]]);
    expect(nasaNights("storms", two, chicago, night("2024-05-11"), night("2024-12-31"))).toEqual([night("2024-05-11")]);
    expect(nasaNights("storms", two, chicago, night("2024-01-01"), night("2024-05-10"))).toEqual([night("2024-05-10")]);
  });

  it("makes consecutive nights one event, each night a window from 4 a.m. to 4 a.m.", () => {
    const c = nightsCondition([night("2024-05-11"), night("2024-05-10"), night("2024-05-10"), night("2024-05-13")], chicago);
    expect(c.eventCount).toBe(2);
    expect(c.windows).toEqual([
      { start: at("2024-05-10T09:00:00Z"), end: at("2024-05-11T09:00:00Z") - 1, event: 0 },
      { start: at("2024-05-11T09:00:00Z"), end: at("2024-05-12T09:00:00Z") - 1, event: 0 },
      { start: at("2024-05-13T09:00:00Z"), end: at("2024-05-14T09:00:00Z") - 1, event: 1 },
    ]);
  });
});

describe("questions 7 and 8 against the log", () => {
  // A play at 02:00 and 20:00 UTC every day, so every night holds a play.
  const plays: Scrobble[] = [];
  for (let t = at("2009-01-01T00:00:00Z"); t <= at("2026-09-30T00:00:00Z"); t += 86_400) {
    plays.push({ uts: t + 2 * 3600, artist: "A", track: "late" }, { uts: t + 20 * 3600, artist: "B", track: "early" });
  }
  const refreshed = "2026-09-30T12:00:00Z";
  const answer = (kp: [string, number][], xflares: [string, string][] = []) =>
    computeAnswers("nasa-test", plays, "UTC", 0, nasaLogFrom(synthCompact(refreshed, { kp, xflares })));

  it("tests only whole nights inside NASA's coverage: from its first records to 3 days before its refresh", () => {
    const record = answer([
      ["2009-06-01T03:00:00Z", 7], // before DONKI's log starts
      ["2012-03-09T03:00:00Z", 8],
      ["2015-03-17T21:00:00Z", 7.67],
      ["2015-03-18T00:00:00Z", 7.67], // the same night
      ["2015-06-22T21:00:00Z", 8.33],
      ["2015-06-23T06:00:00Z", 7.33], // the next night: one event, two nights
      ["2026-09-28T12:00:00Z", 6], // NASA's last 3 days: not logged yet
    ]);
    const storms = record.questions.find((q) => q.id === "storms")!;
    expect(record.nasaStamp).toMatch(/^2026-09-27\|/);
    expect(storms.notChecked).toBeNull();
    // DONKI's storm log starts at midnight UTC on Apr 5, 2010, partway through
    // Apr 4's night; coverage ends at the start of Sept 27, partway through
    // Sept 26's. Only the whole nights between are tested.
    expect(storms.spanStart).toBe(at("2010-04-05T04:00:00Z"));
    expect(storms.spanEnd).toBe(at("2026-09-26T04:00:00Z") - 1);
    expect(storms.events).toBe(3);
    expect(storms.merged).toHaveLength(1);
    expect(storms.merged[0].windows.map((w) => w.start)).toEqual([at("2015-06-22T04:00:00Z"), at("2015-06-23T04:00:00Z")]);

    // The same storm a week earlier is inside, and counts.
    const earlier = answer([["2026-09-20T12:00:00Z", 6]]).questions.find((q) => q.id === "storms")!;
    expect(earlier.events).toBe(1);
  });

  it("shows no early read for a night outside NASA's coverage", () => {
    // A play every 2 minutes from Aug 1 to Sept 30, 2026 (720 a night, over
    // the 500 a read needs), and storms on Sept 9's night (covered) and Sept
    // 28's (inside NASA's 3-day lag).
    const dense: Scrobble[] = [];
    for (let t = at("2026-08-01T00:00:00Z"); t <= at("2026-09-30T23:00:00Z"); t += 120) dense.push({ uts: t, artist: "A", track: "x" });
    const record = computeAnswers(
      "nasa-edge",
      dense,
      "UTC",
      0,
      nasaLogFrom(
        synthCompact(refreshed, {
          kp: [
            ["2026-09-09T12:00:00Z", 6],
            ["2026-09-28T12:00:00Z", 6],
          ],
        }),
      ),
    );
    const storms = record.questions.find((q) => q.id === "storms")!;
    expect(storms.earlyReads.map((r) => new Date(r.start * 1000).toISOString())).toEqual(["2026-09-09T04:00:00.000Z"]);
  });

  it("counts X-flare nights from the flare log's own start", () => {
    const flares = answer(
      [],
      [
        ["2010-04-04T12:00:00Z", "X1.0"], // after the flare log starts, before the storm log does
        ["2017-09-06T12:02:00Z", "X9.3"],
        ["2017-09-10T16:06:00Z", "X8.2"],
      ],
    ).questions.find((q) => q.id === "flares")!;
    expect(flares.spanStart).toBe(at("2010-04-03T04:00:00Z"));
    expect(flares.events).toBe(3);
  });

  it("phrases them with no events note and no next start: NASA can't say when the next storm comes", () => {
    // A two-night storm every 20 days, enough plays for a verdict.
    const kp: [string, number][] = [];
    for (let t = at("2011-01-01T00:00:00Z"); t < at("2026-09-01T00:00:00Z"); t += 20 * 86_400) {
      const day = new Date(t * 1000).toISOString().slice(0, 10);
      kp.push([`${day}T21:00:00Z`, 7], [new Date((t + 86_400) * 1000).toISOString().slice(0, 10) + "T06:00:00Z", 6]);
    }
    const payload = answersPayload(answer(kp), "ready", Date.parse("2026-10-01T00:00:00Z"));
    const storms = payload.questions.find((q) => q.id === "storms")!;
    expect(payload.nasaStamp).toMatch(/^2026-09-27\|/);
    expect(storms.status).not.toBe("too-few-plays");
    expect(storms.events).toBeGreaterThan(200);
    expect(storms.eventsNote).toBeNull();
    expect(storms.nextStart).toBeNull();
  });

  it("leaves both not checked without a log, and stamps none", () => {
    const record = computeAnswers("nasa-test", plays, "UTC", 0, null);
    expect(record.nasaStamp).toBeNull();
    expect(record.questions.filter((q) => q.notChecked === "nasa").map((q) => q.id)).toEqual(["storms", "flares"]);
  });
});
