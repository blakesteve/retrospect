import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { computeAnswers, historyStamp, nasaNights } from "@/lib/answers/engine";
import { nightRuns } from "@/lib/answers/nightRuns";
import { answersPayload } from "@/lib/answers/payload";
import { nasaLogFrom } from "@/lib/space/compact";
import { synthCompact } from "@/lib/space/synthLog";
import { zoneClock } from "@/lib/zone";
import { oneCardPerEvent } from "./highlights";
import { LISTENER_VERSION, isCurrentListener, xflaresIn, type ListenerRecord } from "./record";
import type { NasaLog } from "@/lib/space/compact";
import { tagsStamp } from "./serve";

const plays: Scrobble[] = [
  { uts: 1_700_000_000, artist: "Alpha", track: "one" },
  { uts: 1_700_000_600, artist: "Beta", track: "two" },
  { uts: 1_700_001_200, artist: "Alpha", track: "three" },
];

describe("a stored listener record", () => {
  const record = { version: LISTENER_VERSION, stamp: historyStamp(plays), nasaStamp: "2026-09-28|abc", tagged: 2 } as ListenerRecord;

  it("is current only on the same history, NASA log, tags and version", () => {
    // 2: the Surprise me facts are stored (2 Oct 2026). 3: songs carry the
    // Moon, and wild nights rank by whether the zone saw the eclipse. 4: storm
    // runs, X flares counted, and the filters' nights per month (3 Oct 2026).
    expect(LISTENER_VERSION).toBe(4);
    expect(isCurrentListener(record, plays, "2026-09-28|abc", 2)).toBe(true);
    expect(isCurrentListener(record, [...plays, { uts: 1_700_002_000, artist: "Gamma", track: "x" }], "2026-09-28|abc", 2)).toBe(false);
    expect(isCurrentListener(record, plays, "2026-09-29|abc", 2)).toBe(false);
    expect(isCurrentListener(record, plays, null, 2)).toBe(false);
    expect(isCurrentListener(record, plays, "2026-09-28|abc", 3)).toBe(false);
    expect(isCurrentListener({ ...record, version: 0 }, plays, "2026-09-28|abc", 2)).toBe(false);
  });
});

describe("the tag stamp", () => {
  it("stays -1 until every top artist is tagged, so a fetch in progress recomputes nothing", () => {
    expect(tagsStamp(plays, { artists: { alpha: ["indie"] } })).toBe(-1);
    expect(tagsStamp(plays, { artists: { alpha: ["indie"], beta: [] } })).toBe(2);
    // An artist tagged that's no longer a top artist still counts in the stamp.
    expect(tagsStamp(plays, { artists: { alpha: ["indie"], beta: [], gone: ["pop"] } })).toBe(3);
  });
});

describe("a song from the history's first 90 days", () => {
  it("is never news: no chip, no pairing, no question, the first scrobble included", async () => {
    const { MemoryBlobStore, setBlobStore } = await import("@/lib/store/blob");
    const { computeListener } = await import("./record");
    setBlobStore(new MemoryBlobStore());
    // The first scrobble lands inside a Mercury retrograde (Apr 1 to 25, 2024).
    const t0 = Date.parse("2024-04-10T20:00:00Z") / 1000;
    const history: Scrobble[] = [{ uts: t0, artist: "First", track: "ever" }];
    for (let i = 0; i < 12; i++) history.push({ uts: t0 + (200 + i) * 86_400, artist: "Later", track: `song ${i % 3}` });
    const r = await computeListener(history, "America/Chicago", null, { artists: {} }, 0);
    const first = r.songs.row.find((s) => s.firstScrobble)!;
    expect(first).toMatchObject({ early: true, chip: null, highlight: null, pairing: null, pairingFact: null, questionsHeld: [] });
    expect(r.strangest?.songId).not.toBe(first.songId);
    setBlobStore(null);
  });
});

describe("a storm's nights are one event, for the question and the wild row alike (6.2, 7.5)", () => {
  /* One listener in UTC, a play at 8 p.m. every night of 2024 but Mar 4's,
     and NASA's log with four stretches of storm nights (each reading covers
     9 a.m. to noon, inside its date's night):
     - Mar 3 to 5: Kp 8, then Kp 9 on Mar 4, a night with no plays, then Kp 8+;
     - Apr 7 to 9: Kp 8, Kp 8 on Apr 8, which the total solar eclipse heads,
       then Kp 8+;
     - Jun 10 alone, Kp 8;
     - Sept 16 and 17: two storms NASA logged apart, one on each night, Kp 8.
     And X flares under X5 (no wild night): Feb 1 and 2, May 31 (the last
     night of its month) and Oct 3, with one each side of the history. */
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const at = (iso: string) => Date.parse(iso) / 1000;
  const history: Scrobble[] = [];
  for (let d = day("2024-01-01"); d <= day("2024-12-31"); d++) {
    if (d === day("2024-03-04")) continue;
    history.push({ uts: d * 86_400 + 20 * 3600, artist: "Night Owl", track: `song ${d % 7}` });
  }
  const log = () => {
    const c = synthCompact("2026-09-30T12:00:00Z", {
      kp: [
        ["2024-03-03T12:00:00Z", 8],
        ["2024-03-04T12:00:00Z", 9],
        ["2024-03-05T12:00:00Z", 8.33],
        ["2024-04-07T12:00:00Z", 8],
        ["2024-04-08T12:00:00Z", 8],
        ["2024-04-09T12:00:00Z", 8.33],
        ["2024-06-10T12:00:00Z", 8],
        ["2024-09-16T12:00:00Z", 8],
        ["2024-09-17T12:00:00Z", 8],
      ],
      xflares: [
        ["2023-12-31T12:00:00Z", "X1.0"],
        ["2024-02-01T12:00:00Z", "X1.1"],
        ["2024-02-02T12:00:00Z", "X1.2"],
        ["2024-05-31T16:51:00Z", "X1.7"],
        ["2024-10-03T12:18:00Z", "X2.0"],
        ["2025-01-04T12:00:00Z", "X1.1"],
      ],
    });
    // Each storm's start, one before the first play: "NASA logged {n} solar storms in this time".
    c.starts = {
      "2023-12": [at("2023-12-20T09:00:00Z")],
      "2024-03": [at("2024-03-03T09:00:00Z")],
      "2024-04": [at("2024-04-07T09:00:00Z")],
      "2024-06": [at("2024-06-10T09:00:00Z")],
      "2024-09": [at("2024-09-16T09:00:00Z"), at("2024-09-17T09:00:00Z")],
    };
    return nasaLogFrom(c)!;
  };

  it("makes the question's events the runs of storm nights", () => {
    const clock = zoneClock("UTC", history[0].uts, history.at(-1)!.uts);
    expect(nightRuns(nasaNights("storms", log(), clock, day("2024-01-01"), day("2024-12-31")))).toEqual([
      [day("2024-03-03"), day("2024-03-04"), day("2024-03-05")],
      [day("2024-04-07"), day("2024-04-08"), day("2024-04-09")],
      [day("2024-06-10")],
      [day("2024-09-16"), day("2024-09-17")],
    ]);
    const answers = computeAnswers("runs", history, "UTC", 0, log());
    const q = (id: string) => answers.questions.find((x) => x.id === id)!;
    // Four stretches of storm nights, each holding a play; three of X-flare nights.
    expect(q("storms").events).toBe(4);
    expect(q("flares").events).toBe(3);
    // The dock reads the payload's count.
    expect(answersPayload(answers, "ready", Date.parse("2026-10-01T00:00:00Z")).questions.find((x) => x.id === "storms")!.events).toBe(4);
  });

  it("gives each run one card: the higher reading, a night with no plays or an eclipse in it splitting nothing", async () => {
    const { MemoryBlobStore, setBlobStore } = await import("@/lib/store/blob");
    const { computeListener } = await import("./record");
    setBlobStore(new MemoryBlobStore());
    const r = await computeListener(history, "UTC", log(), { artists: {} }, 0);
    setBlobStore(null);
    const name = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
    // Every storm-headed night carries its run's first night.
    expect(
      r.wild
        .filter((w) => w.stormRun !== undefined)
        .map((w) => [name(w.night), name(w.stormRun!)])
        .sort(),
    ).toEqual([
      ["2024-03-03", "2024-03-03"],
      ["2024-03-05", "2024-03-03"],
      ["2024-04-07", "2024-04-07"],
      ["2024-04-09", "2024-04-07"],
      ["2024-06-10", "2024-06-10"],
      ["2024-09-16", "2024-09-16"],
      ["2024-09-17", "2024-09-16"],
    ]);
    // The row: the two eclipses (UTC sees every one), then one card per run.
    // Mar 3 and 5 aren't next door to each other, nor are Apr 7 and 9.
    expect(oneCardPerEvent(r.wild).map((w) => [name(w.night), w.rank])).toEqual([
      ["2024-04-08", 0],
      ["2024-10-02", 1],
      ["2024-04-09", 4],
      ["2024-03-05", 4],
      ["2024-09-16", 4],
      ["2024-06-10", 4],
    ]);
    // The storms that began, and the X flares that peaked, between the first play and the last.
    expect(r.counts).toMatchObject({ storms: 5, xflares: 4 });
    // The filters' nights per month: only nights with a play (8.5).
    expect(r.filterMonths!.storm).toEqual({ "2024-03": 2, "2024-04": 3, "2024-06": 1, "2024-09": 2 });
    expect(r.filterCounts.storm).toBe(8);
    expect(r.filterMonths!.xflare).toEqual({ "2024-02": 2, "2024-05": 1, "2024-10": 1 });
    expect(r.filterMonths!.wild).toEqual({ "2024-03": 2, "2024-04": 3, "2024-06": 1, "2024-09": 2, "2024-10": 1 });
    expect(r.filterMonths!.fireball).toEqual({});
    expect(Object.keys(r.filterMonths!)).toEqual([
      "storm",
      "xflare",
      "eclipse",
      "fullmoon",
      "newmoon",
      "firstplay",
      "wild",
      "venushome",
      "marshome",
      "moonstrong",
      "asteroid",
      "fireball",
    ]);
  });
});

describe("the X flares NASA logged in the history (8.5's dock)", () => {
  it("counts the peaks from the first play to the last, both ends included", () => {
    const log = {
      xflares: [
        [99, "X1.0"],
        [100, "X1.1"],
        [150, "X2.0"],
        [200, "X3.0"],
        [201, "X4.0"],
      ],
    } as unknown as NasaLog;
    expect(xflaresIn(log, 100, 200)).toBe(3);
    expect(xflaresIn(log, 101, 199)).toBe(1);
    expect(xflaresIn(null, 100, 200)).toBe(0);
  });
});
