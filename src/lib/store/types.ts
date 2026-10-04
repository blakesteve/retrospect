import type { Scrobble } from "@/lib/analysis/nostalgia";
import type { VisitorErrorCode } from "@/lib/visitorErrors";

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
  /** While syncing, the oldest play seen so far, so the wait screen can say
      how far back it has reached. Once `oldestIsFirstPlay`, the history's
      first play as every reader counts it (the record's first night). */
  oldestUts?: number;
  /** Set once `oldestUts` is the history's first play: by the chunk that
      finishes a backfill, or by the first refresh of a state saved before it.
      Absent on older states. */
  oldestIsFirstPlay?: boolean;
  /** Written for whoever is debugging; never shown to a visitor. */
  error?: string;
  /** What a visitor is told about `error`. Absent on states saved before it existed. */
  errorCode?: VisitorErrorCode;
  /** Blank reads of page 1 in a row, before anything was collected. Two means
      the account is empty. Absent on states saved before it existed. */
  emptyReads?: number;
  updatedAt: number; // unix ms
}

/**
 * Storage boundary. v1 ships a JSON-file implementation; the Supabase/Postgres
 * implementation replaces this interface one-for-one in build-order step 3.
 */
export interface ScrobbleStore {
  getSyncState(username: string): Promise<SyncState | null>;
  setSyncState(state: SyncState): Promise<void>;
  /** `compact` also drops lines that repeat an earlier play. */
  appendScrobbles(username: string, scrobbles: Scrobble[], opts?: { compact?: boolean }): Promise<void>;
  /** Deduped (by uts+artist+track), sorted ascending by uts. */
  getScrobbles(username: string): Promise<Scrobble[]>;
}
