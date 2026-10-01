import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { getStore } from "@/lib/store/jsonStore";
import { requestRemoval } from "@/lib/removal";
import { synthHistory } from "./synthHistory";
import { ANSWERS_VERSION } from "./engine";
import { MAX_ZONES, RETRY_INCOMPLETE_MS, computeOnce, isCurrent, readAnswers } from "./store";
import { computeAnswers } from "./engine";

/* `after()` needs a live request; here it runs the job straight away and
   keeps the promise, so a test can wait for the background recompute. */
const background: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (job: () => Promise<unknown>) => void background.push(job()) };
});

const { GET } = await import("@/app/api/user/[name]/answers/route");

const ask = async (name: string, query = "tz=America/Chicago") => {
  const res = await GET(new Request(`http://x/api/user/${name}/answers?${query}`), {
    params: Promise.resolve({ name }),
  });
  return { status: res.status, body: await res.json() };
};

const plays = synthHistory(6_000, 5, 2016);
async function seed(name: string, status: "ready" | "syncing" = "ready", history = plays) {
  await getStore().appendScrobbles(name, history);
  await getStore().setSyncState({
    username: name,
    status,
    pagesDone: 1,
    totalPages: 1,
    totalScrobbles: history.length,
    newestUts: history[history.length - 1].uts,
    updatedAt: Date.now(),
  });
}

beforeEach(() => setBlobStore(new MemoryBlobStore()));
afterEach(async () => {
  await Promise.all(background.splice(0));
  setBlobStore(null);
});

describe("the answers route", () => {
  it("computes on the first request, stores the record, and serves it ready", async () => {
    await seed("first");
    const { status, body } = await ask("first");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ready", done: 12, total: 12, version: ANSWERS_VERSION, zone: "America/Chicago", zoneFellBack: false });
    expect(body.questions.map((q: { number: number }) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // NASA's two are "not checked" until step 4 brings the log.
    expect(body.questions[6]).toMatchObject({ id: "storms", word: "Not checked", notChecked: "nasa" });
    expect(body.questions[7].phrases.wordLine).toBe("Not checked yet: NASA's log didn't load.");
    const stored = await readAnswers("first", "America/Chicago");
    expect(stored?.stamp).toBe(`${plays.length}|${plays[0].uts}|${plays[plays.length - 1].uts}`);
  });

  it("serves a current record without recomputing", async () => {
    await seed("current");
    const first = await ask("current");
    const again = await ask("current");
    expect(again.body.status).toBe("ready");
    expect(again.body.questions).toEqual(first.body.questions);
    expect(background).toHaveLength(0);
  });

  it("serves a record that's behind at once, as updating, then recomputes it", async () => {
    await seed("grows");
    const before = (await ask("grows")).body;
    const more = [{ uts: plays[plays.length - 1].uts + 3_600, artist: "Artist 1", track: "Track 2" }];
    await getStore().appendScrobbles("grows", more);
    const stale = await ask("grows");
    expect(stale.body.status).toBe("updating");
    expect(stale.body.stamp).toBe(before.stamp);
    await Promise.all(background.splice(0));
    expect((await readAnswers("grows", "America/Chicago"))?.stamp).toBe(
      `${plays.length + 1}|${plays[0].uts}|${more[0].uts}`,
    );
    expect((await ask("grows")).body.status).toBe("ready");
  });

  it("computes nothing while the history is still being read", async () => {
    await seed("reading", "syncing");
    expect((await ask("reading")).body).toMatchObject({ status: "computing", done: 0, total: 12 });
    expect(await readAnswers("reading", "America/Chicago")).toBeNull();
  });

  it("keeps a record per zone, the newest few", async () => {
    await seed("travels");
    const zones = ["America/Chicago", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "America/Sao_Paulo"];
    for (const tz of zones) expect((await ask("travels", `tz=${tz}`)).body.zone).toBe(tz);
    expect(MAX_ZONES).toBe(4);
    expect(await readAnswers("travels", "America/Chicago")).toBeNull(); // the oldest went
    expect((await readAnswers("travels", "America/Sao_Paulo"))?.zone).toBe("America/Sao_Paulo");
  });

  it("reads in UTC, and says so, when the zone is missing", async () => {
    await seed("nozone");
    expect((await ask("nozone", "")).body).toMatchObject({ zone: "UTC", zoneFellBack: true });
  });

  it("answers an empty history the way the other routes do", async () => {
    const res = await ask("nobody");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("not-synced");
  });

  it("refuses a name Last.fm couldn't have", async () => {
    expect((await ask("not a name!")).status).toBe(400);
  });

  it("takes its answers back when a removal lands while it computes", async () => {
    await seed("racer");
    const blobs = new MemoryBlobStore();
    setBlobStore(blobs);
    await seed("racer");
    /* The removal lands while the answers are computing: after they started,
       before their write. It finds nothing of theirs to delete, so only the
       route taking its write back can leave none behind. */
    const put = blobs.put.bind(blobs);
    vi.spyOn(blobs, "put").mockImplementation(async (key, data) => {
      if (key.startsWith("answers/")) expect((await requestRemoval("racer")).kind).toBe("removed");
      await put(key, data);
    });
    await ask("racer");
    expect(await readAnswers("racer", "America/Chicago")).toBeNull();
  });
});

describe("the answers store", () => {
  it("takes the answers back for a removal between reading the history and computing", async () => {
    /* The removal lands right after the history is read, and the computing
       starts long after (a big history parses for seconds). It must still
       count: the request began before the removal. */
    await seed("gap");
    const store = getStore();
    const read = store.getScrobbles.bind(store);
    const realNow = Date.now;
    vi.spyOn(store, "getScrobbles").mockImplementation(async (name) => {
      const plays = await read(name);
      expect((await requestRemoval(name)).kind).toBe("removed");
      const later = realNow() + 10_000;
      vi.spyOn(Date, "now").mockImplementation(() => later);
      return plays;
    });
    try {
      await ask("gap");
      expect(await readAnswers("gap", "America/Chicago")).toBeNull();
    } finally {
      vi.restoreAllMocks(); // getScrobbles and Date.now
    }
  });

  it("keeps both zones computed at the same time", async () => {
    await seed("twozones");
    await Promise.all([ask("twozones", "tz=America/Chicago"), ask("twozones", "tz=Asia/Tokyo")]);
    expect((await readAnswers("twozones", "America/Chicago"))?.zone).toBe("America/Chicago");
    expect((await readAnswers("twozones", "Asia/Tokyo"))?.zone).toBe("Asia/Tokyo");
  });

  it("doesn't hand a request with newer plays the job started on older ones", async () => {
    await seed("newer");
    const older = plays.slice(0, -1);
    const [a, b] = await Promise.all([
      computeOnce("newer", "UTC", older, Date.now()),
      computeOnce("newer", "UTC", plays, Date.now()),
    ]);
    expect(a.stamp).not.toBe(b.stamp);
    expect(b.stamp).toBe(`${plays.length}|${plays[0].uts}|${plays[plays.length - 1].uts}`);
  });

  it("counts a record current only on the same history, version and NASA log", () => {
    const record = computeAnswers("current-check", plays, "UTC", 1_000);
    expect(isCurrent(record, plays, null, 2_000)).toBe(true);
    expect(isCurrent(record, plays.slice(1), null, 2_000)).toBe(false);
    expect(isCurrent(record, plays, "2026-10-01", 2_000)).toBe(false);
    // A question that threw is retried, but at most once an hour.
    const incomplete = { ...record, incomplete: true };
    expect(isCurrent(incomplete, plays, null, 1_000 + RETRY_INCOMPLETE_MS - 1)).toBe(true);
    expect(isCurrent(incomplete, plays, null, 1_000 + RETRY_INCOMPLETE_MS)).toBe(false);
    expect(RETRY_INCOMPLETE_MS).toBe(60 * 60 * 1000);
  });
});
