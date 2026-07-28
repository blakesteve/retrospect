"use client";

import { useEffect, useState } from "react";
import {
  mercuryRetrogrades,
  SIGN_ELEMENTS,
  type ZodiacSign,
} from "@/lib/ephemeris/retrogrades";

const GLYPHS: Record<ZodiacSign, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋", Leo: "♌", Virgo: "♍",
  Libra: "♎", Scorpio: "♏", Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

interface BySign {
  sign: ZodiacSign;
  index: number;
  retroN: number;
  windows: number;
}

/**
 * The deep-dive drawer for people who already know what a station is — and a
 * gateway drug for people who don't. Everything here is computed from real
 * ephemeris positions (tropical zodiac), not transcribed from a horoscope.
 */
import type { NatalChart } from "@/lib/astro/natal";

export function AstrologyCorner({
  bySign,
  eventNoun = "retrogrades",
  natal = null,
}: {
  bySign: BySign[];
  eventNoun?: string;
  natal?: NatalChart | null;
}) {
  const natalTags = new Map<ZodiacSign, string[]>();
  if (natal) {
    const add = (sign: ZodiacSign, label: string) =>
      natalTags.set(sign, [...(natalTags.get(sign) ?? []), label]);
    add(natal.sun.sign, "☉ your Sun");
    add(natal.moon.sign, "☾ your Moon");
    if (natal.rising) add(natal.rising.sign, "↑ your Rising");
  }
  const inMySigns = bySign.filter((s) => natalTags.has(s.sign));
  const elsewhere = bySign.filter((s) => !natalTags.has(s.sign));
  const wAvg = (xs: BySign[]) =>
    xs.length ? xs.reduce((a, s) => a + s.index * s.retroN, 0) / xs.reduce((a, s) => a + s.retroN, 0) : NaN;
  const mine = wAvg(inMySigns);
  const others = wAvg(elsewhere);
  // Current/next retrograde is date-dependent — resolve after mount so the
  // server-rendered HTML stays deterministic.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  const current = now
    ? mercuryRetrogrades.find((w) => Date.parse(w.start) <= now && Date.parse(w.end) > now)
    : undefined;
  const next = now ? mercuryRetrogrades.find((w) => Date.parse(w.start) > now) : undefined;
  const active = current ?? next;

  const top = bySign[0];

  return (
    <details className="group rounded-lg bg-surface-1 border border-[var(--hairline)] open:pb-5">
      <summary className="cursor-pointer list-none p-5 flex items-center justify-between select-none">
        <span className="font-display text-xl text-gold">
          ✦ For the astrologically inclined
        </span>
        <span className="text-ink-3 text-xs group-open:rotate-180 transition-transform">▼</span>
      </summary>

      <div className="px-5 space-y-6">
        {/* Right now in the sky */}
        {active && (
          <div className="rounded-md bg-surface-2 border border-[var(--hairline)] p-4">
            <p className="text-ink-3 text-xs uppercase tracking-[0.2em] mb-2">
              {current ? "Happening right now" : "Coming up"}
            </p>
            <p className="text-ink text-sm leading-relaxed">
              Mercury {current ? "is retrograde" : "goes retrograde"} in{" "}
              <strong className="text-gold">
                {GLYPHS[active.sign]} {active.sign}
              </strong>{" "}
              ({SIGN_ELEMENTS[active.sign]} sign), {fmt(active.start)} &ndash; {fmt(active.end)}
              {active.signAtDirect !== active.sign && (
                <>, backing into {GLYPHS[active.signAtDirect]} {active.signAtDirect} before stationing direct</>
              )}
              .
            </p>
          </div>
        )}

        {/* Your nostalgia by sign */}
        {bySign.length > 0 && (
          <div>
            <h4 className="text-ink text-sm font-medium mb-1">
              Which signs actually get you
            </h4>
            <p className="text-ink-3 text-xs mb-3 leading-relaxed">
              Not all {eventNoun}{" are alike: "}each happens in a different sign, and
              astrologers read them differently. Here&rsquo;s your old-favorite pull during
              each sign&rsquo;s {eventNoun} vs. your normal baseline, sorted by how hard
              each sign hits you.
              {top && Math.abs(top.index - 1) > 0.03 && (
                <>
                  {" "}Yours peaks in <strong className="text-ink-2">{top.sign}</strong>
                  {top.index > 1
                    ? ` (+${Math.round((top.index - 1) * 100)}% nostalgia)`
                    : ` (${Math.round((top.index - 1) * 100)}%, you run from the past)`}
                  .
                </>
              )}
            </p>
            <ul className="space-y-1.5">
              {bySign.map((s) => {
                const delta = Math.round((s.index - 1) * 100);
                const width = Math.min(100, Math.abs(s.index - 1) * 250);
                return (
                  <li key={s.sign} className="flex items-center gap-3 text-xs">
                    <span className="w-28 text-ink-2 shrink-0">
                      {GLYPHS[s.sign]} {s.sign}
                      {natalTags.has(s.sign) && (
                        <span className="block text-gold text-[10px] leading-tight">
                          {natalTags.get(s.sign)!.join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(3, width)}%`,
                          background: s.index >= 1 ? "var(--series-1)" : "var(--accent-mark)",
                        }}
                      />
                    </span>
                    <span className="w-14 text-right tabular text-ink shrink-0">
                      {delta > 0 ? `+${delta}%` : `${delta}%`}
                    </span>
                    <span className="w-24 text-right text-ink-3 tabular shrink-0">
                      {s.windows} event{s.windows === 1 ? "" : "s"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-ink-3 text-xs mt-2">
              Indigo = above your baseline; ochre = below. Signs with too few plays to be
              meaningful are hidden.
            </p>
            {natal && Number.isFinite(mine) && Number.isFinite(others) && (
              <p className="text-ink-2 text-xs mt-3 rounded-md bg-surface-2 border border-gold/30 p-3">
                ✦ Personal resonance: {eventNoun} in <em>your</em> signs move you{" "}
                {Math.abs(Math.round((mine - 1) * 100))}% vs {Math.abs(Math.round((others - 1) * 100))}%
                everywhere else;{" "}
                {Math.abs(Math.log(mine)) > Math.abs(Math.log(others)) * 1.2
                  ? "the sky does seem to know your chart."
                  : Math.abs(Math.log(others)) > Math.abs(Math.log(mine)) * 1.2
                    ? "if anything, other people's signs move you more. Scandalous."
                    : "your chart and everyone else's look about the same. The heavens are egalitarian."}
              </p>
            )}
          </div>
        )}

        {/* The glossary */}
        <div className="grid sm:grid-cols-2 gap-4 text-xs leading-relaxed">
          <div>
            <h4 className="text-ink text-sm font-medium mb-1">What&rsquo;s a station?</h4>
            <p className="text-ink-3">
              Mercury never actually reverses; from Earth&rsquo;s vantage it appears to
              slow, stop (&ldquo;station retrograde&rdquo;), drift backwards for ~22 days,
              stop again (&ldquo;station direct&rdquo;), and resume. Astrologers consider
              station days the potent ones. Every date on this page is a computed station,
              accurate to the minute.
            </p>
          </div>
          <div>
            <h4 className="text-ink text-sm font-medium mb-1">Why the sign matters</h4>
            <p className="text-ink-3">
              Tradition reads each retrograde through the sign it stations in: air-sign
              retrogrades (Gemini, Libra, Aquarius) scramble communication; water signs
              (Cancer, Scorpio, Pisces) dredge up feelings, the nostalgia ones, allegedly.
              Your chart above says whether your listening agrees. We use the tropical
              zodiac, as Western astrology does.
            </p>
          </div>
          <div>
            <h4 className="text-ink text-sm font-medium mb-1">The shadow period</h4>
            <p className="text-ink-3">
              Purists track the &ldquo;shadow&rdquo;: the weeks before and after a
              retrograde while Mercury crosses the same stretch of sky it will re-cross
              backwards. If you want shadow-period analysis, pester the developer; the
              ephemeris math is already sitting right there.
            </p>
          </div>
          <div>
            <h4 className="text-ink text-sm font-medium mb-1">Sun, Moon, Rising</h4>
            <p className="text-ink-3">
              Your Sun sign is where the Sun sat when you were born (the one you already
              know). Your Moon sign is the Moon’s position: the inner weather. Your
              Rising sign is the zodiac degree climbing the eastern horizon at the exact
              minute of your birth, which is why it needs a time and place. Cast your
              chart above and your signs light up in this table.
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}
