import { readTagStore, topArtists, writeTagStore, TOP_ARTISTS } from "./genres";
import { getStore } from "./store/jsonStore";

/**
 * Resumable tag fetcher, same philosophy as the scrobble sync: each call does
 * a budgeted chunk of artist.getTopTags lookups, checkpoints to disk, and the
 * polling client re-kicks it until every top artist is tagged.
 */
const BUDGET_MS = Number(process.env.TAGSYNC_BUDGET_MS ?? 8_000);
const CALL_DELAY_MS = Number(process.env.TAGSYNC_DELAY_MS ?? 200);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inFlight = new Set<string>();

export interface TagSyncState {
  done: number;
  total: number;
  complete: boolean;
}

export async function runTagChunk(username: string): Promise<TagSyncState> {
  const scrobbles = await getStore().getScrobbles(username);
  if (scrobbles.length === 0) return { done: 0, total: 0, complete: false };

  const wanted = topArtists(scrobbles, TOP_ARTISTS);
  const store = await readTagStore(username);
  const missing = wanted.filter((a) => !(a.artist.toLowerCase() in store.artists));

  const state = () => ({
    done: wanted.length - missing.length,
    total: wanted.length,
    complete: missing.length === 0,
  });

  if (missing.length === 0 || inFlight.has(username)) return state();
  if (!process.env.LASTFM_API_KEY) return state();

  inFlight.add(username);
  try {
    const deadline = Date.now() + BUDGET_MS;
    let dirty = false;
    for (const { artist } of missing) {
      if (Date.now() > deadline) break;
      try {
        const url = new URL("https://ws.audioscrobbler.com/2.0/");
        url.search = new URLSearchParams({
          method: "artist.getTopTags",
          artist,
          api_key: process.env.LASTFM_API_KEY!,
          format: "json",
          autocorrect: "1",
        }).toString();
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 429) break; // back off; next poll resumes
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const json: any = res.ok ? await res.json() : null;
        const tags: string[] = (json?.toptags?.tag ?? [])
          .slice(0, 6)
          .map((t: { name: string }) => t.name);
        store.artists[artist.toLowerCase()] = tags;
        dirty = true;
      } catch {
        break; // network hiccup: checkpoint what we have, resume next poll
      }
      await sleep(CALL_DELAY_MS);
    }
    if (dirty) await writeTagStore(username, store);
  } finally {
    inFlight.delete(username);
  }

  const after = await readTagStore(username);
  const remaining = wanted.filter((a) => !(a.artist.toLowerCase() in after.artists));
  return { done: wanted.length - remaining.length, total: wanted.length, complete: remaining.length === 0 };
}
