"use client";

import { useEffect, useState } from "react";
import { Countdown } from "@blakesteve/roster";
import { PHENOMENA, PHENOMENON_KEYS } from "@/lib/ephemeris/phenomena";
import type { RetrogradeWindow } from "@/lib/ephemeris/retrogrades";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

interface Entry {
  glyph: string;
  title: string;
  window: RetrogradeWindow;
  active: boolean;
  startsMs: number;
}

/**
 * The sky calendar: what's happening now and next across every phenomenon,
 * with a live countdown to the nearest event. Client-side because it depends
 * on the current date, which a prerendered page must not bake in.
 */
export function SkyCalendar() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  if (now === null) return <div className="mt-12 h-40" />;

  const entries: Entry[] = [];
  for (const key of PHENOMENON_KEYS) {
    const ph = PHENOMENA[key];
    const active = ph.windows.find(
      (w) => Date.parse(w.start) <= now && Date.parse(w.end) > now
    );
    const next = ph.windows.find((w) => Date.parse(w.start) > now);
    const window = active ?? next;
    if (!window) continue;
    entries.push({
      glyph: ph.glyph,
      title: ph.title,
      window,
      active: Boolean(active),
      startsMs: Date.parse(window.start),
    });
  }
  entries.sort((a, b) => Number(b.active) - Number(a.active) || a.startsMs - b.startsMs);

  const soonest = entries.find((e) => !e.active);

  return (
    <section className="mt-12 w-full max-w-2xl" aria-label="Sky calendar">
      <p className="text-ink-3 tracking-[0.3em] uppercase text-xs text-center mb-4">
        The sky, currently
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {entries.map((e) => (
          <li
            key={e.title}
            className={`rounded-lg border p-3 flex items-center gap-3 text-sm ${
              e.active
                ? "border-gold bg-surface-1"
                : "border-[var(--hairline)] bg-surface-1/50"
            }`}
          >
            <span className="text-xl" aria-hidden>
              {e.glyph}
            </span>
            <span className="flex-1">
              <span className="block text-ink">
                {e.title}
                {e.active && <span className="text-gold">, happening now</span>}
              </span>
              <span className="block text-ink-3 text-xs">
                {fmt(e.window.start)} – {fmt(e.window.end)} · in {e.window.sign}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {soonest && (
        <div className="mt-5 text-center">
          <Countdown
            targetDate={new Date(soonest.startsMs)}
            title={`Next up: ${soonest.glyph} ${soonest.title} in ${soonest.window.sign}`}
            completionText="It has begun."
            variant="primary"
          />
        </div>
      )}
    </section>
  );
}
