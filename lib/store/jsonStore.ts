import { gzipSync, gunzipSync } from "node:zlib";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { getBlobStore } from "./blob";
import type { ScrobbleStore, SyncState } from "./types";

/**
 * Scrobble store over the blob layer. Histories live as one gzipped JSONL
 * blob per user (a 500k-play library is ~6-8MB compressed), sync state as a
 * small JSON doc. Appends are read-modify-write on the whole blob, which is
 * why the sync worker batches to one append per invocation. Dedupe and
 * timestamp sanitization happen on read.
 */
const safe = (u: string) => u.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
const scrobbleKey = (u: string) => `scrobbles/${safe(u)}.jsonl.gz`;
const stateKey = (u: string) => `sync/${safe(u)}.json`;

export class BlobScrobbleStore implements ScrobbleStore {
  /** Per-instance parse cache: polls re-read the same blob many times. */
  private memo = new Map<string, { bytes: number; scrobbles: Scrobble[] }>();

  async getSyncState(username: string): Promise<SyncState | null> {
    const raw = await getBlobStore().get(stateKey(username));
    if (!raw) return null;
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
  }

  async setSyncState(state: SyncState): Promise<void> {
    await getBlobStore().put(
      stateKey(state.username),
      Buffer.from(JSON.stringify(state))
    );
  }

  async appendScrobbles(username: string, scrobbles: Scrobble[]): Promise<void> {
    if (scrobbles.length === 0) return;
    const store = getBlobStore();
    const key = scrobbleKey(username);
    const existing = await store.get(key);
    const prior = existing ? gunzipSync(existing).toString("utf8") : "";
    const lines = scrobbles.map((s) => JSON.stringify(s)).join("\n") + "\n";
    await store.put(key, gzipSync(prior + lines));
    this.memo.delete(safe(username));
  }

  async getScrobbles(username: string): Promise<Scrobble[]> {
    const raw = await getBlobStore().get(scrobbleKey(username));
    if (!raw) return [];

    const memoKey = safe(username);
    const hit = this.memo.get(memoKey);
    if (hit && hit.bytes === raw.length) return hit.scrobbles;

    // Sanity bounds: Last.fm launched March 2002, yet real libraries contain
    // corrupted epoch-zero timestamps ("scrobbled in Dec 1969") that would
    // poison the analysis span. Drop anything impossible.
    const MIN_UTS = Date.UTC(2002, 2, 1) / 1000;
    const maxUts = Date.now() / 1000 + 2 * 86400;
    const seen = new Set<string>();
    const scrobbles: Scrobble[] = [];
    for (const line of gunzipSync(raw).toString("utf8").split("\n")) {
      if (!line) continue;
      let s: Scrobble;
      try {
        s = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Number.isFinite(s.uts) || s.uts < MIN_UTS || s.uts > maxUts) continue;
      const key = `${s.uts}|${s.artist}|${s.track}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scrobbles.push(s);
    }
    scrobbles.sort((a, b) => a.uts - b.uts);
    this.memo.set(memoKey, { bytes: raw.length, scrobbles });
    return scrobbles;
  }
}

// Module-level singleton; survives across requests within one server process.
let store: ScrobbleStore | null = null;
export function getStore(): ScrobbleStore {
  return (store ??= new BlobScrobbleStore());
}
