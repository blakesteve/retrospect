import { afterEach, describe, expect, it } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./blob";
import { BlobScrobbleStore } from "./jsonStore";
import type { Scrobble } from "@/lib/analysis/nostalgia";

const T2015 = Date.parse("2015-06-01T00:00:00Z") / 1000;

afterEach(() => setBlobStore(null));

describe("BlobScrobbleStore", () => {
  it("round-trips scrobbles through gzip, sorted and deduped", async () => {
    setBlobStore(new MemoryBlobStore());
    const store = new BlobScrobbleStore();

    const batch1: Scrobble[] = [
      { uts: T2015 + 100, artist: "B", track: "two" },
      { uts: T2015, artist: "A", track: "one" },
    ];
    const batch2: Scrobble[] = [
      { uts: T2015, artist: "A", track: "one" }, // duplicate across appends
      { uts: T2015 + 200, artist: "C", track: "three" },
    ];
    await store.appendScrobbles("Tester", batch1);
    await store.appendScrobbles("Tester", batch2);

    const out = await store.getScrobbles("Tester");
    expect(out.map((s) => s.track)).toEqual(["one", "two", "three"]);
  });

  it("drops impossible timestamps (the Dec 1969 disease)", async () => {
    setBlobStore(new MemoryBlobStore());
    const store = new BlobScrobbleStore();
    await store.appendScrobbles("Tester", [
      { uts: 0, artist: "Ghost", track: "epoch" },
      { uts: Date.parse("1999-01-01T00:00:00Z") / 1000, artist: "Ghost", track: "pre-lastfm" },
      { uts: T2015, artist: "Real", track: "song" },
      { uts: Date.now() / 1000 + 10 * 86400, artist: "Ghost", track: "from the future" },
    ]);
    const out = await store.getScrobbles("Tester");
    expect(out).toHaveLength(1);
    expect(out[0].artist).toBe("Real");
  });

  it("persists and retrieves sync state", async () => {
    setBlobStore(new MemoryBlobStore());
    const store = new BlobScrobbleStore();
    expect(await store.getSyncState("Tester")).toBeNull();
    await store.setSyncState({
      username: "Tester",
      status: "syncing",
      pagesDone: 42,
      totalPages: 100,
      totalScrobbles: 20000,
      newestUts: T2015,
      oldestUts: T2015 - 1000,
      updatedAt: 1234567890,
    });
    const state = await store.getSyncState("Tester");
    expect(state?.pagesDone).toBe(42);
    expect(state?.oldestUts).toBe(T2015 - 1000);
  });

  it("isolates users and normalizes usernames", async () => {
    setBlobStore(new MemoryBlobStore());
    const store = new BlobScrobbleStore();
    await store.appendScrobbles("UserOne", [{ uts: T2015, artist: "A", track: "x" }]);
    expect(await store.getScrobbles("usertwo")).toEqual([]);
    // Same user, different casing: same blob.
    expect(await store.getScrobbles("userone")).toHaveLength(1);
  });
});
