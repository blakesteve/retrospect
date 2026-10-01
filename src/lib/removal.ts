import { createHash, randomBytes } from "node:crypto";
import { getBlobStore } from "./store/blob";
import { getStore } from "./store/jsonStore";
import { allUserKeys, safeName } from "./store/userKeys";
import { REMOVAL_CAP, REMOVAL_CAP_WINDOW_MS, REMOVAL_COOLDOWN_MS } from "./retention";

/**
 * "Remove my data": delete everything stored under one username.
 *
 * Open to anyone, with no sign-in (decided 27 Sept 2026). A stranger can remove
 * someone else's copy, and that's accepted because nothing is lost: Last.fm
 * keeps the history, and the cost is one fresh read on the next visit. The two
 * limits in `retention.ts` bound that cost, so one history can't be wiped over
 * and over, and a script can't walk a list of names.
 */

/** A sync state written this recently may belong to a sync still running. */
export const SYNC_ACTIVE_MS = 60 * 1000;

/* The limits live in the store the app already has, as one empty marker per
   removal: `limits/removals/{time}-{name hash}-{random}`.

   A single counter blob would be smaller, and it would not hold. R2 has no
   atomic increment, so twenty requests fired at once all read "0" and all go
   through. Markers are written FIRST and counted AFTER, and R2 lists with
   strong consistency, so every request counts every marker written before its
   own count, itself included. However the requests interleave, the one whose
   marker landed last among any 21 sees all 21 and backs out. A refused request
   deletes its own marker, so refusals don't use up the day. The cost of this
   is the other direction: a burst over the cap can refuse a request that a
   slower arrival would have let through. Refusing too many is the safe side.

   The name is hashed so the markers aren't a readable list of who asked to
   be removed. It's the one thing about a removed name that outlives the
   removal, for a day, and it holds no listening. The expiry sweep prunes old
   markers. */
const MARKER_PREFIX = "limits/removals/";
const MARKER_RE = /^limits\/removals\/(\d+)-([0-9a-f]{16})-[0-9a-f]+$/;

const nameHash = (username: string) =>
  createHash("sha256").update(safeName(username)).digest("hex").slice(0, 16);

interface Marker {
  key: string;
  at: number;
  hash: string;
}

/** Every marker, from ONE listing. Two listings would disagree about a marker
    written between them, which is how pruning once deleted a live one. */
async function allMarkers(): Promise<Marker[]> {
  const markers: Marker[] = [];
  for (const { key } of await getBlobStore().list(MARKER_PREFIX)) {
    const m = MARKER_RE.exec(key);
    if (m) markers.push({ key, at: Number(m[1]), hash: m[2] });
  }
  return markers;
}

const MARKER_LIFE_MS = Math.max(REMOVAL_COOLDOWN_MS, REMOVAL_CAP_WINDOW_MS);

type Claim =
  | { ok: true; marker: string }
  | { ok: false; kind: "cooldown" | "too-many"; retryAt: number };

async function claimRemoval(username: string): Promise<Claim> {
  const blobs = getBlobStore();
  const now = Date.now();
  const hash = nameHash(username);
  const mine = `${MARKER_PREFIX}${String(now).padStart(15, "0")}-${hash}-${randomBytes(6).toString("hex")}`;
  await blobs.put(mine, Buffer.alloc(0));

  const others = (await allMarkers()).filter((m) => m.key !== mine);
  const sameName = others.filter((m) => m.hash === hash && now - m.at < REMOVAL_COOLDOWN_MS);
  const inWindow = others.filter((m) => now - m.at < REMOVAL_CAP_WINDOW_MS);

  let refusal: Claim | null = null;
  if (sameName.length > 0) {
    const latest = Math.max(...sameName.map((m) => m.at));
    refusal = { ok: false, kind: "cooldown", retryAt: latest + REMOVAL_COOLDOWN_MS };
  } else if (inWindow.length + 1 > REMOVAL_CAP) {
    // A slot frees when enough of the oldest age out to bring this one under.
    const ages = inWindow.map((m) => m.at).sort((a, b) => a - b);
    const freed = ages[inWindow.length - REMOVAL_CAP];
    refusal = { ok: false, kind: "too-many", retryAt: freed + REMOVAL_CAP_WINDOW_MS };
  }
  if (refusal) {
    await blobs.del(mine);
    return refusal;
  }
  return { ok: true, marker: mine };
}

/** Remove markers too old to count toward either limit. For the expiry sweep. */
export async function pruneRemovalMarkers(now = Date.now()): Promise<number> {
  const blobs = getBlobStore();
  let pruned = 0;
  for (const marker of await allMarkers()) {
    if (now - marker.at < MARKER_LIFE_MS) continue;
    await blobs.del(marker.key);
    pruned++;
  }
  return pruned;
}

/* Machines' clocks differ by a little. A marker this close before a writer's
   start still counts as after it: undoing a write that raced a removal is
   the safe side of the doubt. */
const CLOCK_SLACK_MS = 2_000;

/**
 * Take back writes that landed after this name was removed.
 *
 * Anything that writes per-user data can be mid-flight when a removal lands:
 * a sync chunk appending a history (seconds, on a big one), a genre request
 * fetching tags or analyzing (up to half a minute). Written after the delete,
 * its data would be back, and the removal would already have said "removed".
 * So every such writer, AFTER its write, asks whether a removal of this name
 * was claimed since it started, and if so deletes what it just wrote. The
 * claim is written before the removal deletes anything and R2 reads are
 * strongly consistent, so each write is either deleted by the removal (it
 * landed first) or seen and taken back by its writer (it landed after).
 * Returns true when it took something back.
 */
export async function takeBackIfRemoved(
  username: string,
  startedAt: number,
  keys: string[],
): Promise<boolean> {
  const hash = nameHash(username);
  const removed = (await allMarkers()).some(
    (m) => m.hash === hash && m.at >= startedAt - CLOCK_SLACK_MS,
  );
  if (!removed) return false;
  for (const key of keys) await getBlobStore().del(key);
  return true;
}

export interface RemovedKey {
  key: string;
  /** Whether there was anything under this key to remove. */
  existed: boolean;
  /** Read back after deleting: false means it's still there. */
  gone: boolean;
}

/**
 * Delete every key the app stores under this username, the sync state first,
 * and read each one back afterwards. No limits and no checks: the removal
 * route decides whether to call it.
 */
export async function removeUserData(username: string): Promise<RemovedKey[]> {
  const blobs = getBlobStore();
  const out: RemovedKey[] = [];
  // In order, not in parallel: the sync state has to go first (`userKeys.ts`).
  for (const key of allUserKeys(username)) {
    const existed = await blobs.has(key);
    await blobs.del(key);
    out.push({ key, existed, gone: !(await blobs.has(key)) });
  }
  return out;
}

export type RemovalOutcome =
  | { kind: "removed"; keys: RemovedKey[] }
  | { kind: "failed"; keys: RemovedKey[] }
  | { kind: "nothing-stored" }
  | { kind: "busy" }
  | { kind: "cooldown"; retryAt: number }
  | { kind: "too-many"; retryAt: number };

/** A visitor's request to remove a username, with every check applied. */
export async function requestRemoval(username: string): Promise<RemovalOutcome> {
  const blobs = getBlobStore();

  /* Nothing stored, nothing to do, and no marker: asking about a name that
     was never looked up can't use up anyone's removals for the day. */
  const stored = await Promise.all(allUserKeys(username).map((key) => blobs.has(key)));
  if (!stored.some(Boolean)) return { kind: "nothing-stored" };

  /* A sync mid-read writes its pages at the end of each chunk. Removing under
     it would leave those pages, and a reading cursor that skips the ones just
     deleted. `src/lib/sync.ts` also checks from its side; this keeps the two from
     meeting in the first place while someone is watching the page read. */
  const state = await getStore().getSyncState(username);
  if (state?.status === "syncing" && Date.now() - state.updatedAt < SYNC_ACTIVE_MS) {
    return { kind: "busy" };
  }

  const claim = await claimRemoval(username);
  if (!claim.ok) return { kind: claim.kind, retryAt: claim.retryAt };

  /* A removal that didn't finish gives its claim back, so the retry isn't
     told "removed less than a day ago" while the data is still there. */
  let keys: RemovedKey[];
  try {
    keys = await removeUserData(username);
  } catch (err) {
    await getBlobStore().del(claim.marker);
    throw err;
  }
  if (keys.some((k) => !k.gone)) {
    await getBlobStore().del(claim.marker);
    return { kind: "failed", keys };
  }
  return { kind: "removed", keys };
}
