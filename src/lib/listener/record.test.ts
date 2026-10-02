import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { historyStamp } from "@/lib/answers/engine";
import { LISTENER_VERSION, isCurrentListener, type ListenerRecord } from "./record";
import { tagsStamp } from "./serve";

const plays: Scrobble[] = [
  { uts: 1_700_000_000, artist: "Alpha", track: "one" },
  { uts: 1_700_000_600, artist: "Beta", track: "two" },
  { uts: 1_700_001_200, artist: "Alpha", track: "three" },
];

describe("a stored listener record", () => {
  const record = { version: LISTENER_VERSION, stamp: historyStamp(plays), nasaStamp: "2026-09-28|abc", tagged: 2 } as ListenerRecord;

  it("is current only on the same history, NASA log, tags and version", () => {
    // 2: the Surprise me facts are stored (2 Oct 2026).
    expect(LISTENER_VERSION).toBe(2);
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
