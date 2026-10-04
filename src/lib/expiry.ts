import { getBlobStore } from "./store/blob";
import { USER_KEY_KINDS, allUserKeys, usernameFromKey } from "./store/userKeys";
import { pruneRemovalMarkers } from "./removal";
import { KEEP_DAYS } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

/* The cron route has 60 seconds. Stop starting new names well before that,
   and leave the rest for tomorrow's run: a first sweep over a backlog that
   ran out of time every day would never finish, and never prune. */
const SWEEP_BUDGET_MS = 40_000;

export interface ExpirySummary {
  /** Usernames with anything stored, before the sweep. */
  usernames: number;
  /** How many of them were past `KEEP_DAYS` and removed. */
  expired: number;
  /** Past it when listed, looked up again before their turn, and kept. */
  revisited: number;
  /** Past it, and left for the next run because this one ran out of time. */
  deferred: number;
  /** Removal markers old enough to count toward nothing, deleted. */
  markersPruned: number;
}

/** Whether any of a name's keys was written at or after `cutoff`, read now
    rather than from the listing, which can be many names old by its turn. */
async function writtenSince(name: string, cutoff: number): Promise<boolean> {
  for (const key of allUserKeys(name)) {
    const listed = await getBlobStore().list(key);
    if (listed.some((l) => l.key === key && l.lastModified >= cutoff)) return true;
  }
  return false;
}

/** Delete a name's keys, the sync state first (`userKeys.ts` says why). No
    read-backs: this is housekeeping with nobody waiting on a receipt, and
    twelve calls a name would eat the budget. */
async function deleteKeys(name: string): Promise<void> {
  const [sync, ...rest] = allUserKeys(name);
  await getBlobStore().del(sync);
  await Promise.all(rest.map((key) => getBlobStore().del(key)));
}

/**
 * Remove every username whose newest write is older than `KEEP_DAYS`.
 *
 * "Last looked up" is read from the store's own write times, so it costs a
 * visit nothing: no new field, no extra write. Every visit to a listener's page
 * calls `/status`, and `/status` rewrites the sync state whenever it finds it
 * older than its freshness window: an hour for a history with plays in it, a
 * minute for an empty one. So the newest write across a name's keys trails its
 * last visit by at most an hour, and the 90 days run from up to an hour before
 * the last visit. A name with only some of its keys (a tag store without a
 * history, say) goes by the ones it has, so leftovers expire too.
 *
 * Two kinds of visit don't count: a share-card unfurl, which reads what's
 * stored without calling `/status` (a chat app previewing a link isn't a visit), and
 * a visit while Last.fm is down, when the re-read fails and writes nothing.
 */
export async function expireStaleHistories(now = Date.now()): Promise<ExpirySummary> {
  const began = Date.now();
  const blobs = getBlobStore();
  // First, so a sweep that runs out of time has still done this.
  const markersPruned = await pruneRemovalMarkers(now);

  const newest = new Map<string, number>();
  for (const { prefix } of Object.values(USER_KEY_KINDS)) {
    for (const { key, lastModified } of await blobs.list(prefix)) {
      const name = usernameFromKey(key);
      if (name) newest.set(name, Math.max(newest.get(name) ?? 0, lastModified));
    }
  }

  const cutoff = now - KEEP_DAYS * DAY_MS;
  const stale = [...newest].filter(([, last]) => last < cutoff).map(([name]) => name);
  let expired = 0;
  let revisited = 0;
  let done = 0;
  for (const name of stale) {
    if (Date.now() - began > SWEEP_BUDGET_MS) break;
    done++;
    if (await writtenSince(name, cutoff)) {
      revisited++;
      continue;
    }
    await deleteKeys(name);
    expired++;
  }

  return {
    usernames: newest.size,
    expired,
    revisited,
    deferred: stale.length - done,
    markersPruned,
  };
}
