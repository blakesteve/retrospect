"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Stat } from "@blakesteve/roster";
import type { AnswerWord } from "@/lib/answers/words";
import { useListener } from "./Shell";
import { songIndex } from "./format";
import { Jar, WORD_COLOR } from "./pieces";
import { SkyWheel } from "./sky";

/* The reveal (spec 8.3): four full-screen cards, once per username per
   browser. Click, Space, Right arrow or Enter advance; Escape or "Skip"
   leaves. Each card's heading takes focus as it appears (11). */

const JARS: AnswerWord[] = ["Yes", "Maybe", "Not clearly", "No", "Too early"];

const REDUCE = "(prefers-reduced-motion: reduce)";
const useReducedMotion = () =>
  useSyncExternalStore(
    (on) => {
      const mq = window.matchMedia(REDUCE);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    },
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );

/** A number that counts up; the final value is in the accessible name from
    the start and the animation is aria-hidden (11). */
function CountUp({ value, label }: { value: number; label: string }) {
  const reduced = useReducedMotion();
  const [counted, setShown] = useState(0);
  // Under reduced motion, the final value at once (11).
  const shown = reduced ? value : counted;
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1300);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  // Roster's Stat (12), the value counting up beside its final number.
  return (
    <Stat
      size="lg"
      colorScheme="primary"
      label={label}
      value={
        <>
          <span className="sr-only">{value.toLocaleString("en-US")}</span>
          <span aria-hidden className="font-display tabular">
            {shown.toLocaleString("en-US")}
          </span>
        </>
      }
    />
  );
}

export function Reveal({ onDone }: { onDone: (seen?: boolean) => void }) {
  const L = useListener();
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const h = L.highlights.state === "ready" ? L.highlights.data : null;
  const songs = songIndex(L.songs.state === "ready" ? L.songs.data : undefined);
  const strange = h?.strangest ? songs.get(h.strangest.songId) : undefined;
  const wild = h?.wild?.[0];

  const cards: { key: string; title: string; body: ReactNode }[] = [];
  if (h?.length && h.counts) {
    const c = h.counts;
    const counts: [number, string][] = [
      [c.plays, "plays"],
      [c.venusSignChanges, "times Venus changed sign"],
      [c.storms, "solar storms"],
      [c.flybys, "asteroid flybys closer than about 4 lunar distances"],
    ];
    cards.push({
      key: "length",
      title: `${h.length} under the sky.`,
      body: (
        <dl className="mt-6 grid gap-5">
          {counts
            .filter(([n]) => n > 0)
            .map(([n, label]) => (
              <CountUp key={label} value={n} label={label} />
            ))}
        </dl>
      ),
    });
  }
  if (wild && h?.wildest) {
    cards.push({
      key: "wild",
      title: "Your wildest night",
      body: (
        <>
          {wild.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- NASA's own CDN, credited
            <img src={wild.photo.url} alt="" className="mt-5 aspect-[4/3] w-full rounded-2xl object-cover" />
          )}
          {/* The line opens with the night's title (8.3). */}
          <p className="mt-5 text-[17px] leading-relaxed text-ink">{h.wildest.line}</p>
          {wild.photo?.credit && <p className="mt-2 text-[12px] text-ink-2">{wild.photo.credit}</p>}
        </>
      ),
    });
  }
  if (h?.strangest && strange) {
    cards.push({
      key: "strange",
      title: "The song with the strangest sky",
      body: (
        <>
          <p className="mt-5 font-display text-[26px] leading-tight text-ink">{strange.track}</p>
          <p className="mt-1 text-ink-2">{strange.artist}</p>
          <p className="mt-4 text-[17px] leading-relaxed text-ink">{h.strangest.line}</p>
        </>
      ),
    });
  }
  if (answers) {
    cards.push({
      key: "answers",
      title: "So, does the sky move you?",
      body: (
        <>
          <ul className="mt-6 grid grid-cols-5 gap-2 text-center">
            {JARS.map((w) => (
              <li key={w} className="flex flex-col items-center gap-1">
                <Jar fill={answers.tally[w] / 6} color={WORD_COLOR[w]} width={40} />
                <span className="font-display text-[24px] leading-none" style={{ color: WORD_COLOR[w] }}>
                  {answers.tally[w]}
                </span>
                <span className="text-[11px] leading-tight text-ink-2">{w}</span>
              </li>
            ))}
          </ul>
          {answers.reveal.notChecked && <p className="mt-3 text-center text-[13px] text-ink-2">{answers.reveal.notChecked}</p>}
          <p className="mt-6 text-[18px] leading-relaxed text-ink">{answers.reveal.line}</p>
          <Button size="lg" className="mt-6 w-full" onClick={() => onDone()}>
            Open your sky
          </Button>
        </>
      ),
    });
  }

  const [i, setI] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const last = cards.length - 1;
  const next = useCallback(() => (i >= last ? onDone() : setI(i + 1)), [i, last, onDone]);

  useEffect(() => headingRef.current?.focus(), [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      else if (e.key === "ArrowRight" || ((e.key === " " || e.key === "Enter") && !(e.target as HTMLElement).closest("button,a"))) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onDone]);
  // Nothing to show: leave without marking it seen, so it shows next time.
  useEffect(() => {
    if (cards.length === 0) onDone(false);
  }, [cards.length, onDone]);
  if (cards.length === 0) return null;
  const card = cards[Math.min(i, last)];

  return (
    <div role="dialog" aria-modal="true" aria-label="Your sky" className="fixed inset-0 z-50 overflow-y-auto bg-sky">
      <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-5 pb-8 pt-4">
        <div className="flex items-center justify-between">
          <Button size="lg" variant="ghost" onClick={() => onDone()}>
            Skip
          </Button>
          <span aria-hidden className="text-[13px] text-ink-2">
            {i + 1} of {cards.length}
          </span>
        </div>
        {/* Click anywhere on the card to advance (8.3). */}
        <div className="flex-1 pt-6" onClick={(e) => !(e.target as HTMLElement).closest("button,a") && i < last && next()}>
          <div aria-hidden className="pointer-events-none absolute right-5 top-16 opacity-25">
            {L.skyNow.state === "ready" && <SkyWheel bodies={L.skyNow.data.sky.bodies} size={120} />}
          </div>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-[32px] leading-tight text-ink outline-none" aria-label={`${card.title} Card ${i + 1} of ${cards.length}`}>
            {card.title}
          </h2>
          {card.body}
        </div>
        {i < last && (
          <Button size="lg" className="mt-8 w-full" onClick={next}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
