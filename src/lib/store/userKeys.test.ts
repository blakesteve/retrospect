import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "./blob";
import { USER_KEY_KINDS, allUserKeys, safeName, userKey, usernameFromKey } from "./userKeys";
import { getRecentTracksPage, type RecentTracksPage } from "@/lib/lastfm";
import { runSyncChunk } from "@/lib/sync";
import { runTagChunk } from "@/lib/tagsync";
import { removeUserData, requestRemoval } from "@/lib/removal";
import { GET as genresRoute } from "@/app/api/user/[name]/genres/route";
import { GET as answersRoute } from "@/app/api/user/[name]/answers/route";

/* "Remove my data" deletes the keys in `userKeys.ts` and nothing else, and
   the expiry sweep only finds names through them. So a per-user blob stored
   under any other key is kept forever and survives a removal that says it's
   gone. The redesign is about to add stored answers; these are what fail if
   they, or anything else, skip the list. */

vi.mock("@/lib/lastfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lastfm")>();
  return { ...actual, getRecentTracksPage: vi.fn() };
});
const fetchPage = vi.mocked(getRecentTracksPage);

/** Remembers every key anything wrote. */
class RecordingStore extends MemoryBlobStore {
  written = new Set<string>();
  async put(key: string, data: Buffer): Promise<void> {
    this.written.add(key);
    return super.put(key, data);
  }
}

let store: RecordingStore;
beforeEach(() => {
  store = new RecordingStore();
  setBlobStore(store);
  fetchPage.mockReset();
});
afterEach(() => {
  setBlobStore(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the list of per-user keys", () => {
  it("is exactly these five, sync state first", () => {
    // Literals, so a key renamed or added shows up here as a decision.
    expect(allUserKeys("Some.Listener")).toEqual([
      "sync/some_listener.json",
      "scrobbles/some_listener.jsonl.gz",
      "tags/some_listener.json",
      "cache/genres-some_listener.json",
      "answers/some_listener.json",
    ]);
  });

  it("reads every key back to the name it belongs to", () => {
    for (const kind of Object.keys(USER_KEY_KINDS) as (keyof typeof USER_KEY_KINDS)[]) {
      expect(usernameFromKey(userKey(kind, "Some.Listener"))).toBe("some_listener");
    }
    expect(usernameFromKey("limits/removals/000001-abc-def")).toBeNull();
    expect(usernameFromKey("scrobbles-lordclean.jsonl")).toBeNull();
  });
});

describe("everything the app writes for a listener", () => {
  it("is on the list, and a removal leaves none of it", async () => {
    const name = "Key.Tester";
    const uts = Date.UTC(2025, 5, 1) / 1000;
    const plays = [
      { uts, artist: "Alpha", track: "one" },
      { uts: uts + 600, artist: "Beta", track: "two" },
    ];
    fetchPage.mockResolvedValue({
      scrobbles: plays,
      page: 1,
      totalPages: 1,
      totalScrobbles: plays.length,
    } satisfies RecentTracksPage);
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ toptags: { tag: [{ name: "indie rock" }] } })),
    );

    // Every writer there is today: the sync, the tag fetch, the genre route,
    // and the answers route.
    expect((await runSyncChunk(name)).status).toBe("ready");
    expect((await runTagChunk(name)).complete).toBe(true);
    const res = await genresRoute(new Request("http://x/api/user/Key.Tester/genres"), {
      params: Promise.resolve({ name }),
    });
    expect(res.status).toBe(200);
    const answered = await answersRoute(new Request("http://x/api/user/Key.Tester/answers?tz=UTC"), {
      params: Promise.resolve({ name }),
    });
    expect(answered.status).toBe(200);

    // Nothing written for this listener outside the list...
    for (const key of store.written) {
      expect(usernameFromKey(key), `${key} isn't in userKeys.ts`).toBe(safeName(name));
    }
    // ...and every kind on the list was really written, so this exercise
    // keeps up with the list. A kind added there needs a writer run here.
    expect([...store.written].sort()).toEqual([...allUserKeys(name)].sort());

    await removeUserData(name);
    const left = (await store.list("")).map(({ key }) => key);
    expect(left.filter((key) => key.includes(safeName(name)))).toEqual([]);
  });
});

/* The page's GenresPanel polls /genres on its own, and a first analysis can
   run half a minute. Someone who follows the footer link to /remove while it
   runs gets "removed", and the request, still running on the server, then
   writes their tags or genre results straight back. Each writer now checks,
   after writing, whether the name was removed since it started. */
describe("a genre request that outlives a removal", () => {
  const name = "Genre.Racer";
  const uts = Date.UTC(2025, 5, 1) / 1000;

  beforeEach(async () => {
    fetchPage.mockResolvedValue({
      scrobbles: [{ uts, artist: "Alpha", track: "one" }],
      page: 1,
      totalPages: 1,
      totalScrobbles: 1,
    } satisfies RecentTracksPage);
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    expect((await runSyncChunk(name)).status).toBe("ready");
  });

  const callGenres = () =>
    genresRoute(new Request("http://x/api/user/Genre.Racer/genres"), {
      params: Promise.resolve({ name }),
    });
  const left = async () =>
    (await store.list("")).map(({ key }) => key).filter((key) => key.includes(safeName(name)));

  it("takes the tags back when the removal lands during the lookups", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        expect((await requestRemoval(name)).kind).toBe("removed");
        return Response.json({ toptags: { tag: [{ name: "indie rock" }] } });
      }),
    );
    await callGenres();
    expect(await left()).toEqual([]);
  });

  it("takes the genre results back when the removal lands during the analysis", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ toptags: { tag: [{ name: "indie rock" }] } })));
    expect((await runTagChunk(name)).complete).toBe(true);
    const put = store.put.bind(store);
    store.put = async (key: string, data: Buffer) => {
      if (key.startsWith("cache/genres-")) expect((await requestRemoval(name)).kind).toBe("removed");
      return put(key, data);
    };
    const res = await callGenres();
    expect(res.status).not.toBe(200);
    expect(await left()).toEqual([]);
  });
});

/* The runtime test above only covers writers it knows to run. This one
   covers the rest by reading the source: any module that reaches the blob
   store directly must be on this list, with a reason. A new one fails here
   until somebody decides whether it stores anything per listener, and if it
   does, puts its key in `userKeys.ts`. */
describe("modules that touch the blob store", () => {
  const root = path.resolve(__dirname, "../../..");
  const ALLOWED: Record<string, string> = {
    "src/lib/store/blob.ts": "defines the store",
    "src/lib/store/r2.ts": "one of its backends",
    "src/lib/store/jsonStore.ts": "scrobbles and sync state, keyed through userKeys.ts",
    "src/lib/genres.ts": "the tag store, keyed through userKeys.ts",
    "src/app/api/user/[name]/genres/route.ts": "the genre cache, keyed through userKeys.ts",
    "src/lib/removal.ts": "deletes userKeys.ts's keys; its own markers hold a hash, not a name",
    "src/lib/expiry.ts": "lists userKeys.ts's prefixes",
    "src/lib/answers/store.ts": "stored answers, keyed through userKeys.ts",
  };
  const TOUCHES_STORE = /\b(getBlobStore|FsBlobStore|R2BlobStore)\b|@aws-sdk\/client-s3/;
  /* A key built by hand: any string that opens with a folder, whether it's
     interpolated or concatenated. The two backends are exempt (they know no
     keys, only comments about them), and so is the one prefix that isn't
     per user: the removal markers, which hold a hash, not a name. */
  const HAND_BUILT_KEY = /["'`][a-z][a-z-]*\/(?!\/)/g;
  const NOT_PER_USER = new Set(['"limits/']);
  const BACKENDS = new Set(["src/lib/store/blob.ts", "src/lib/store/r2.ts"]);
  /** Code only: comments name files in backticks, and imports are paths. */
  const codeOf = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/\bfrom\s+["'][^"']+["']/g, "")
      .replace(/\bimport\(\s*["'][^"']+["']\s*\)/g, "");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
  const sources = ["src/app", "src/lib", "src/components"].flatMap((dir) => walk(path.join(root, dir)));

  it("is every module that does, and none of them builds a key by hand", () => {
    const rel = (file: string) => path.relative(root, file);
    // A positive control: if the walk broke, the checks below would pass on nothing.
    expect(sources.map(rel)).toContain("src/lib/store/jsonStore.ts");

    const touching = sources.filter((file) => TOUCHES_STORE.test(readFileSync(file, "utf8")));
    expect(touching.map(rel).filter((file) => !(file in ALLOWED))).toEqual([]);
    const handBuilt = touching
      .filter((file) => !BACKENDS.has(rel(file)))
      .flatMap((file) =>
        (codeOf(file).match(HAND_BUILT_KEY) ?? [])
          .filter((found) => !NOT_PER_USER.has(found))
          .map((found) => `${rel(file)}: ${found}`),
      );
    expect(handBuilt).toEqual([]);
  });
});
