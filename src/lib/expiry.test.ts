import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { allUserKeys, safeName, userKey } from "./store/userKeys";
import { expireStaleHistories } from "./expiry";
import { requestRemoval } from "./removal";
import { GET as expireRoute } from "@/app/api/cron/expire/route";

/* Stored history used to be kept forever. It now goes 90 days after its name
   was last looked up. The days are literals: a test that read `KEEP_DAYS`
   would pass at any number. */

const DAY = 24 * 3_600_000;
const T0 = Date.UTC(2026, 5, 1, 12);

let store: MemoryBlobStore;
beforeEach(() => {
  store = new MemoryBlobStore();
  setBlobStore(store);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  setBlobStore(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Write keys for a name at a given time. The memory store stamps writes with
    the clock, the way R2 stamps LastModified. */
async function writeAt(at: number, keys: string[]) {
  vi.setSystemTime(at);
  for (const key of keys) await store.put(key, Buffer.from("x"));
}
const keysFor = async (username: string) =>
  (await store.list("")).map(({ key }) => key).filter((key) => key.includes(safeName(username)));

describe("the expiry sweep", () => {
  it("removes a history 90 days after its last visit, and not before", async () => {
    await writeAt(T0, allUserKeys("ninety-one"));
    await writeAt(T0 + 2 * DAY, allUserKeys("eighty-nine"));

    vi.setSystemTime(T0 + 91 * DAY);
    const summary = await expireStaleHistories();

    expect(await keysFor("ninety-one")).toEqual([]);
    expect(await keysFor("eighty-nine")).toHaveLength(6);
    expect(summary).toEqual({ usernames: 2, expired: 1, revisited: 0, deferred: 0, markersPruned: 0 });
  });

  it("goes by a name's newest write, so a recent re-read keeps all of it", async () => {
    await writeAt(T0, allUserKeys("revisited"));
    // A visit 5 days later re-read the history: only the sync state changed.
    await writeAt(T0 + 5 * DAY, [userKey("sync", "revisited")]);

    vi.setSystemTime(T0 + 91 * DAY);
    const summary = await expireStaleHistories();
    expect(await keysFor("revisited")).toHaveLength(6);
    // Judged fresh from the listing itself, not saved by the last-moment check.
    expect(summary).toMatchObject({ expired: 0, revisited: 0 });
  });

  it("keeps a name looked up again after the listing but before its turn", async () => {
    await writeAt(T0, allUserKeys("came-back"));
    vi.setSystemTime(T0 + 91 * DAY);
    // The listing reads sync/ first; the visit lands while tags/ is being listed.
    const list = store.list.bind(store);
    store.list = async (prefix: string) => {
      if (prefix === "tags/") await store.put(userKey("sync", "came-back"), Buffer.from("x"));
      return list(prefix);
    };
    const summary = await expireStaleHistories();
    expect(await keysFor("came-back")).toHaveLength(6);
    expect(summary.revisited).toBe(1);
  });

  it("expires leftovers too: a tag store with no history beside it", async () => {
    await writeAt(T0, [userKey("tags", "lone-tags")]);
    await writeAt(T0 + 80 * DAY, [userKey("genres", "young-leftover")]);

    vi.setSystemTime(T0 + 91 * DAY);
    await expireStaleHistories();
    expect(await keysFor("lone-tags")).toEqual([]);
    expect(await keysFor("young-leftover")).toHaveLength(1);
  });

  it("prunes removal markers a day old, and keeps younger ones", async () => {
    await writeAt(T0, allUserKeys("removed-early"));
    await requestRemoval("removed-early");
    vi.setSystemTime(T0 + 12 * 3_600_000);
    await writeAt(T0 + 12 * 3_600_000, allUserKeys("removed-late"));
    await requestRemoval("removed-late");

    vi.setSystemTime(T0 + DAY + 60_000);
    const { markersPruned } = await expireStaleHistories();
    expect(markersPruned).toBe(1);
    expect(await store.list("limits/removals/")).toHaveLength(1);
  });

  it("leaves keys that belong to nobody alone", async () => {
    await writeAt(T0, ["scrobbles-lordclean.jsonl", "cache/other.json"]);
    vi.setSystemTime(T0 + 400 * DAY);
    await expireStaleHistories();
    expect((await store.list("")).map(({ key }) => key).sort()).toEqual([
      "cache/other.json",
      "scrobbles-lordclean.jsonl",
    ]);
  });
});

describe("the cron route", () => {
  const call = (auth?: string) =>
    expireRoute(
      new Request("http://x/api/cron/expire", auth ? { headers: { authorization: auth } } : {}),
    );

  beforeEach(async () => {
    await writeAt(T0, allUserKeys("stale"));
    vi.setSystemTime(T0 + 91 * DAY);
  });

  it("refuses everyone, and removes nothing, when no secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(503);
    expect(await keysFor("stale")).toHaveLength(6);
  });

  it("refuses a request without the secret, so a crawler's GET does nothing", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-for-tests");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-value-for-tests")).status).toBe(401);
    expect(await keysFor("stale")).toHaveLength(6);
  });

  it("sweeps when Vercel's own request brings the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-for-tests");
    const res = await call("Bearer s3cret-value-for-tests");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keepDays: 90,
      usernames: 1,
      expired: 1,
      revisited: 0,
      deferred: 0,
      markersPruned: 0,
    });
    expect(await keysFor("stale")).toEqual([]);
  });
});
