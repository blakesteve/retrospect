/**
 * The footer's "remove my data" link, the one DESIGN.md promises.
 *
 * A plain link: not `next/link`, because `/remove` is a static page that loads
 * fine on its own and `next/link` added 4,827 bytes to the landing's first
 * load (920,065 without it, 924,892 with; local builds, 30 Sept 2026); and not
 * Roster's `Link`, which brings Font Awesome (spec 12) and drew a 16px target.
 * It's 44px tall (spec 11), in the footer's muted ink.
 */
export function RemoveDataLink({ username }: { username?: string }) {
  return (
    <a
      href={username ? `/remove?u=${encodeURIComponent(username)}` : "/remove"}
      className="inline-flex min-h-11 items-center text-xs text-ink-2 underline underline-offset-4 hover:text-gold"
    >
      remove my data
    </a>
  );
}
