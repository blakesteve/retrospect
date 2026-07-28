import { getRecentTracksPage, isTransientError } from "./lastfm";
import { getStore } from "./store/jsonStore";
import type { SyncState } from "./store/types";
import type { Scrobble } from "./analysis/nostalgia";

/**
 * Resumable sync worker.
 *
 * Designed for serverless slots: each call pulls pages for at most `budgetMs`,
 * checkpoints its cursor in the store, and returns. The polling client re-kicks
 * it via /status until the backfill completes. Backfill runs page 1 → N
 * (newest → oldest), so partial results are immediately meaningful.
 *
 * Trade-off, on purpose: new scrobbles landing mid-backfill shift page
 * boundaries and can duplicate rows across pages; the store dedupes on read.
 * After backfill, refreshes use from=newestUts and prepend cleanly.
 */
const BUDGET_MS = Number(process.env.SYNC_BUDGET_MS ?? 8_000);
const PAGE_DELAY_MS = Number(process.env.SYNC_PAGE_DELAY_MS ?? 250);
const BATCH_PAGES = Number(process.env.SYNC_BATCH_PAGES ?? 4);
const REFRESH_SECONDS = Number(process.env.SYNC_REFRESH_SECONDS ?? 3600);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-process lock so overlapping /status polls don't double-sync a user.
const inFlight = new Set<string>();

export async function runSyncChunk(username: string): Promise<SyncState> {
  const store = getStore();
  const existing = await store.getSyncState(username);

  if (inFlight.has(username)) return existing ?? notStarted(username);
  const fresh =
    existing?.status === "ready" &&
    Date.now() - existing.updatedAt < REFRESH_SECONDS * 1000;
  if (fresh) return existing!;

  inFlight.add(username);
  try {
    if (!existing) {
      return await backfill(username, notStarted(username));
    }
    if (existing.status === "syncing" || existing.status === "error") {
      // Resume from the checkpoint — including after an error. Pages already
      // pulled are on disk; re-fetched pages dedupe on read.
      return await backfill(username, {
        ...existing,
        status: "syncing",
        error: undefined,
      });
    }
    return await refresh(username, existing); // ready but stale
  } finally {
    inFlight.delete(username);
  }
}

function notStarted(username: string): SyncState {
  return {
    username,
    status: "syncing",
    pagesDone: 0,
    totalPages: 0,
    totalScrobbles: 0,
    newestUts: 0,
    updatedAt: Date.now(),
  };
}

async function backfill(username: string, state: SyncState): Promise<SyncState> {
  const store = getStore();
  const deadline = Date.now() + BUDGET_MS;

  // Collect the whole invocation's pages and flush ONCE at the end. On blob
  // storage every append is a read-modify-write of the full history, so one
  // flush per invocation instead of one per batch keeps a big backfill at
  // ~100 writes instead of ~600.
  const collected: Scrobble[] = [];
  let fatal: string | null = null;

  try {
    while (Date.now() < deadline) {
      // Fetch a batch of pages concurrently (~5 req/s is Last.fm's informal
      // budget; the client's retry/backoff self-regulates if we're pushed
      // back). First round is a single page to learn totalPages. The
      // checkpoint only advances on a fully successful batch, so a partial
      // failure re-fetches at most one batch; dedupe on read absorbs it.
      const start = state.pagesDone + 1;
      const count = state.totalPages
        ? Math.max(1, Math.min(BATCH_PAGES, state.totalPages - state.pagesDone))
        : 1;
      const results = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          getRecentTracksPage(username, start + i)
        )
      );

      for (const result of results) {
        for (const s of result.scrobbles) {
          collected.push(s);
          if (s.uts > state.newestUts) state.newestUts = s.uts;
          if (!state.oldestUts || s.uts < state.oldestUts) state.oldestUts = s.uts;
        }
      }
      state.totalPages = results[0].totalPages;
      state.totalScrobbles = results[0].totalScrobbles;
      state.pagesDone = start + count - 1;

      if (state.pagesDone >= state.totalPages) break;
      await sleep(PAGE_DELAY_MS);
    }
  } catch (err) {
    if (!isTransientError(err)) {
      fatal = err instanceof Error ? err.message : String(err);
    }
    // Transient: flush what we have and let the next poll resume.
  }

  if (collected.length > 0) {
    await store.appendScrobbles(username, collected);
  }
  state.status = fatal
    ? "error"
    : state.totalPages > 0 && state.pagesDone >= state.totalPages
      ? "ready"
      : "syncing";
  state.error = fatal ?? undefined;
  state.updatedAt = Date.now();
  await store.setSyncState(state);
  return state;
}

async function refresh(username: string, state: SyncState): Promise<SyncState> {
  const store = getStore();
  const collected: Scrobble[] = [];
  try {
    // from= returns only scrobbles newer than the cursor; usually 1 page.
    let page = 1;
    for (;;) {
      const result = await getRecentTracksPage(username, page, { from: state.newestUts });
      collected.push(...result.scrobbles);
      state.totalScrobbles = result.totalScrobbles;
      if (page >= result.totalPages) break;
      page++;
      await sleep(PAGE_DELAY_MS);
    }
    for (const s of collected) {
      if (s.uts > state.newestUts) state.newestUts = s.uts;
    }
    if (collected.length > 0) {
      await store.appendScrobbles(username, collected);
    }
    state.updatedAt = Date.now();
    await store.setSyncState(state);
  } catch {
    // Refresh failures are non-fatal: report on the data we have.
  }
  return state;
}
