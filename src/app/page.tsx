import { Suspense } from "react";
import { UsernameForm } from "@/components/UsernameForm";
import { CompareForm } from "@/components/landing/CompareForm";
import { Hero } from "@/components/landing/Hero";
import { SampleMount } from "@/components/landing/SampleMount";
import { Tiles } from "@/components/landing/Tiles";
import { LANDING_HEADING } from "@/components/landing/sampleUrls";
import { HERO_NIGHT, tileFacts } from "@/components/landing/tileFacts";

/* The landing (spec 8.1, reordered 2 Oct 2026): what Retrospect is and the
   username first, then the hero as an example, then the working samples.
   A server component: Roster lives in the client pieces only. */

export default function Home() {
  const facts = tileFacts();
  return (
    <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">
      {/* The wordmark leads (8.1), at the size the logo reads at: a ringed planet
          spinning like a record. A 280px WebP (20 KB) rather than the 847 KB
          original; next/image would add client JS to the landing. */}
      <p className="flex flex-col items-center pt-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- one committed 280px mark */}
        <img
          src="/landing/logo-280.webp"
          alt=""
          width={140}
          height={140}
          fetchPriority="high"
          className="size-28 drop-shadow-[0_0_24px_rgba(212,175,55,0.3)] sm:size-[140px]"
        />
        <span className="mt-3 font-display text-[34px] tracking-[0.02em] text-gold sm:text-[44px]">Retrospect</span>
      </p>

      <Suspense fallback={null}>
        <SampleMount />
      </Suspense>

      <div className="mx-auto mt-6 max-w-xl text-center">
        <h1
          id={LANDING_HEADING}
          tabIndex={-1}
          className="font-display text-[44px] text-ink outline-none [text-wrap:balance] sm:text-[52px]"
          style={{ lineHeight: 1.02, letterSpacing: "-0.015em" }}
        >
          Every song has a sky.
        </h1>
        <p className="mt-3 text-[16.5px] leading-relaxed text-ink-2">
          Retrospect reads your Last.fm history and shows you what the sky was doing the first time you played each song: the
          planets, the Moon, solar storms, eclipses and asteroids. Then it tells you, honestly, whether any of it moved you.
        </p>
      </div>

      <UsernameForm />

      <Hero night={HERO_NIGHT} song={facts.song} />

      <Tiles facts={facts} />

      <CompareForm />

      <footer className="mt-12 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-ink-3">
        <p>
          Reads public scrobble data via the Last.fm API. Sky computed with astronomy-engine. Space weather, asteroids and photos
          from NASA and JPL. Not affiliated with Last.fm. For entertainment purposes; the planets are not responsible for your
          taste.
        </p>
        {/* A plain link: Roster's Link brings Font Awesome (12), and this one
            needs no JavaScript at all. */}
        <a href="/remove" className="mt-1 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-ink-2">
          remove my data
        </a>
      </footer>
    </main>
  );
}
