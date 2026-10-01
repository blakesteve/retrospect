import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsBlobStore, MemoryBlobStore, setBlobStore, type BlobStore } from "./blob";
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

/* `has` and `list` are what removal and expiry stand on: a key `list` misses
   is a key the sweep never expires. Both local backends run the same checks;
   R2's is exercised on a deploy, not here. */
describe.each([
  ["the folder store", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "retrospect-blob-"));
    return { store: new FsBlobStore(dir) as BlobStore, dir, done: () => rm(dir, { recursive: true }) };
  }],
  ["the memory store", async () => ({ store: new MemoryBlobStore() as BlobStore, dir: "", done: async () => {} })],
])("%s: has and list", (_name, make) => {
  it("finds exactly the keys under a prefix, including one that isn't a folder", async () => {
    const { store, done } = await make();
    try {
      for (const key of ["sync/a.json", "cache/genres-a.json", "cache/other.json", "limits/removals/1-x"]) {
        await store.put(key, Buffer.from("x"));
      }
      expect((await store.list("cache/genres-")).map((l) => l.key)).toEqual(["cache/genres-a.json"]);
      expect((await store.list("sync/")).map((l) => l.key)).toEqual(["sync/a.json"]);
      expect((await store.list("tags/")).map((l) => l.key)).toEqual([]);
      expect(await store.has("sync/a.json")).toBe(true);
      expect(await store.has("sync/b.json")).toBe(false);
      await store.del("sync/a.json");
      expect(await store.has("sync/a.json")).toBe(false);
      const [listed] = await store.list("cache/other");
      expect(Math.abs(listed.lastModified - Date.now())).toBeLessThan(60_000);
    } finally {
      await done();
    }
  });
});

describe("the folder store's listing", () => {
  it("skips a write still in progress", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "retrospect-blob-"));
    try {
      const store = new FsBlobStore(dir);
      await store.put("sync/a.json", Buffer.from("x"));
      await writeFile(path.join(dir, "sync/b.json.tmp"), "half");
      expect((await store.list("sync/")).map((l) => l.key)).toEqual(["sync/a.json"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
