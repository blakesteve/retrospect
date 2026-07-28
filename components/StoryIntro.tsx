"use client";

import { useCallback, useEffect, useState } from "react";
import type { Report } from "@/lib/report";
import { PHENOMENA } from "@/lib/ephemeris/phenomena";
import { AlbumArt } from "./AlbumArt";

/**
 * The Wrapped-style opening: one revelation at a time, full screen, before
 * the dashboard. Click / space / → advances; Skip bails to the data.
 */
export function StoryIntro({ report, onDone }: { report: Report; onDone: () => void }) {
  const r = report;
  const years = Math.max(
    1,
    new Date(r.lastScrobbleUts * 1000).getUTCFullYear() -
      new Date(r.firstScrobbleUts * 1000).getUTCFullYear()
  );

  const slides: React.ReactNode[] = [];

  slides.push(
    <>
      <Eyebrow>First, the scale of this</Eyebrow>
      <Big>
        {years} years.
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
        <span className="text-gold">{r.windowCount} times</span> on you.
      </Big>
      <Sub>{meta.explainer}</Sub>
    </>
  );

  slides.push(
    <>
      <Eyebrow>And you kept listening</Eyebrow>
      <Big>
        {r.retroN.toLocaleString()} songs played
        <br />
        {meta.when}.
      </Big>
      <Sub>{meta.lore}</Sub>
    </>
  );

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

  slides.push(
    <>
      <Eyebrow>The verdict</Eyebrow>
      <div className="font-display text-[7rem] leading-none text-gold tabular">
        {Number.isFinite(r.index) ? r.index.toFixed(2) : "—"}
        <span className="text-5xl">&times;</span>
      </div>
      <Big>{r.verdict.headline}</Big>
      <Sub>{r.verdict.detail}</Sub>
    </>
  );

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
      <button
        className="absolute top-5 right-6 text-ink-3 hover:text-ink-2 text-xs tracking-[0.2em] uppercase"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
      >
        Skip to the data →
      </button>

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
