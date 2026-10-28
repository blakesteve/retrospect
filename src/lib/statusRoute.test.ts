import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { userKey } from "@/lib/store/userKeys";
import { computeOnce } from "@/lib/answers/store";
import { synthHistory } from "@/lib/answers/synthHistory";
import type { SyncState } from "@/lib/store/types";
import { requestZone } from "@/lib/zone";

/* The status route's `answersStored` (8.2): whether the page's zone has stored
   answers, the one fact the page needs to tell answers computed for the first
   time ("Checking 12 questions") from stored ones still loading (the view).
   The sync itself is a stand-in here: each call reports `state`. */
const sync = vi.hoisted(() => ({ state: null as SyncState | null }));
vi.mock("@/lib/sync", () => ({ runSyncChunk: vi.fn(async () => sync.state) }));
const { GET } = await import("@/app/api/user/[name]/status/route");

const ask = async (name: string, query = "") => {
  const res = await GET(new Request(`http://x/api/user/${name}/status${query}`), { params: Promise.resolve({ name }) });
  return { status: res.status, body: await res.json() };
};

const plays = synthHistory(2_000, 3, 2020);
const syncState = (status: SyncState["status"]): SyncState => ({
  username: "listener",
  status,
  pagesDone: 10,
  totalPages: status === "ready" ? 10 : 20,
  totalScrobbles: plays.length,
  newestUts: plays[plays.length - 1].uts,
  updatedAt: Date.now(),
});

beforeEach(async () => {
  setBlobStore(new MemoryBlobStore());
  sync.state = syncState("ready");
  // A record computed in Chicago, and none anywhere else.
  await computeOnce("listener", "America/Chicago", plays, Date.now());
});
afterEach(() => setBlobStore(null));

describe("the status route's stored answers", () => {
  it("says the page's zone has them, by the zone the record is keyed on", async () => {
    expect((await ask("listener", "?tz=America/Chicago")).body.answersStored).toBe(true);
    // Another name for a zone with a record is that record (6.6): stored as
    // the answers route stores it, under the zone the name resolves to.
    await computeOnce("listener", requestZone(new URLSearchParams("tz=Asia/Kolkata")).zone, plays, Date.now());
    expect((await ask("listener", "?tz=Asia/Calcutta")).body.answersStored).toBe(true);
    expect((await ask("listener", "?tz=Asia/Kolkata")).body.answersStored).toBe(true);
  });

  it("says a zone with no record has none, so the page checks", async () => {
    expect((await ask("listener", "?tz=Asia/Tokyo")).body.answersStored).toBe(false);
    expect((await ask("newcomer", "?tz=America/Chicago")).body.answersStored).toBe(false);
  });

  it("knows nothing without a zone, while the history is read, or if the record won't read", async () => {
    expect((await ask("listener")).body.answersStored).toBeNull();
    sync.state = syncState("syncing");
    expect((await ask("listener", "?tz=America/Chicago")).body.answersStored).toBeNull();
    sync.state = syncState("ready");
    const broken = new MemoryBlobStore();
    broken.get = async (key) => {
      if (key === userKey("answers", "listener")) throw new Error("R2 hiccup");
      return null;
    };
    setBlobStore(broken);
    const res = await ask("listener", "?tz=America/Chicago");
    // The sync's own answer still stands.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", answersStored: null });
  });
});
