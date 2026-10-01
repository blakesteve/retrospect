import type { Metadata } from "next";
import { Suspense } from "react";
import { RemoveForm } from "@/components/RemoveForm";
import { Wordmark } from "@/components/Wordmark";
import { KEEP_DAYS, REMOVAL_CAP } from "@/lib/retention";

export const metadata: Metadata = {
  title: "Remove a listening history · Retrospect",
  description: "What Retrospect keeps from Last.fm, for how long, and how to remove it.",
};

/* Plain words on purpose: what's kept, for how long, what removing does.
   The numbers come from `src/lib/retention.ts`, the same constants the expiry
   sweep and the removal limits use, so this page can't drift from them. */
export default function RemovePage() {
  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-12">
      <nav className="mb-10">
        <Wordmark />
      </nav>

      <h1 className="font-display text-4xl text-gold mb-6">Remove a listening history</h1>

      <div className="space-y-8 text-ink-2 leading-relaxed">
        <p>
          When you look up a Last.fm username, Retrospect copies that account&rsquo;s public
          listening from Last.fm and keeps the copy, so the next visit doesn&rsquo;t have to read
          it all again.
        </p>

        <section>
          <h2 className="text-ink text-lg mb-2">What it keeps</h2>
          <ul className="list-disc pl-5 space-y-1 marker:text-gold">
            <li>Every song played: the artist, the track and when.</li>
            <li>How far it has read, so a long read can pick up where it stopped.</li>
            <li>
              The genre tags Last.fm gives the artists played most, and the genre results worked
              out from them.
            </li>
            <li>The answers to Retrospect&rsquo;s questions, worked out from the listening.</li>
          </ul>
          <p className="mt-2">
            Birth details for a birth chart stay in your browser and never reach Retrospect, so
            there&rsquo;s nothing of them here to remove.
          </p>
        </section>

        <section>
          <h2 className="text-ink text-lg mb-2">For how long</h2>
          {/* Sentences with a number in them are plain strings: with an
              entity later in a wrapped line, Next 16.2's JSX compiler dropped
              the space after the number ("90days"). */}
          <p>{`About ${KEEP_DAYS} days after the username was last looked up, it’s deleted on its own.`}</p>
        </section>

        <section>
          <h2 className="text-ink text-lg mb-2">What removing does</h2>
          <p>
            It deletes all of the above right away. Nothing changes on Last.fm, where the
            listening stays. If anyone looks the username up again, Retrospect reads the whole
            history from Last.fm again, which can take several minutes for a big one.
          </p>
        </section>

        <section>
          <h2 className="text-ink text-lg mb-2">Who can remove it</h2>
          <p>
            {`Anyone, for any username, without signing in. That’s safe because nothing is lost: Last.fm still has all of it. To keep it from being done over and over, a username can be removed once a day, and Retrospect removes at most ${REMOVAL_CAP} a day in all. For a day or two afterward it keeps a scrambled note that the name was removed, with no listening in it.`}
          </p>
        </section>

        <section>
          <h2 className="text-ink text-lg mb-4">Remove one</h2>
          <Suspense fallback={null}>
            <RemoveForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
