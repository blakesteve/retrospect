import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { userKey } from "@/lib/store/userKeys";
import { removeUserData } from "@/lib/removal";
import { ARTISTS, sampleHistory, writeSampleListener, SAMPLE_ZONE } from "../../../scripts/sample-listener";
import { writeTagStore } from "@/lib/genres";
import { getStore } from "@/lib/store/jsonStore";
import { GET as answersRoute } from "@/app/api/user/[name]/answers/route";
import { GET as songsRoute } from "@/app/api/user/[name]/songs/route";
import { computeOnce, readAnswers } from "@/lib/answers/store";
import { computeListenerOnce, readListener } from "@/lib/listener/record";
import { bodiesAt } from "@/lib/sky/sky";
import { cardData } from "./cardData";

/* What each share card shows (spec 8.7.5), on the made-up sample: read from
   what the routes stored, never computed. */

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (job: () => Promise<unknown>) => void job() };
});
vi.mock("@/lib/space/work", () => ({
  runSpaceWork: vi.fn(async () => ({ skipped: false, ms: 0, fetches: 0, wrote: [], failed: [], done: true })),
}));
// Every computation of answers or a listener record, recorded: a card must never start one (6.6).
vi.mock("@/lib/answers/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/answers/store")>();
  return { ...actual, computeOnce: vi.fn(actual.computeOnce) };
});
vi.mock("@/lib/listener/record", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listener/record")>();
  return { ...actual, computeListenerOnce: vi.fn(actual.computeListenerOnce) };
});

const ZONE = SAMPLE_ZONE;
const NOW = Date.parse("2026-10-04T18:00:00Z") / 1000;
let songId = "";
/** The fullmoon answer as the listener's own page gets it. */
let pageWord = "";

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in tests");
    }),
  );
  setBlobStore(new MemoryBlobStore());
  await writeSampleListener("sample", new Date());
  const ctx = { params: Promise.resolve({ name: "sample" }) };
  await answersRoute(new Request(`http://x/api/user/sample/answers?tz=${encodeURIComponent(ZONE)}`), ctx);
  const songs = await (await songsRoute(new Request(`http://x/api/user/sample/songs?tz=${encodeURIComponent(ZONE)}`), ctx)).json();
  songId = songs.row.find((s: { track: string }) => s.track === "Good Luck, Babe!").songId;
  const page = await (await answersRoute(new Request(`http://x/api/user/sample/answers?tz=${encodeURIComponent(ZONE)}`), ctx)).json();
  pageWord = page.questions.find((q: { id: string }) => q.id === "fullmoon").word;
}, 120_000);
afterAll(() => {
  vi.unstubAllGlobals();
  // An empty store, never null, which would hand anything still running the environment's.
  setBlobStore(new MemoryBlobStore());
});

describe("a song's card", () => {
  it("says the minute of its first play, and draws the sky then", async () => {
    const d = await cardData("sample", { kind: "song", id: songId }, ZONE, NOW);
    expect(d.kind).toBe("song");
    if (d.kind !== "song") return;
    expect(d.says).toBe("The sky the minute I first played Good Luck, Babe! by Chappell Roan · 10:22 p.m. CDT, May 10, 2024");
    // May 10, 2024: the Sun, Venus and Jupiter in Taurus, Mercury and Mars in Aries, Saturn in Pisces (USNO, JPL Horizons).
    const sign = (body: string) => d.planets.find((p) => p.body === body)?.sign;
    expect(["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"].map(sign)).toEqual(["Taurus", "Aries", "Taurus", "Aries", "Taurus", "Pisces"]);
    // All seven, at that minute: 10:22 p.m. CDT is 03:22 UTC on May 11.
    const then = bodiesAt(new Date("2024-05-11T03:22:00Z")).map((b) => ({ body: b.body, sign: b.sign, retrograde: b.retrograde }));
    expect(d.planets).toEqual(then);
    expect(d.planets).toHaveLength(7);
  });
});

describe("a night's card", () => {
  it("names the night and its wild title, with its plays against a usual night", async () => {
    const d = await cardData("sample", { kind: "night", date: "2024-05-10" }, ZONE, NOW);
    expect(d.kind).toBe("night");
    if (d.kind !== "night") return;
    expect(d.says).toBe("My night of May 10, 2024: the strongest geomagnetic storm in about 20 years");
    expect(d.weekday).toBe("Friday");
    // The made-up sample's night: 39 plays, against 46 on its usual Friday.
    expect([d.plays, d.usual]).toEqual([39, 46]);
    // The new moon was May 8, 2024 at 03:22 UTC: at 9 p.m. two days later, a crescent about 3 days old.
    expect(d.moonName).toBe("Waxing crescent");
    expect(d.moonPhase).toBeGreaterThan(25);
    expect(d.moonPhase).toBeLessThan(50);
  });
  it("is the generic card for a night the history doesn't have", async () => {
    expect((await cardData("sample", { kind: "night", date: "2019-01-01" }, ZONE, NOW)).kind).toBe("generic");
  });
});

describe("a question's card", () => {
  it("asks the question in the first person, with its word and how likely chance is", async () => {
    const d = await cardData("sample", { kind: "q", id: "fullmoon" }, ZONE, NOW);
    expect(d.kind).toBe("q");
    if (d.kind !== "q") return;
    expect(d.question).toBe("Does a full moon change how late I listen?");
    // The made-up sample's word, and the same word its own page shows.
    expect(d.says).toBe("Does a full moon change how late I listen? Maybe.");
    expect(d.word).toBe(pageWord);
    expect(d.line).toBe("Could be chance.");
  });
  it("says why a Too early question has no word yet, never a chance", async () => {
    // A newcomer: the sample's first ten weeks alone, as compare's checks seed it.
    const all = sampleHistory();
    const history = all.filter((p) => p.uts < all[0].uts + 70 * 86_400);
    await getStore().appendScrobbles("newcomer", history);
    const artists = [...new Set(history.map((p) => p.artist))];
    await writeTagStore("newcomer", { artists: Object.fromEntries(artists.map((a) => [a.toLowerCase(), [ARTISTS[a].tag]])) });
    await getStore().setSyncState({
      username: "newcomer",
      status: "ready",
      pagesDone: 1,
      totalPages: 1,
      totalScrobbles: history.length,
      newestUts: history[history.length - 1].uts,
      oldestUts: history[0].uts,
      updatedAt: Date.now(),
    });
    await answersRoute(new Request(`http://x/api/user/newcomer/answers?tz=${encodeURIComponent(ZONE)}`), { params: Promise.resolve({ name: "newcomer" }) });
    const d = await cardData("newcomer", { kind: "q", id: "fullmoon" }, ZONE, NOW);
    expect(d).toMatchObject({ kind: "q", word: "Too early", says: "Does a full moon change how late I listen? Too early." });
    if (d.kind !== "q") return;
    // The short reason, without a second "Too early.": "286 of the 500 plays a verdict needs around a full moon."
    expect(d.line).toMatch(/^[\d,]+ of the (6 full moons|500 plays) a verdict needs/);
    expect(d.line).not.toMatch(/Too early|chance/);
  }, 120_000);
  it("says why a Maybe isn't a Yes, when chance alone would say unlikely", async () => {
    const key = userKey("answers", "sample");
    const before = (await getBlobStore().get(key))!;
    try {
      // The sample's full-moon test, stored with p = 0.03: under 0.05 alone, not after allowing for its 10 questions.
      const stored = JSON.parse(before.toString("utf8"));
      for (const record of stored.records) {
        for (const q of record.questions) if (q.id === "fullmoon") q.p = 0.03;
      }
      await getBlobStore().put(key, Buffer.from(JSON.stringify(stored)));
      expect(await cardData("sample", { kind: "q", id: "fullmoon" }, ZONE, NOW)).toMatchObject({
        word: "Maybe",
        line: "Unlikely to be chance on its own, but not after allowing for 10 questions.",
      });
    } finally {
      await getBlobStore().put(key, before);
    }
  });
  it('is the generic card, never "Checking", for an answer stored under an older measure', async () => {
    const key = userKey("answers", "sample");
    const before = (await getBlobStore().get(key))!;
    try {
      const stored = JSON.parse(before.toString("utf8"));
      for (const record of stored.records) {
        for (const q of record.questions) if (q.id === "fullmoon") q.measure = "listening";
      }
      await getBlobStore().put(key, Buffer.from(JSON.stringify(stored)));
      expect((await cardData("sample", { kind: "q", id: "fullmoon" }, ZONE, NOW)).kind).toBe("generic");
      // Control: the other questions stand.
      expect((await cardData("sample", { kind: "q", id: "storms" }, ZONE, NOW)).kind).toBe("q");
    } finally {
      await getBlobStore().put(key, before);
    }
  });
  it("is the generic card for a question that isn't one", async () => {
    expect((await cardData("sample", { kind: "q", id: "pluto" }, ZONE, NOW)).kind).toBe("generic");
  });
});

describe("the generic card", () => {
  it("is what a page with no card unfurls as: the name and tonight's Moon", async () => {
    const d = await cardData("sample", null, ZONE, NOW);
    expect(d).toMatchObject({ kind: "generic", username: "sample" });
    // The Moon at the moment asked: full at 13:53 UTC on May 23, 2024.
    const full = await cardData("sample", null, ZONE, Date.parse("2024-05-23T13:53:00Z") / 1000);
    expect(full).toMatchObject({ kind: "generic", moonName: "Full moon" });
  });
  it("names no one for a name that can't be one", async () => {
    expect(await cardData("no!one", { kind: "q", id: "fullmoon" }, ZONE, NOW)).toMatchObject({ kind: "generic", username: null });
  });
  it("is what a zone with nothing stored gets, and nothing is computed for it", async () => {
    vi.mocked(computeOnce).mockClear();
    vi.mocked(computeListenerOnce).mockClear();
    expect(await readAnswers("sample", "Pacific/Kiritimati")).toBeNull();
    for (const ref of [
      { kind: "q", id: "fullmoon" },
      { kind: "song", id: songId },
      { kind: "night", date: "2024-05-10" },
    ] as const) {
      expect((await cardData("sample", ref, "Pacific/Kiritimati", NOW)).kind).toBe("generic");
    }
    expect(await readAnswers("sample", "Pacific/Kiritimati")).toBeNull();
    expect(await readListener("sample", "Pacific/Kiritimati")).toBeNull();
    // Not even started: a computation still running would store nothing yet. A moment first, for anything
    // a card set off in the background to reach its call.
    await new Promise((r) => setTimeout(r, 200));
    expect(computeOnce).not.toHaveBeenCalled();
    expect(computeListenerOnce).not.toHaveBeenCalled();
    // Control: the spies do record a computation.
    await answersRoute(new Request(`http://x/api/user/sample/answers?tz=${encodeURIComponent("Asia/Tokyo")}`), {
      params: Promise.resolve({ name: "sample" }),
    });
    expect(computeOnce).toHaveBeenCalled();
  });
  it("is what a removed history gets", async () => {
    setBlobStore(new MemoryBlobStore());
    try {
      await writeSampleListener("gone", new Date());
      const ctx = { params: Promise.resolve({ name: "gone" }) };
      await answersRoute(new Request(`http://x/api/user/gone/answers?tz=${encodeURIComponent(ZONE)}`), ctx);
      expect((await cardData("gone", { kind: "q", id: "fullmoon" }, ZONE, NOW)).kind).toBe("q");
      await removeUserData("gone");
      expect((await cardData("gone", { kind: "q", id: "fullmoon" }, ZONE, NOW)).kind).toBe("generic");
    } finally {
      setBlobStore(new MemoryBlobStore());
    }
  }, 120_000);
});
