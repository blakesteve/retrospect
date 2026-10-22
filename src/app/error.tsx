"use client";

import { useEffect, useState, type ComponentType } from "react";
import { visitorError } from "@/lib/visitorErrors";

type TryAgainButton = ComponentType<{ onClick: () => void }>;

/* A page that throws while it draws. The visitor reads the same words as any
   other failure on our side (visitorErrors.ts), never the error itself, which
   goes to the console, and `retry` fetches and draws the page again.

   Next loads this boundary on every page, so it's plain markup styled like
   Shell's fatal state. With Roster's EmptyState and Button in it (and in
   global-error.tsx), every page's first load grew 64,807 bytes: a second copy
   of the Button and Headless UI, which the landing's forms already load in
   chunks of their own. EmptyState alone wasn't measured. So the Button loads
   when this page draws, in a box its height, and the words and the link back
   never wait for it. If even that can't load (an old tab after a release),
   Try again is a full load of the address instead. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [TryAgain, setTryAgain] = useState<TryAgainButton | null>(null);
  const [reload, setReload] = useState<string | null>(null);
  useEffect(() => {
    console.error(error);
  }, [error]);
  useEffect(() => {
    import("@/components/TryAgain")
      .then((m) => setTryAgain(() => m.default))
      .catch(() => setReload(window.location.href));
  }, []);
  const action = TryAgain ? (
    <TryAgain onClick={() => retry()} />
  ) : reload ? (
    <a href={reload} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:text-gold">
      Try again
    </a>
  ) : (
    <span className="block h-11" />
  );
  return <Trouble action={action} />;
}

/** What went wrong, in the words for a failure on our side, and the way back
    to the start: a full load, so whatever broke starts fresh. */
export function Trouble({ action }: { action?: React.ReactNode }) {
  const v = visitorError("server", "");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 py-16 text-center">
      <h1 className="font-display text-3xl text-ink">{v.title}</h1>
      <p className="mt-3 max-w-md text-ink-2">{v.body}</p>
      <div className="mt-6 flex flex-col items-center gap-2">
        {action}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose */}
        <a href="/" className="inline-flex min-h-11 items-center text-ink-2 underline underline-offset-4 hover:text-gold">
          Back to the start
        </a>
      </div>
    </main>
  );
}
