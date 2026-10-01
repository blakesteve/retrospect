"use client";

import { useCallback, useEffect, useState } from "react";
import type { Report } from "@/lib/report";
import { PHENOMENA } from "@/lib/ephemeris/phenomena";
import { METRICS } from "@/lib/analysis/metrics";
import { AlbumArt } from "./AlbumArt";
import { Button } from "@blakesteve/roster";
import { TOO_SOON_HEADLINE, warmupExplanation } from "@/lib/readiness";
import { pValueNote, readTrial } from "@/lib/likelihood";
import { useShowPValues } from "./usePValues";

const DAY = 86400;

/**
 * "8 years", or for a history under a year, "3 months" or "20 days". The
 * year count stays the calendar-year difference it always was, so an older
 * history's reveal reads exactly as before, apart from "1 year" losing its
 * stray "s".
 */
function historyLength(firstUts: number, lastUts: number): string {
  const days = (lastUts - firstUts) / DAY;
  if (days < 60) {
    const d = Math.max(1, Math.round(days));
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  if (days < 365) {
    const m = Math.round(days / 30.44);
    return `${m} months`;
  }
  const years = Math.max(
    1,
    new Date(lastUts * 1000).getUTCFullYear() - new Date(firstUts * 1000).getUTCFullYear(),
  );
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/**
 * The Wrapped-style opening: one revelation at a time, full screen, before
 * the dashboard. Click / space / → advances; Skip bails to the data.
 */
export function StoryIntro({ report, onDone }: { report: Report; onDone: () => void }) {
  const r = report;
  // Too young to test: the reveal skips the two slides built on the tested
  // span and ends on "too soon" instead of a verdict.
  const warming = r.trialStatus === "warming-up" ? r.warmup : null;
  // Read once: whether the warm-up's end date is still ahead.
  const [now] = useState(() => Date.now());
  const showP = useShowPValues();

  const slides: React.ReactNode[] = [];

  slides.push(
    <>
      <Eyebrow>First, the scale of this</Eyebrow>
      <Big>
        {historyLength(r.firstScrobbleUts, r.lastScrobbleUts)}.
        <br />
        {r.scrobbleCount.toLocaleString()} songs.
      </Big>
      <Sub>We read your entire listening diary. Every play, timestamped.</Sub>
    </>
  );

  const meta = PHENOMENA[r.body];

  slides.push(
    <>
      <Eyebrow>Meanwhile, in the sky</Eyebrow>
      <Big>
        {meta.glyph} {meta.title} happened{" "}
        <span className="text-gold">
          {r.windowCount} {r.windowCount === 1 ? "time" : "times"}
        </span>{" "}
        on you.
      </Big>
      <Sub>{meta.explainer}</Sub>
    </>
  );

  /* Every play inside those windows, the same plays the anthem below is
     picked from. It used to count only the plays the trial tested, so a
     12-month history read "0 songs played when Mercury is retrograde" and
     then "7 plays when Mercury is retrograde" for its anthem. */
  if (r.windowPlays > 0) slides.push(
    <>
      <Eyebrow>And you kept listening</Eyebrow>
      <Big>
        {r.windowPlays.toLocaleString()} {r.windowPlays === 1 ? "song" : "songs"} played
        <br />
        {meta.when}.
      </Big>
      <Sub>{meta.lore}</Sub>
    </>
  );

  // The same answer the dashboard gives, from the same function.
  const reading = warming ? null : readTrial(r);

  if (r.retroAnthem) {
    slides.push(
      <>
        <Eyebrow>One song kept coming back</Eyebrow>
        <div className="flex flex-col items-center gap-5">
          <AlbumArt
            artist={r.retroAnthem.artist}
            track={r.retroAnthem.track}
            alt={`Album art for ${r.retroAnthem.track}`}
            className="w-44 h-44"
          />
          <Big>
            {r.retroAnthem.track}
            <span className="block text-2xl text-ink-2 mt-2">{r.retroAnthem.artist}</span>
          </Big>
        </div>
        <Sub>
          {meta.anthemLabel}: {r.retroAnthem.plays.toLocaleString()} plays{" "}
          {meta.when}.
        </Sub>
      </>
    );
  }

  slides.push(warming ? (
    <>
      <Eyebrow>The verdict</Eyebrow>
      {/* The young reveal skips the slides that set up the question, so it
          asks it here: otherwise "too soon" never says too soon for what. */}
      <Sub>{METRICS[r.metric].question(meta.qSubject)}</Sub>
      <Big>{TOO_SOON_HEADLINE}</Big>
      <Sub>{warmupExplanation(r.metric, warming, meta.when, now)}</Sub>
    </>
  ) : (
    <>
      <Eyebrow>The verdict</Eyebrow>
      <Sub>{METRICS[r.metric].question(meta.qSubject)}</Sub>
      <div className="font-display text-6xl sm:text-7xl leading-none text-gold">{reading!.big}</div>
      <Sub>{reading!.sub}</Sub>
      {reading!.likelihood && (
        <p className="text-ink-2 text-base max-w-md">
          <strong className="text-ink">{reading!.likelihood.label}</strong>{" "}
          {reading!.likelihood.sentence}
          {showP && (
            <span className="block text-ink-3 text-xs mt-2 tabular">
              {pValueNote(r.p, r.iterations)}
            </span>
          )}
        </p>
      )}
    </>
  ));

  const [i, setI] = useState(0);
  const last = i >= slides.length - 1;

  const advance = useCallback(() => {
    if (last) onDone();
    else setI((x) => x + 1);
  }, [last, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, onDone]);

  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--sky)] flex flex-col items-center justify-center px-8 text-center cursor-pointer select-none"
      onClick={advance}
      role="dialog"
      aria-label="Your Retrospect reveal"
    >
      <Button
        variant="ghost"
        size="xs"
        className="absolute top-5 right-6 h-auto px-0 text-xs uppercase tracking-[0.2em] text-ink-3 hover:bg-transparent hover:text-ink-2"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
      >
        Skip to the data →
      </Button>

      {/* keyed so each slide re-runs its entrance animation */}
      <div key={i} className="rise max-w-2xl flex flex-col items-center gap-6">
        {slides[i]}
      </div>

      <div className="absolute bottom-8 flex items-center gap-2">
        {slides.map((_, d) => (
          <span
            key={d}
            className={`h-1.5 rounded-full transition-all ${
              d === i ? "w-6 bg-gold" : "w-1.5 bg-surface-2"
            }`}
          />
        ))}
      </div>
      <p className="absolute bottom-14 text-ink-3 text-xs">
        {last ? "click for the full report" : "click to continue"}
      </p>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-ink-3 tracking-[0.35em] uppercase text-xs">{children}</p>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-4xl sm:text-5xl text-ink leading-tight">{children}</h2>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-2 max-w-lg leading-relaxed">{children}</p>;
}
