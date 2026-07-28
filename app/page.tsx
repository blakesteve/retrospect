import Image from "next/image";
import { SkyCalendar } from "@/components/SkyCalendar";
import { UsernameForm } from "@/components/UsernameForm";
import { VersusForm } from "@/components/VersusForm";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-24">
      <Image
        src="/retrospect-logo-tp.PNG"
        alt="Retrospect — a ringed planet spinning like a record"
        width={120}
        height={120}
        priority
        className="mb-6 drop-shadow-[0_0_24px_rgba(212,175,55,0.25)]"
      />
      <p className="text-ink-3 tracking-[0.35em] uppercase text-xs mb-6">
        An almanac of your listening
      </p>
      <h1 className="font-display text-6xl sm:text-7xl text-gold mb-4">
        Retrospect
      </h1>
      <p className="text-ink-2 text-center max-w-xl text-lg leading-relaxed mb-10">
        Astrology says Mercury retrograde is when you revisit the past. Your
        Last.fm history says whether you actually do, measured against
        the real, computed positions of the planets. With a p&#8209;value.
      </p>

      <UsernameForm />
      <VersusForm />
      <SkyCalendar />

      <footer className="mt-16 text-xs text-ink-3 max-w-md text-center leading-relaxed">
        Reads public scrobble data via the Last.fm API. Ephemeris computed with
        astronomy-engine, not vibes. Not affiliated with Last.fm. For
        entertainment purposes; the planets are not responsible for your taste.
      </footer>
    </main>
  );
}
