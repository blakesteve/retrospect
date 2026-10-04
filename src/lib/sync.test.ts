import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, getBlobStore, setBlobStore } from "./store/blob";
import { userKey } from "./store/userKeys";
import { getStore } from "./store/jsonStore";
import { LastfmError, getRecentTracksPage, type RecentTracksPage } from "./lastfm";
import { removeUserData, requestRemoval } from "./removal";
import { EMPTY_REFRESH_SECONDS, runSyncChunk } from "./sync";

/* An account with no scrobbles never finished syncing: Last.fm reports
   `totalPages: 0` for it, and the worker only called a sync done when there
   was at least one page. Every poll fetched one more empty page and the wait
   screen spun for as long as the tab was open. These feed the worker Last.fm
   responses directly, with no network. */

vi.mock("./lastfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lastfm")>();
  return { ...actual, getRecentTracksPage: vi.fn() };
});
const fetchPage = vi.mocked(getRecentTracksPage);

const page = (over: Partial<RecentTracksPage>): RecentTracksPage => ({
  scrobbles: [],
  page: 1,
  totalPages: 0,
  totalScrobbles: 0,
  ...over,
});

beforeEach(() => {
  setBlobStore(new MemoryBlobStore());
  fetchPage.mockReset();
});
afterEach(() => setBlobStore(null));

describe("syncing an empty account", () => {
  it("finishes once Last.fm has reported zero pages twice", async () => {
    fetchPage.mockResolvedValue(page({ totalPages: 0 }));
    // One reply could be a glitch, so the first poll keeps going...
    expect((await runSyncChunk("empty-zero")).status).toBe("syncing");
    // ...and the second, agreeing, finishes it.
    const state = await runSyncChunk("empty-zero");
    expect(state.status).toBe("ready");
    expect(state.totalScrobbles).toBe(0);
  });

  it("stays finished instead of fetching page after page past the end", async () => {
    fetchPage.mockResolvedValue(page({ totalPages: 0 }));
    for (let i = 0; i < 6; i++) await runSyncChunk("empty-repoll");
    // The old rule asked for a new empty page on every one of these polls.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("finishes when Last.fm reports one empty page instead", async () => {
    fetchPage.mockResolvedValue(page({ totalPages: 1 }));
    expect((await runSyncChunk("empty-one")).status).toBe("ready");
  });

  it("recovers an account that got stuck under the old rule", async () => {
    // What a stuck state looked like: dozens of empty pages fetched, still syncing.
    await getStore().setSyncState({
      username: "empty-stuck",
      status: "syncing",
      pagesDone: 57,
      totalPages: 0,
      totalScrobbles: 0,
      newestUts: 0,
      updatedAt: Date.now(),
    });
    fetchPage.mockResolvedValue(page({ totalPages: 0 }));
    expect((await runSyncChunk("empty-stuck")).status).toBe("syncing");
    expect((await runSyncChunk("empty-stuck")).status).toBe("ready");
    // It starts again from page 1 rather than reading on past the end.
    expect(fetchPage.mock.calls.map(([, n]) => n)).toEqual([1, 1]);
  });

  it("reads a stuck account from page 1 once it has started scrobbling", async () => {
    await getStore().setSyncState({
      username: "stuck-then-listening",
      status: "syncing",
      pagesDone: 57,
      totalPages: 0,
      totalScrobbles: 0,
      newestUts: 0,
      updatedAt: Date.now(),
    });
    const uts = Date.UTC(2026, 8, 1) / 1000;
    fetchPage.mockImplementation(async (_user, n) =>
      n === 1
        ? page({ page: 1, totalPages: 1, totalScrobbles: 1, scrobbles: [{ uts, artist: "A", track: "t1" }] })
        : page({ page: n, totalPages: 1, totalScrobbles: 1 }),
    );
    const state = await runSyncChunk("stuck-then-listening");
    expect(state.status).toBe("ready");
    expect(await getStore().getScrobbles("stuck-then-listening")).toHaveLength(1);
  });
});

describe("the ready rule still waits when it should", () => {
  it("keeps syncing when the first page fails and nothing was learned", async () => {
    fetchPage.mockRejectedValue(new LastfmError("Last.fm HTTP 503", undefined, 503));
    expect((await runSyncChunk("first-page-flaky")).status).toBe("syncing");
  });

  it("doesn't finish a real history that reports zero pages partway through", async () => {
    // Four real pages, then a reply that claims there are none: the history
    // must not be cut short and called done.
    const uts = Date.UTC(2025, 0, 1) / 1000;
    fetchPage.mockImplementation(async (_user, n) =>
      n <= 4
        ? page({ page: n, totalPages: 10, totalScrobbles: 10, scrobbles: [{ uts: uts + n, artist: "A", track: `t${n}` }] })
        : page({ page: n, totalPages: 0 }),
    );
    expect((await runSyncChunk("mid-history-blank")).status).toBe("syncing");
  });

  it("doesn't call a small account empty after one blank first reply", async () => {
    // Page 1 comes back blank once, then answers properly.
    const uts = Date.UTC(2025, 0, 1) / 1000;
    let calls = 0;
    fetchPage.mockImplementation(async (_user, n) =>
      calls++ === 0
        ? page({ page: n, totalPages: 0 })
        : page({ page: n, totalPages: 1, totalScrobbles: 1, scrobbles: [{ uts, artist: "A", track: `t${n}` }] }),
    );
    expect((await runSyncChunk("small-flaky")).status).toBe("syncing");
    expect((await runSyncChunk("small-flaky")).status).toBe("ready");
    // The second read is page 1 again, not page 2, so nothing was skipped.
    expect(fetchPage.mock.calls.map(([, n]) => n)).toEqual([1, 1]);
    expect(await getStore().getScrobbles("small-flaky")).toHaveLength(1);
  });

  it("re-reads pages that came back blank partway through, instead of skipping them", async () => {
    const uts = Date.UTC(2025, 0, 1) / 1000;
    // Only part of a batch: page 6 answers, 7 to 9 come back blank.
    const blankedOnce = new Set([7, 8, 9]);
    fetchPage.mockImplementation(async (_user, n) => {
      if (blankedOnce.delete(n)) return page({ page: n, totalPages: 0 });
      return page({ page: n, totalPages: 10, totalScrobbles: 10, scrobbles: [{ uts: uts - n, artist: "A", track: `t${n}` }] });
    });
    expect((await runSyncChunk("mid-history-gap")).status).toBe("syncing");
    expect((await runSyncChunk("mid-history-gap")).status).toBe("ready");
    const tracks = (await getStore().getScrobbles("mid-history-gap")).map((s) => s.track).sort();
    expect(tracks).toEqual(["t1", "t10", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"]);
  });

  it("finishes an ordinary account once its last page is in", async () => {
    const uts = Date.UTC(2025, 0, 1) / 1000;
    fetchPage.mockImplementation(async (_user, n) =>
      page({ page: n, totalPages: 3, totalScrobbles: 3, scrobbles: [{ uts: uts + n, artist: "A", track: `t${n}` }] }),
    );
    const state = await runSyncChunk("ordinary");
    expect(state.status).toBe("ready");
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(await getStore().getScrobbles("ordinary")).toHaveLength(3);
  });
});

describe("what a failed sync tells a visitor", () => {
  it("records 'user-not-found' for Last.fm's no-such-user error", async () => {
    fetchPage.mockRejectedValue(new LastfmError("User not found", 6));
    const state = await runSyncChunk("typo");
    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("user-not-found");
  });

  it("records 'server', not the setting's name, when the API key is missing", async () => {
    fetchPage.mockRejectedValue(new Error("LASTFM_API_KEY is not set (add it to .env.local)"));
    const state = await runSyncChunk("no-key");
    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("server");
  });
});

/* An empty history used to count as fresh for the same hour as a full one, so
   someone told "Nothing to read yet" who went and scrobbled was told it again
   for up to an hour. The durations are literals on purpose: a test that read
   the constants would pass whatever they were set to. */
describe("how long a finished history counts as fresh", () => {
  const MINUTE = 60_000;
  const readyState = (username: string, ageMs: number, newestUts: number) =>
    getStore().setSyncState({
      username,
      status: "ready",
      pagesDone: newestUts ? 1 : 0,
      totalPages: newestUts ? 1 : 0,
      totalScrobbles: newestUts ? 1 : 0,
      newestUts,
      emptyReads: newestUts ? 0 : 2,
      updatedAt: Date.now() - ageMs,
    });

  it("asks Last.fm about an empty history again after a minute, and not before", async () => {
    fetchPage.mockResolvedValue(page({ totalPages: 0 }));
    await readyState("empty-59s", 59_000, 0);
    await runSyncChunk("empty-59s");
    expect(fetchPage).not.toHaveBeenCalled();

    await readyState("empty-61s", 61_000, 0);
    const state = await runSyncChunk("empty-61s");
    // Still empty is still finished, after one look.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("ready");
  });

  it("reads the first plays of a history that was empty a minute ago", async () => {
    await readyState("first-plays", 61_000, 0);
    const uts = Date.UTC(2026, 8, 30, 15) / 1000;
    fetchPage.mockResolvedValue(
      page({
        totalPages: 1,
        totalScrobbles: 3,
        scrobbles: [
          { uts: uts + 400, artist: "A", track: "t3" },
          { uts: uts + 200, artist: "A", track: "t2" },
          { uts, artist: "A", track: "t1" },
        ],
      }),
    );
    const state = await runSyncChunk("first-plays");
    expect(state.status).toBe("ready");
    expect(await getStore().getScrobbles("first-plays")).toHaveLength(3);
    // Read as a fresh history, so the page knows where it starts.
    expect(state.newestUts).toBe(uts + 400);
    expect(state.oldestUts).toBe(uts);
  });

  it("keeps a history with plays fresh for an hour, so a warm one isn't re-read on every visit", async () => {
    const uts = Date.UTC(2026, 8, 1) / 1000;
    fetchPage.mockResolvedValue(page({ totalPages: 1, totalScrobbles: 1 }));
    await readyState("warm-59m", 59 * MINUTE, uts);
    await runSyncChunk("warm-59m");
    expect(fetchPage).not.toHaveBeenCalled();

    await readyState("warm-61m", 61 * MINUTE, uts);
    await runSyncChunk("warm-61m");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("matches what the empty screen tells people", () => {
    // NoScrobbles says "once a minute" in words. Change the window, change them.
    const source = readFileSync(path.resolve(__dirname, "../components/NoScrobbles.tsx"), "utf8");
    const mentions = source.match(/asks Last\.fm [^."`]*/g) ?? [];
    expect(mentions.length).toBeGreaterThan(0);
    expect(new Set(mentions)).toEqual(new Set(["asks Last.fm again at most once a minute"]));
    expect(EMPTY_REFRESH_SECONDS).toBe(60);
  });
});

/* A removal that lands while a sync chunk is fetching pages deletes the sync
   state first. The chunk must then write nothing: its pages under a cursor
   that says the earlier ones are in would be a history missing its newest
   plays, reported as complete. */
describe("a sync chunk that outlives a removal", () => {
  const uts = Date.UTC(2025, 0, 1) / 1000;

  it("writes nothing when its history was removed mid-read", async () => {
    await getStore().setSyncState({
      username: "removed-mid-backfill",
      status: "syncing",
      pagesDone: 4,
      totalPages: 10,
      totalScrobbles: 10,
      newestUts: uts + 100,
      updatedAt: Date.now() - 120_000,
    });
    fetchPage.mockImplementation(async (user, n) => {
      if (n === 5) await removeUserData(user); // the removal, mid-fetch
      return page({ page: n, totalPages: 10, totalScrobbles: 10, scrobbles: [{ uts: uts - n, artist: "A", track: `t${n}` }] });
    });
    await runSyncChunk("removed-mid-backfill");
    expect(await getStore().getSyncState("removed-mid-backfill")).toBeNull();
    expect(await getStore().getScrobbles("removed-mid-backfill")).toEqual([]);
  });

  it("takes its write back when the removal lands during the append itself", async () => {
    fetchPage.mockResolvedValue(
      page({ totalPages: 1, totalScrobbles: 2, scrobbles: [{ uts: uts + 60, artist: "A", track: "new" }] }),
    );
    /* The append reads the whole history, then writes it back with the new
       plays: seconds, on a big one. The removal lands between the two. */
    const blobs = new MemoryBlobStore();
    setBlobStore(blobs);
    await getStore().setSyncState({
      username: "removed-mid-append",
      status: "ready",
      pagesDone: 1,
      totalPages: 1,
      totalScrobbles: 1,
      newestUts: uts,
      updatedAt: Date.now() - 2 * 3_600_000,
    });
    await getStore().appendScrobbles("removed-mid-append", [{ uts, artist: "A", track: "old" }]);
    const get = blobs.get.bind(blobs);
    let removed = false;
    blobs.get = async (key: string) => {
      const data = await get(key);
      if (key.startsWith("scrobbles/") && !removed) {
        removed = true;
        expect((await requestRemoval("removed-mid-append")).kind).toBe("removed");
      }
      return data;
    };
    await runSyncChunk("removed-mid-append");
    expect(await getStore().getSyncState("removed-mid-append")).toBeNull();
    expect(await getStore().getScrobbles("removed-mid-append")).toEqual([]);
  });

  it("leaves a history read after the removal alone", async () => {
    // Removed, then looked up again a minute later: the new read must stay.
    await getStore().setSyncState({
      username: "removed-then-back",
      status: "ready",
      pagesDone: 1,
      totalPages: 1,
      totalScrobbles: 1,
      newestUts: uts,
      updatedAt: Date.now() - 2 * 3_600_000,
    });
    expect((await requestRemoval("removed-then-back")).kind).toBe("removed");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    try {
      fetchPage.mockResolvedValue(
        page({ totalPages: 1, totalScrobbles: 1, scrobbles: [{ uts, artist: "A", track: "back" }] }),
      );
      expect((await runSyncChunk("removed-then-back")).status).toBe("ready");
      expect(await getStore().getScrobbles("removed-then-back")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes nothing when a warm history's refresh outlives its removal", async () => {
    await getStore().setSyncState({
      username: "removed-mid-refresh",
      status: "ready",
      pagesDone: 1,
      totalPages: 1,
      totalScrobbles: 1,
      newestUts: uts,
      updatedAt: Date.now() - 2 * 3_600_000,
    });
    fetchPage.mockImplementation(async (user) => {
      await removeUserData(user);
      return page({ totalPages: 1, totalScrobbles: 2, scrobbles: [{ uts: uts + 60, artist: "A", track: "new" }] });
    });
    await runSyncChunk("removed-mid-refresh");
    expect(await getStore().getSyncState("removed-mid-refresh")).toBeNull();
    expect(await getStore().getScrobbles("removed-mid-refresh")).toEqual([]);
  });
});

describe("the chunk that finishes a backfill", () => {
  /* A backfill keeps a play twice when Last.fm's pages shift under it (new
     plays arriving push old ones onto the next page); reads drop the repeat.
     They were 21% of the largest real history. The finishing chunk rewrites
     the history without them, in the write it makes anyway. */
  const at0 = Date.UTC(2025, 0, 1) / 1000;
  const play = (i: number) => ({ uts: at0 + i * 600, artist: `Artist ${i % 3}`, track: `Track ${i}` });
  const linesOf = async (name: string) =>
    gunzipSync((await getBlobStore().get(userKey("scrobbles", name)))!).toString("utf8").split("\n").filter(Boolean);

  async function midBackfill(name: string, totalPages: number) {
    const first = Array.from({ length: 10 }, (_, i) => play(i));
    await getStore().appendScrobbles(name, first);
    await getStore().appendScrobbles(name, first.slice(5)); // the shifted page, read again
    await getStore().setSyncState({
      username: name,
      status: "syncing",
      pagesDone: 1,
      totalPages,
      totalScrobbles: 15,
      newestUts: first[9].uts,
      oldestUts: first[0].uts,
      updatedAt: Date.now(),
    });
    // Page 2: one play page 1 already had, and five older ones.
    return [first[0], ...Array.from({ length: 5 }, (_, i) => play(-1 - i))];
  }

  it("stores each play once when the backfill finishes", async () => {
    const lastPage = await midBackfill("compactor", 2);
    fetchPage.mockResolvedValue(page({ scrobbles: lastPage, page: 2, totalPages: 2, totalScrobbles: 15 }));
    expect((await runSyncChunk("compactor")).status).toBe("ready");
    const lines = await linesOf("compactor");
    expect(lines).toHaveLength(15);
    expect(new Set(lines).size).toBe(15);
    expect((await getStore().getScrobbles("compactor")).map((s) => s.uts)).toEqual(
      Array.from({ length: 15 }, (_, i) => at0 + (i - 5) * 600),
    );
  });

  it("leaves the repeats for the last chunk while the backfill is still going", async () => {
    const lastPage = await midBackfill("halfway", 2);
    // Page 2 arrives and says the history has grown a third page, which then
    // fails with a network blip, so the chunk stops short of the end.
    fetchPage.mockImplementation(async (_name, n) => {
      if (n === 2) return page({ scrobbles: lastPage, page: 2, totalPages: 3, totalScrobbles: 15 });
      throw new TypeError("fetch failed");
    });
    expect((await runSyncChunk("halfway")).status).toBe("syncing");
    expect(await linesOf("halfway")).toHaveLength(10 + 5 + 6);
    expect(await getStore().getScrobbles("halfway")).toHaveLength(15);
  });
});

describe("the history's first play (oldestUts)", () => {
  /* Every reader of the sync state (a planet's sheet, Every night before its
     first year, the nights' sheet) takes `oldestUts` as the history's first
     play, the record's first night: the oldest stored play that isn't noise
     or an impossible date. The backfill's running minimum counts both, and a
     state saved before the field existed kept a later one. */
  const FIRST = Date.UTC(2023, 8, 28, 2, 15) / 1000; // Sept 27, 2023, 9:15 p.m. CDT
  const plays = [
    { uts: FIRST + 7200, artist: "Khruangbin", track: "May Ninth" },
    { uts: FIRST, artist: "Boards of Canada", track: "Aquarius" },
    { uts: FIRST - 3600, artist: "Rain Sounds", track: "Rolling Thunder" }, // noise
    { uts: 0, artist: "Boards of Canada", track: "Roygbiv" }, // a 1970 timestamp
  ];

  it("is set to the first play by the chunk that finishes a backfill, not to noise or a 1970 date", async () => {
    fetchPage.mockResolvedValue(page({ totalPages: 1, totalScrobbles: plays.length, scrobbles: plays }));
    const state = await runSyncChunk("first-play");
    expect(state.status).toBe("ready");
    expect(state).toMatchObject({ oldestUts: FIRST, oldestIsFirstPlay: true });
    expect(await getStore().getSyncState("first-play")).toMatchObject({ oldestUts: FIRST, oldestIsFirstPlay: true });
  });

  it("corrects a ready state saved with a later one on its next refresh, and reads the history for it once", async () => {
    await getStore().appendScrobbles("saved-before", plays);
    const stale = (oldestUts?: number, extra = {}) =>
      getStore().setSyncState({
        username: "saved-before",
        status: "ready",
        pagesDone: 1,
        totalPages: 1,
        totalScrobbles: plays.length,
        newestUts: FIRST + 7200,
        oldestUts,
        updatedAt: Date.now() - 2 * 3600_000,
        ...extra,
      });
    // A state from before the field: its oldest taken from a later sync, ten days in.
    await stale(FIRST + 10 * 86_400);
    fetchPage.mockResolvedValue(page({ totalPages: 1, totalScrobbles: plays.length }));
    const read = vi.spyOn(getStore(), "getScrobbles");
    expect(await runSyncChunk("saved-before")).toMatchObject({ oldestUts: FIRST, oldestIsFirstPlay: true });
    expect(read).toHaveBeenCalledTimes(1);
    // Corrected, it isn't read again on the refreshes after.
    await stale(FIRST, { oldestIsFirstPlay: true });
    expect(await runSyncChunk("saved-before")).toMatchObject({ oldestUts: FIRST });
    expect(read).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    read.mockRestore();
  });

  it("isn't claimed while an empty history that gained plays syncs again, and is set once it's ready", async () => {
    // Ready and empty, the first play settled as none; then plays arrive.
    await getStore().setSyncState({
      username: "empty-then-plays",
      status: "ready",
      pagesDone: 0,
      totalPages: 0,
      totalScrobbles: 0,
      newestUts: 0,
      emptyReads: 2,
      oldestIsFirstPlay: true,
      updatedAt: Date.now() - 61_000,
    });
    const blankedOnce = new Set([2]);
    fetchPage.mockImplementation(async (_user, n) => {
      if (blankedOnce.delete(n)) return page({ page: n, totalPages: 0 });
      return page({ page: n, totalPages: 2, totalScrobbles: 2, scrobbles: [n === 1 ? plays[0] : plays[1]] });
    });
    const syncing = await runSyncChunk("empty-then-plays");
    expect(syncing.status).toBe("syncing");
    // While it syncs, the oldest seen so far, and no claim it's the first play.
    expect(syncing.oldestIsFirstPlay).toBeUndefined();
    expect(syncing.oldestUts).toBe(plays[0].uts);
    const ready = await runSyncChunk("empty-then-plays");
    expect(ready).toMatchObject({ status: "ready", oldestUts: FIRST, oldestIsFirstPlay: true });
  });

  it("is left out for an empty history", async () => {
    fetchPage.mockResolvedValue(page({ totalPages: 1 }));
    const state = await runSyncChunk("first-play-empty");
    expect(state.status).toBe("ready");
    expect(state.oldestUts).toBeUndefined();
    expect(state.oldestIsFirstPlay).toBe(true);
  });
});
