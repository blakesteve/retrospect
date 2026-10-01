/**
 * Every blob the app stores under a username, in one list.
 *
 * Removal deletes exactly these, and the expiry sweep finds usernames by
 * reading them back out of the store's key names. So a per-user blob written
 * under a key that isn't here would survive both: "remove my data" would say
 * it's gone and leave it behind, and nothing would ever expire it. Anything new
 * that stores something per listener (the redesign's stored answers, for one)
 * gets its entry here first, and calls `takeBackIfRemoved` (`src/lib/removal.ts`)
 * after writing. `userKeys.test.ts` fails if a module reaches the store without
 * being on its allowlist, or builds a key by hand instead of calling `userKey`.
 *
 * The genre tag store is per user, not shared: `tags/{user}.json` maps each of
 * that listener's top artists to its Last.fm tags, so the same artist is
 * fetched once per listener who plays it. Its artist names alone say who that
 * listener plays most, so it is listening data and goes with the rest.
 */

/** Prefixes whose blobs are the same for everyone, never per listener:
    NASA's data (spec 7.3). Nothing under them may carry a username, and
    removal and expiry never touch them. `usernameFromKey` can't read a name
    out of one, which `userKeys.test.ts` checks. */
export const SHARED_PREFIXES = ["space/"] as const;

/** Lowercased, and anything outside `a-z 0-9 _ -` becomes `_`. Idempotent. */
export const safeName = (username: string): string =>
  username.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

interface KeyShape {
  prefix: string;
  suffix: string;
}

export const USER_KEY_KINDS = {
  /** Every play: when, the artist and the track. The history itself. */
  scrobbles: { prefix: "scrobbles/", suffix: ".jsonl.gz" },
  /** How far reading has got, and the newest play seen. */
  sync: { prefix: "sync/", suffix: ".json" },
  /** Last.fm's genre tags for this listener's top artists. */
  tags: { prefix: "tags/", suffix: ".json" },
  /** The worked-out genre results, kept so they survive a cold start. */
  genres: { prefix: "cache/genres-", suffix: ".json" },
  /** The answers to the 12 questions, a record per time zone (spec 6.6),
      in one blob so removal and expiry find them like everything else. */
  answers: { prefix: "answers/", suffix: ".json" },
} as const satisfies Record<string, KeyShape>;

export type UserKeyKind = keyof typeof USER_KEY_KINDS;

export function userKey(kind: UserKeyKind, username: string): string {
  const { prefix, suffix } = USER_KEY_KINDS[kind];
  return `${prefix}${safeName(username)}${suffix}`;
}

/** Every key for one username. The sync state comes first on purpose: it is
    the reading cursor, so once it's gone a sync already running for this
    name can see the removal and stop writing (`src/lib/sync.ts`). */
export function allUserKeys(username: string): string[] {
  // Derived, not listed again: a kind added above can't be missed here.
  const kinds = Object.keys(USER_KEY_KINDS) as UserKeyKind[];
  const order = ["sync" as const, ...kinds.filter((kind) => kind !== "sync")];
  return order.map((kind) => userKey(kind, username));
}

/** The safe username a key belongs to, or null if it isn't a per-user key. */
export function usernameFromKey(key: string): string | null {
  for (const { prefix, suffix } of Object.values(USER_KEY_KINDS)) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const name = key.slice(prefix.length, key.length - suffix.length);
    if (/^[a-z0-9_-]+$/.test(name)) return name;
  }
  return null;
}
