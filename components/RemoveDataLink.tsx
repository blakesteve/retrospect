"use client";

import { Link } from "@blakesteve/roster";

/**
 * The footer's "remove my data" link, the one DESIGN.md promises. A client
 * component only because Roster must never be imported from a server one:
 * that pins its whole barrel (see `scripts/check-bundle-shape.mjs`), and the
 * landing page is a server component.
 *
 * A plain link, not `next/link`, on purpose: `/remove` is a static page that
 * loads fine on its own, and `next/link` added 4,827 bytes to the landing's
 * first load (920,065 bytes without it, 924,892 with; local builds, 30 Sept
 * 2026).
 */
export function RemoveDataLink({ username }: { username?: string }) {
  return (
    <Link
      href={username ? `/remove?u=${encodeURIComponent(username)}` : "/remove"}
      size="sm"
      underline="always"
      /* An aside, not a call to action: the footer's muted ink and weight
         rather than Link's gold semibold. `sm` is Link's `text-xs`, the
         footer's own size. */
      className="font-normal text-ink-3 hover:text-ink-2"
    >
      remove my data
    </Link>
  );
}
