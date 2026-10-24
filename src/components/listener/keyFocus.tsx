"use client";

import { useKeyFocus } from "@blakesteve/roster";

/** Roster's keyboard-focus tracker, while a wheel the arrow keys move
    through is on the page: a planet a key moves focus to is marked, so its
    ring (`focus-visible:`, globals.css) shows in Safari after a click too.
    Mounted beside each wheel whose planets open something, and not by the
    wheel itself, so a page whose wheels are pictures (the landing's tiles)
    doesn't load it. */
export function KeyFocus() {
  useKeyFocus();
  return null;
}
