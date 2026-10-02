"use client";

import NextLink from "next/link";
import { useState } from "react";
import { Button } from "@blakesteve/roster";
import type { Load } from "@/components/listener/Shell";
import type { SkyNow } from "@/components/listener/api";
import { SkyWheel } from "@/components/listener/sky";
import {
  apiError,
  visitorError,
  visitorErrorCodeOf,
  type VisitorErrorCode,
} from "@/lib/visitorErrors";

/** Last.fm's own page on starting to scrobble, with Spotify and the apps. */
const HOW_TO_SCROBBLE = "https://www.last.fm/about/trackmymusic";

/* The re-check window in words. `EMPTY_REFRESH_SECONDS` in `src/lib/sync.ts` is
   60, and `sync.test.ts` checks every "asks Last.fm" here says a minute.
   "At most", because nothing polls: Last.fm is asked only when someone checks,
   and not again inside the minute. */
const HOW_OFTEN = "Retrospect asks Last.fm again at most once a minute.";

/**
 * A Last.fm account with nothing in it yet. It used to be a dead end: the
 * title, one sentence and nothing to do. Now it says how to start and gives a
 * way to look again without retyping the name.
 *
 * "Check again" asks `/status`, which re-reads an empty history once it's a
 * minute old (`EMPTY_REFRESH_SECONDS` in `src/lib/sync.ts`; `HOW_OFTEN` says so
 * in words and has to change with it). Still empty: stay here and say
 * so. Anything else, plays found or a read under way, hands back to the page's
 * normal flow through `onFound`.
 */
export function NoScrobbles({
  username,
  onFound,
  onError,
  sky,
}: {
  username: string;
  onFound: () => void;
  onError: (code: VisitorErrorCode) => void;
  /** Tonight's sky, so the page isn't a dead end (8.2). */
  sky?: Load<SkyNow>;
}) {
  const [checking, setChecking] = useState(false);
  const [stillEmpty, setStillEmpty] = useState(false);
  const message = visitorError("no-scrobbles", username);

  async function checkAgain() {
    if (checking) return;
    setChecking(true);
    // Cleared first so the same line, set again, is announced again.
    setStillEmpty(false);
    try {
      const res = await fetch(`/api/user/${encodeURIComponent(username)}/status`);
      if (!res.ok) throw await apiError(res);
      const s: { status: string; newestUts: number | null } = await res.json();
      if (s.status === "ready" && !s.newestUts) setStillEmpty(true);
      else onFound();
    } catch (err) {
      console.error("[retrospect] re-check failed:", err);
      onError(visitorErrorCodeOf(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="py-24 max-w-md mx-auto">
      <div className="text-center">
        <h1 className="font-display text-3xl text-gold mb-4">{message.title}</h1>
        <p className="text-ink-2">{message.body}</p>
      </div>

      <ol className="mt-8 space-y-3 text-ink-2 list-decimal pl-5 marker:text-gold">
        <li>
          Connect the app you listen with to Last.fm, so Last.fm can see what you play. Last.fm
          calls this scrobbling, and Spotify and many music apps can do it.{" "}
          {/* A plain link: Roster's Link brings Font Awesome (spec 12). */}
          <a href={HOW_TO_SCROBBLE} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-gold">
            How to start scrobbling, on Last.fm
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
        <li>
          Play a few songs. Last.fm counts a song once you&rsquo;re halfway through it or four
          minutes in, whichever comes first.
        </li>
        <li>Come back and check again. {HOW_OFTEN}</li>
      </ol>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {/* No `isLoading`: Roster turns it into `disabled`, and a disabled
            button drops keyboard focus on every press. */}
        <Button colorScheme="primary" variant="solid" size="lg" onClick={checkAgain}>
          {checking ? "Checking\u2026" : "Check again"}
        </Button>
        <NextLink href="/" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">
          Try another username
        </NextLink>
      </div>

      <p role="status" aria-live="polite" className="mt-4 text-center text-sm text-ink-3">
        {stillEmpty && "Still nothing yet. If you've just played something, give it a minute and check again."}
      </p>

      {sky?.state === "ready" && (
        <div className="mt-12 flex flex-col items-center text-center">
          <p className="font-display text-xl text-ink">The sky doesn&rsquo;t wait. Here&rsquo;s tonight&rsquo;s.</p>
          <div className="mt-4">
            <SkyWheel bodies={sky.data.sky.bodies} size={300} />
          </div>
        </div>
      )}
    </div>
  );
}
