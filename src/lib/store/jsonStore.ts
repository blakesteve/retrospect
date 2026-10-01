import { gzipSync, gunzipSync } from "node:zlib";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { getBlobStore } from "./blob";
import type { ScrobbleStore, SyncState } from "./types";
import { safeName, userKey } from "./userKeys";

/**
 * Scrobble store over the blob layer. Histories live as one gzipped JSONL
 * blob per user (a 500k-play library is ~6-8MB compressed), sync state as a
 * small JSON doc. Appends are read-modify-write on the whole blob, which is
 * why the sync worker batches to one append per invocation. Dedupe and
 * timestamp sanitization happen on read.
 */
const scrobbleKey = (u: string) => userKey("scrobbles", u);
const stateKey = (u: string) => userKey("sync", u);

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

  /**
   * Adds plays to the stored history. With `compact`, the rewrite also drops
   * every line that repeats an earlier one, as reads do: a backfill keeps
   * them on purpose while pages shift under it, and they were 21% of the
   * largest real history (step 0). The sync asks for it once, on the chunk
   * that finishes a backfill, so it costs no extra write.
   */
  async appendScrobbles(username: string, scrobbles: Scrobble[], opts: { compact?: boolean } = {}): Promise<void> {
    if (scrobbles.length === 0 && !opts.compact) return;
    const store = getBlobStore();
    const key = scrobbleKey(username);
    const existing = await store.get(key);
    if (!existing && scrobbles.length === 0) return;
    const prior = existing ? gunzipSync(existing).toString("utf8") : "";
    const lines = scrobbles.map((s) => JSON.stringify(s) + "\n").join("");
    await store.put(key, gzipSync(opts.compact ? withoutRepeats(prior + lines) : prior + lines));
    this.memo.delete(safeName(username));
  }

  async getScrobbles(username: string): Promise<Scrobble[]> {
    const raw = await getBlobStore().get(scrobbleKey(username));
    if (!raw) return [];

    const memoKey = safeName(username);
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

/** The history's lines, each play once (the first time it appears), keyed
    the way reads key it. Lines that don't parse go, since reads skip them. */
function withoutRepeats(text: string): string {
  const seen = new Set<string>();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    let s: Scrobble;
    try {
      s = JSON.parse(line);
    } catch {
      continue;
    }
    const key = `${s.uts}|${s.artist}|${s.track}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out += line + "\n";
  }
  return out;
}

// Module-level singleton; survives across requests within one server process.
let store: ScrobbleStore | null = null;
export function getStore(): ScrobbleStore {
  return (store ??= new BlobScrobbleStore());
}
