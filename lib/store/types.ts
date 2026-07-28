import type { Scrobble } from "@/lib/analysis/nostalgia";

export type SyncStatus = "syncing" | "ready" | "error";

export interface SyncState {
  username: string;
  status: SyncStatus;
  /** Backfill cursor: last page fetched (page 1 = newest). */
  pagesDone: number;
  totalPages: number;
  totalScrobbles: number;
  /** Newest scrobble uts seen — cursor for incremental refresh. */
  newestUts: number;
  /** Oldest scrobble uts seen so far — lets the UI show how far back we've reached. */
  oldestUts?: number;
  error?: string;
  updatedAt: number; // unix ms
}

/**
 * Storage boundary. v1 ships a JSON-file implementation; the Supabase/Postgres
 * implementation replaces this interface one-for-one in build-order step 3.
 */
export interface ScrobbleStore {
  getSyncState(username: string): Promise<SyncState | null>;
  setSyncState(state: SyncState): Promise<void>;
  appendScrobbles(username: string, scrobbles: Scrobble[]): Promise<void>;
  /** Deduped (by uts+artist+track), sorted ascending by uts. */
  getScrobbles(username: string): Promise<Scrobble[]>;
}
