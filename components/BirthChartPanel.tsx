"use client";

import { useEffect, useState } from "react";
import { Button } from "@blakesteve/roster";
import { computeNatalChart, type NatalChart } from "@/lib/astro/natal";
import type { ZodiacSign } from "@/lib/ephemeris/retrogrades";

const STORAGE_KEY = "retrospect.natal.v1";

const GLYPHS: Record<ZodiacSign, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋", Leo: "♌", Virgo: "♍",
  Libra: "♎", Scorpio: "♏", Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};

interface StoredBirth {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  offset: number; // hours east of UTC at birth place
  lat: string;
  lon: string;
}

const OFFSETS: number[] = [];
for (let o = -12; o <= 14; o += 0.5) OFFSETS.push(o);
const fmtOffset = (o: number) =>
  `UTC${o >= 0 ? "+" : "−"}${Math.floor(Math.abs(o))}${Math.abs(o) % 1 ? ":30" : ""}`;

function chartFromBirth(b: StoredBirth): NatalChart | null {
  if (!b.date) return null;
  const [y, m, d] = b.date.split("-").map(Number);
  const [hh, mm] = (b.time || "12:00").split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - b.offset * 3600 * 1000;
  if (!Number.isFinite(utcMs)) return null;
  const lat = parseFloat(b.lat);
  const lon = parseFloat(b.lon);
  const coords =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 66
      ? { latitude: lat, longitude: lon }
      : null;
  return computeNatalChart(new Date(utcMs), coords);
}

/**
 * Birth data in, natal chart out — computed entirely in this browser tab and
 * stored only in localStorage. Nothing about your birth ever hits a server.
 */
export function BirthChartPanel({ onChart }: { onChart: (chart: NatalChart | null) => void }) {
  const [birth, setBirth] = useState<StoredBirth>({ date: "", time: "", offset: -5, lat: "", lon: "" });
  const [chart, setChart] = useState<NatalChart | null>(null);
  const [editing, setEditing] = useState(false);

  // Load saved birth data once, client-side only.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: StoredBirth = JSON.parse(raw);
      const c = chartFromBirth(saved);
      if (c) {
        setBirth(saved);
        setChart(c);
        onChart(c);
      }
    } catch {
      // corrupted storage: start fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const c = chartFromBirth(birth);
    if (!c) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(birth));
    setChart(c);
    setEditing(false);
    onChart(c);
  };

  const clear = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setChart(null);
    setBirth({ date: "", time: "", offset: -5, lat: "", lon: "" });
    onChart(null);
  };

  const inputCls =
    "rounded-md bg-surface-2 border border-[var(--hairline)] px-2 py-1.5 text-ink text-xs " +
    "outline-none focus:border-gold transition-colors";

  if (chart && !editing) {
    return (
      <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
          <p className="text-ink-3 text-xs uppercase tracking-[0.2em]">Your chart</p>
          <span className="text-xs text-ink-3">
            <button className="underline hover:text-ink-2" onClick={() => setEditing(true)}>edit</button>
            {" · "}
            <button className="underline hover:text-ink-2" onClick={clear}>forget me</button>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label="Sun" glyph="☉" sign={chart.sun.sign} />
          <Chip label="Moon" glyph="☾" sign={chart.moon.sign} />
          {chart.rising ? (
            <Chip label="Rising" glyph="↑" sign={chart.rising.sign} />
          ) : (
            <span className="text-xs text-ink-3 self-center">
              (add birth coordinates for your rising sign)
            </span>
          )}
          <Chip label="Mercury" glyph="☿" sign={chart.mercury.sign} />
          <Chip label="Venus" glyph="♀" sign={chart.venus.sign} />
          <Chip label="Mars" glyph="♂" sign={chart.mars.sign} />
        </div>
        <p className="text-ink-3 text-xs mt-3">
          Your signs are highlighted in the sign breakdown below. Computed in your browser;
          your birth data never leaves this device.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
      <p className="text-ink-3 text-xs uppercase tracking-[0.2em] mb-1">Add your birth chart</p>
      <p className="text-ink-3 text-xs mb-4 max-w-lg leading-relaxed">
        Date gives your Sun and planets; time sharpens the Moon; coordinates unlock your
        rising sign. Everything is computed in your browser and saved only on this device.
      </p>
      <div className="flex flex-wrap items-end gap-3 text-xs text-ink-2">
        <label className="flex flex-col gap-1">
          birth date
          <input type="date" value={birth.date} onChange={(e) => setBirth({ ...birth, date: e.target.value })} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          time (local)
          <input type="time" value={birth.time} onChange={(e) => setBirth({ ...birth, time: e.target.value })} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          birthplace UTC offset
          <select
            value={birth.offset}
            onChange={(e) => setBirth({ ...birth, offset: Number(e.target.value) })}
            className={inputCls}
          >
            {OFFSETS.map((o) => (
              <option key={o} value={o}>{fmtOffset(o)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          latitude (optional)
          <input placeholder="41.88" value={birth.lat} onChange={(e) => setBirth({ ...birth, lat: e.target.value })} className={`${inputCls} w-20`} />
        </label>
        <label className="flex flex-col gap-1">
          longitude
          <input placeholder="-87.63" value={birth.lon} onChange={(e) => setBirth({ ...birth, lon: e.target.value })} className={`${inputCls} w-20`} />
        </label>
        <Button
          type="button"
          colorScheme="primary"
          variant="solid"
          size="sm"
          onClick={save}
          disabled={!birth.date}
        >
          Cast my chart
        </Button>
      </div>
    </div>
  );
}

function Chip({ label, glyph, sign }: { label: string; glyph: string; sign: ZodiacSign }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-surface-2 px-3 py-1 text-xs">
      <span className="text-gold">{glyph}</span>
      <span className="text-ink-3">{label}</span>
      <span className="text-ink">{GLYPHS[sign]} {sign}</span>
    </span>
  );
}
