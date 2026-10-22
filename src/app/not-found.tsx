import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nothing here · Retrospect",
};

/* Any address the app doesn't have, and a listener URL whose name can't be
   read (`/u/abc%`). Plain markup on purpose: the root not-found rides in every
   page's payload, so no Roster, no next/image and no next/link here, which
   would load their code on every page, the landing included. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 py-16 text-center">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- next/link would load on every page */}
      <a href="/" className="flex flex-col items-center gap-3 text-gold">
        {/* eslint-disable-next-line @next/next/no-img-element -- the landing's committed 280px mark */}
        <img src="/landing/logo-280.webp" alt="" width={72} height={72} className="size-18" />
        <span className="font-display text-2xl tracking-[0.02em]">Retrospect</span>
      </a>
      <h1 className="mt-10 font-display text-3xl text-ink">There&rsquo;s nothing at this address.</h1>
      <p className="mt-3 max-w-md text-ink-2">
        The link may be mistyped or out of date. Start again from the front page, where you can
        look up any Last.fm username.
      </p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- as above */}
      <a href="/" className="mt-6 inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:text-gold">
        Back to the start
      </a>
    </main>
  );
}
