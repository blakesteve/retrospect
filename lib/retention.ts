/**
 * How long Retrospect keeps what it stores, and how often it can be removed.
 * The one place these numbers live: the expiry sweep, the removal route and
 * the "remove my data" page all read them from here, so the page can't say
 * one thing while the code does another. Free of server imports so the page
 * can use it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stored history is deleted this many days after its username was last
    looked up. */
export const KEEP_DAYS = 90;

/** One username can be removed once in this long. */
export const REMOVAL_COOLDOWN_MS = DAY_MS;

/** At most this many removals, across every username, in any
    `REMOVAL_CAP_WINDOW_MS`. */
export const REMOVAL_CAP = 20;
export const REMOVAL_CAP_WINDOW_MS = DAY_MS;
