import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./store/blob";
import { getStore } from "./store/jsonStore";
import { allUserKeys, safeName } from "./store/userKeys";
import { requestRemoval } from "./removal";
import * as removeRoute from "@/app/api/user/[name]/remove/route";

/* The limits are pinned as literal durations and counts: a day between two
   removals of one name, twenty removals a day in all. Read from the
   constants, these would pass whatever the constants said. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 30, 12);

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
});

/** Something stored under every key, the way a synced listener has. */
async function seed(username: string) {
  for (const key of allUserKeys(username)) await store.put(key, Buffer.from("x"));
  await getStore().setSyncState({
    username,
    status: "ready",
    pagesDone: 1,
    totalPages: 1,
    totalScrobbles: 1,
    newestUts: T0 / 1000 - 60,
    updatedAt: Date.now(),
  });
}

const keysFor = async (username: string) =>
  (await store.list("")).map(({ key }) => key).filter((key) => key.includes(safeName(username)));
const markers = async () => (await store.list("limits/removals/")).length;

describe("removing a username", () => {
  it("deletes every stored key and reads each one back", async () => {
    await seed("Remove.Me");
    const outcome = await requestRemoval("Remove.Me");
    expect(outcome.kind).toBe("removed");
    if (outcome.kind !== "removed") return;
    expect(outcome.keys).toEqual([
      { key: "sync/remove_me.json", existed: true, gone: true },
      { key: "scrobbles/remove_me.jsonl.gz", existed: true, gone: true },
      { key: "tags/remove_me.json", existed: true, gone: true },
      { key: "cache/genres-remove_me.json", existed: true, gone: true },
      { key: "answers/remove_me.json", existed: true, gone: true },
    ]);
    expect(await keysFor("Remove.Me")).toEqual([]);
  });

  it("leaves other listeners alone", async () => {
    await seed("remove-me");
    await seed("keep-me");
    await requestRemoval("remove-me");
    expect(await keysFor("keep-me")).toHaveLength(5);
  });

  it("says so when nothing is stored, without using up a removal", async () => {
    expect((await requestRemoval("never-looked-up")).kind).toBe("nothing-stored");
    expect(await markers()).toBe(0);
  });

  it("waits while the history is being read, and not after", async () => {
    await seed("mid-read");
    const syncing = async (ageMs: number) => {
      const state = (await getStore().getSyncState("mid-read"))!;
      await getStore().setSyncState({ ...state, status: "syncing", updatedAt: Date.now() - ageMs });
    };
    await syncing(59_000);
    expect((await requestRemoval("mid-read")).kind).toBe("busy");
    expect(await keysFor("mid-read")).toHaveLength(5);
    // A read abandoned a minute ago isn't running any more.
    await syncing(61_000);
    expect((await requestRemoval("mid-read")).kind).toBe("removed");
  });
});

describe("a removal that doesn't finish", () => {
  it("gives its claim back, so the retry isn't told to wait a day", async () => {
    await seed("half-removed");
    const del = store.del.bind(store);
    store.del = async (key: string) => {
      if (key.startsWith("scrobbles/")) throw new Error("R2 hiccup");
      return del(key);
    };
    await expect(requestRemoval("half-removed")).rejects.toThrow("R2 hiccup");
    expect(await markers()).toBe(0);

    store.del = del;
    expect((await requestRemoval("half-removed")).kind).toBe("removed");
    expect(await keysFor("half-removed")).toEqual([]);
  });

  it("says so, and gives its claim back, when a key is still there afterward", async () => {
    await seed("stuck-key");
    const del = store.del.bind(store);
    // The listener's keys won't delete; the claim still can.
    store.del = async (key: string) => (key.startsWith("limits/") ? del(key) : undefined);
    const outcome = await requestRemoval("stuck-key");
    expect(outcome.kind).toBe("failed");
    expect(await markers()).toBe(0);
  });
});

describe("the per-username limit", () => {
  it("allows one removal of a name a day", async () => {
    await seed("wiped");
    expect((await requestRemoval("wiped")).kind).toBe("removed");

    // Somebody looks it up again, then someone tries to wipe it again.
    await seed("wiped");
    vi.setSystemTime(T0 + DAY - 60_000);
    const refused = await requestRemoval("wiped");
    expect(refused).toEqual({ kind: "cooldown", retryAt: T0 + DAY });
    expect(await keysFor("wiped")).toHaveLength(5);

    vi.setSystemTime(T0 + DAY + 60_000);
    expect((await requestRemoval("wiped")).kind).toBe("removed");
  });

  it("counts names the way the store does, so casing can't dodge it", async () => {
    await seed("Wiped");
    await requestRemoval("Wiped");
    await seed("wiped");
    expect((await requestRemoval("WIPED")).kind).toBe("cooldown");
  });
});

describe("the cap across all usernames", () => {
  it("stops at twenty removals a day", async () => {
    for (let i = 0; i < 20; i++) {
      await seed(`listener-${i}`);
      vi.setSystemTime(T0 + i * HOUR);
      expect((await requestRemoval(`listener-${i}`)).kind).toBe("removed");
    }
    await seed("listener-20");
    vi.setSystemTime(T0 + 20 * HOUR);
    // A slot frees when the first removal is a day old.
    expect(await requestRemoval("listener-20")).toEqual({ kind: "too-many", retryAt: T0 + DAY });
    expect(await keysFor("listener-20")).toHaveLength(5);

    vi.setSystemTime(T0 + DAY + 1);
    expect((await requestRemoval("listener-20")).kind).toBe("removed");
  });

  it("lets twenty sent at once all through", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `twenty-${i}`);
    for (const name of names) await seed(name);
    const outcomes = await Promise.all(names.map((name) => requestRemoval(name)));
    // Refusing too many is the safe side, but not at the cap itself.
    expect(outcomes.filter((o) => o.kind === "removed")).toHaveLength(20);
  });

  it("holds against a burst sent all at once", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `burst-${i}`);
    for (const name of names) await seed(name);
    const outcomes = await Promise.all(names.map((name) => requestRemoval(name)));
    const removed = outcomes.filter((o) => o.kind === "removed").length;
    // A counter read before it's written lets all 25 through.
    expect(removed).toBeLessThanOrEqual(20);
    // Refusals take their markers back with them.
    expect(await markers()).toBe(removed);
  });
});

describe("the removal route", () => {
  const post = (name: string, body?: unknown) =>
    removeRoute.POST(
      new Request(`http://x/api/user/${name}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ name }) },
    );

  it("has no GET, so a crawler or a link preview can't remove anything", () => {
    expect("GET" in removeRoute).toBe(false);
    expect(typeof removeRoute.POST).toBe("function");
  });

  it("does nothing unless the body repeats the name", async () => {
    await seed("confirm-me");
    expect((await post("confirm-me")).status).toBe(400);
    expect((await post("confirm-me", { confirm: "someone-else" })).status).toBe(400);
    expect(await keysFor("confirm-me")).toHaveLength(5);

    const res = await post("confirm-me", { confirm: "Confirm-Me" });
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("removed");
    expect(await keysFor("confirm-me")).toEqual([]);
  });

  it("answers a limit with when to try again", async () => {
    await seed("limited");
    await post("limited", { confirm: "limited" });
    await seed("limited");
    const res = await post("limited", { confirm: "limited" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(24 * 60 * 60));
    expect(await res.json()).toEqual({ outcome: "cooldown", retryAt: T0 + DAY });
  });
});
