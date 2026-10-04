import { getRecentTracksPage, isTransientError, syncErrorCode } from "./lastfm";
import type { VisitorErrorCode } from "./visitorErrors";
import { getStore } from "./store/jsonStore";
import type { SyncState } from "./store/types";
import { userKey } from "./store/userKeys";
import { takeBackIfRemoved } from "./removal";
import { isNoiseArtist } from "./noise";
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
/* `||`, not `??`, and the guard sits on the string rather than on the number.
   `??` only falls back on null and undefined, so a variable that is present but
   empty reaches `Number("")`, which is 0 rather than NaN. A budget of 0 ms ends
   the backfill loop before its first page and leaves the sync permanently
   "syncing", with the client re-polling a worker that can never finish.
   Guarding the string instead of the result keeps an explicit "0" meaningful,
   which matters for the delay: 0 is a legitimate setting there.

   Exported for `sync-env.test.ts`, which is the only thing that can tell a
   working guard from a broken one: under test these variables are simply
   absent, and absent resolves the same either way. */
export const BUDGET_MS = Number(process.env.SYNC_BUDGET_MS?.trim() || 8_000);
export const PAGE_DELAY_MS = Number(process.env.SYNC_PAGE_DELAY_MS?.trim() || 250);
export const BATCH_PAGES = Number(process.env.SYNC_BATCH_PAGES?.trim() || 4);
export const REFRESH_SECONDS = Number(process.env.SYNC_REFRESH_SECONDS?.trim() || 3600);

/* How long an EMPTY ready history counts as fresh. The hour above is right
   for a history with plays in it and backwards for one without: the page has
   just told that person to go and scrobble, so theirs is the state that needs
   re-reading soonest.

   A minute, because a window much shorter buys little: Last.fm records a play
   once half the song has played, or four minutes, whichever comes first (and
   never a song under 30 seconds), so a typical three-to-four-minute song
   can't show up until a couple of minutes after it starts. A re-check costs
   one request for page 1, which is what every poll of a failed sync already
   spends, so a minute also caps what repeated visits to one empty name can
   cost at one Last.fm call a minute.

   A plain constant rather than a setting, because the page states it in
   words ("at most once a minute"), and the two must not drift apart. */
export const EMPTY_REFRESH_SECONDS = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-process lock so overlapping /status polls don't double-sync a user.
const inFlight = new Set<string>();

export async function runSyncChunk(username: string): Promise<SyncState> {
  const store = getStore();
  const startedAt = Date.now();
  const existing = await store.getSyncState(username);

  if (inFlight.has(username)) return existing ?? notStarted(username);
  // Nothing collected means nothing stored: an empty history.
  const empty = existing?.newestUts === 0;
  const freshFor = (empty ? EMPTY_REFRESH_SECONDS : REFRESH_SECONDS) * 1000;
  const fresh =
    existing?.status === "ready" && Date.now() - existing.updatedAt < freshFor;
  if (fresh) return existing!;

  inFlight.add(username);
  try {
    if (!existing) {
      return await backfill(username, notStarted(username), false, startedAt);
    }
    /* An empty history goes back through the backfill, not `refresh`: with
       no newest play to read from, `refresh` would ask for everything and
       walk every page in one request, with no budget. Someone who scrobbled
       a lot since the last look would time the request out. The backfill
       reads page 1 again and checkpoints as it goes. */
    if (existing.status === "syncing" || existing.status === "error" || empty) {
      // Resume from the checkpoint — including after an error. Pages already
      // pulled are on disk; re-fetched pages dedupe on read.
      // A resumed backfill keeps a running oldest until it's ready again.
      return await backfill(
        username,
        { ...existing, status: "syncing", error: undefined, errorCode: undefined, oldestIsFirstPlay: undefined },
        true,
        startedAt,
      );
    }
    return await refresh(username, existing, startedAt); // ready but stale
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

/* A removal can land while a chunk runs. Two checks keep the chunk from
   putting the history back:

   - Before writing: removal deletes the sync state first, so a chunk that
     started from a stored state and finds it gone writes nothing. Its pages
     would land under a cursor saying the earlier ones are in, a history
     missing its newest plays for good. A chunk that started from nothing has
     nothing to lose this way, so it's not asked.
   - After writing: the append re-reads and rewrites the whole history, which
     takes seconds on a big one, and a removal can land inside that. So the
     chunk asks whether this name was removed since it started, and if so
     deletes what it wrote (`takeBackIfRemoved` in `removal.ts`). */
async function removedMidChunk(username: string, resumed: boolean): Promise<boolean> {
  return resumed && (await getStore().getSyncState(username)) === null;
}

const takeBack = (username: string, startedAt: number) =>
  takeBackIfRemoved(username, startedAt, [userKey("sync", username), userKey("scrobbles", username)]);

/**
 * The history's first play as every reader counts it: the oldest stored play
 * that isn't noise or an impossible date, the record's first night. The
 * backfill's running minimum isn't that: it counts both, and a state saved
 * before the field existed took it from later syncs, which is how early
 * nights' sheets closed as they opened in 3b. So the state's `oldestUts`
 * is set from the stored history, once, and every reader gets the first play.
 */
async function setFirstPlay(state: SyncState): Promise<void> {
  state.oldestUts = (await getStore().getScrobbles(state.username)).find((s) => !isNoiseArtist(s.artist))?.uts;
  state.oldestIsFirstPlay = true;
}

async function backfill(
  username: string,
  state: SyncState,
  resumed: boolean,
  startedAt: number,
): Promise<SyncState> {
  const store = getStore();
  const deadline = Date.now() + BUDGET_MS;

  // Collect the whole invocation's pages and flush ONCE at the end. On blob
  // storage every append is a read-modify-write of the full history, so one
  // flush per invocation instead of one per batch keeps a big backfill at
  // ~100 writes instead of ~600.
  const collected: Scrobble[] = [];
  let fatal: { message: string; code: VisitorErrorCode } | null = null;

  /* Nothing collected yet means there's nothing to resume past: read from
     page 1. This is also what frees a state stuck under the old rule, whose
     cursor sits dozens of empty pages past the end. */
  if (state.newestUts === 0) state.pagesDone = 0;

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
      /* A blank reply ("no pages at all") never moves the cursor, or the
         pages it stood for would be skipped for good. Before anything has
         been collected it counts as one read of an empty account. Either
         way the next poll asks for the same pages again. */
      if (results.some((r) => r.totalPages === 0)) {
        if (state.newestUts === 0) state.emptyReads = (state.emptyReads ?? 0) + 1;
        break;
      }
      state.emptyReads = 0;
      state.totalPages = results[0].totalPages;
      state.totalScrobbles = results[0].totalScrobbles;
      state.pagesDone = start + count - 1;

      if (state.pagesDone >= state.totalPages) break;
      await sleep(PAGE_DELAY_MS);
    }
  } catch (err) {
    if (!isTransientError(err)) {
      fatal = {
        message: err instanceof Error ? err.message : String(err),
        code: syncErrorCode(err),
      };
    }
    // Transient: flush what we have and let the next poll resume.
  }

  if (await removedMidChunk(username, resumed)) return notStarted(username);
  /* An account with no scrobbles reports `totalPages: 0`, and the old rule
     only called a sync done when there was at least one page. So it stayed
     "syncing" for good: every poll fetched one more empty page past the end,
     and the wait screen spun for as long as the tab stayed open.

     Zero pages is now accepted as "this account is empty", but only when it
     can't be a glitch: nothing has ever been collected, and page 1 has come
     back blank twice in a row. That costs an empty account one extra poll,
     and a single bad reply can't pass for an empty account. */
  const confirmedEmpty = state.newestUts === 0 && (state.emptyReads ?? 0) >= 2;
  state.status = fatal
    ? "error"
    : confirmedEmpty || (state.totalPages > 0 && state.pagesDone >= state.totalPages)
      ? "ready"
      : "syncing";
  /* The chunk that finishes the backfill also drops the duplicate lines the
     backfill kept while pages shifted under it, in the same write. */
  if (collected.length > 0 || state.status === "ready") {
    await store.appendScrobbles(username, collected, { compact: state.status === "ready" });
  }
  if (state.status === "ready") await setFirstPlay(state);
  state.error = fatal?.message;
  state.errorCode = fatal?.code;
  state.updatedAt = Date.now();
  await store.setSyncState(state);
  if (await takeBack(username, startedAt)) return notStarted(username);
  return state;
}

async function refresh(username: string, state: SyncState, startedAt: number): Promise<SyncState> {
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
    if (await removedMidChunk(username, true)) return notStarted(username);
    if (collected.length > 0) {
      await store.appendScrobbles(username, collected);
    }
    // A ready state saved before the first play was set gets it, once.
    if (!state.oldestIsFirstPlay) await setFirstPlay(state);
    state.updatedAt = Date.now();
    await store.setSyncState(state);
    if (await takeBack(username, startedAt)) return notStarted(username);
  } catch {
    // Refresh failures are non-fatal: report on the data we have.
  }
  return state;
}
