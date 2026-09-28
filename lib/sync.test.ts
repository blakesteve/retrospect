import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { getStore } from "./store/jsonStore";
import { LastfmError, getRecentTracksPage, type RecentTracksPage } from "./lastfm";
import { runSyncChunk } from "./sync";

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
