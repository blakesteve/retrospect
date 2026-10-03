"use client";

import { useEffect, useState } from "react";
import { Card } from "@blakesteve/roster";
import { percentWords } from "@/lib/listener/words";
import type { ProfileResponse } from "@/lib/profile";
import { Row, RowFailed } from "./listener/pieces";

/* Tonight's "Your habits" row (spec 8.4): when you listen, how much and what
   you reach for, read from every play with noise excluded. The server writes
   every sentence that depends on the history, the pending one included, so
   this file imports none of the modules that reach the window JSON (13.5).
   The heading and the failed line are the shared row's, so this row reads
   like its neighbors. */

const HEADING = "Your habits";
const LINE = "Not the sky: when you listen, how much, and what you reach for, from every play.";
/** Today's tiny-history sentence (8.4), under 500 plays. */
const tooFewLine = (needed: number, have: number) =>
  `Your listening fingerprints (when you listen, how much, and what you reach for) show up once there are ${needed.toLocaleString("en-US")} of your plays to read. So far there are ${have.toLocaleString("en-US")}.`;

type Result =
  | { kind: "ready"; profile: ProfileResponse }
  | { kind: "too-few"; have: number; needed: number }
  | { kind: "failed" };

/** What a response means for the row. Anything unexpected is a failure. */
async function readResponse(res: Response): Promise<Result> {
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") return { kind: "failed" };
  if (res.ok && Array.isArray(data.hourShares)) return { kind: "ready", profile: data as ProfileResponse };
  if (
    res.status === 404 &&
    data.code === "too-few-plays" &&
    typeof data.have === "number" &&
    typeof data.needed === "number"
  ) {
    return { kind: "too-few", have: data.have, needed: data.needed };
  }
  return { kind: "failed" };
}

/** "6 a.m.", "noon", "midnight", as 9.2 writes times. */
const fmtHour = (h: number) => {
  if (h % 24 === 0) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12} ${h < 12 ? "a.m." : "p.m."}`;
};

export function ListeningProfile({ username, zone, level = 2 }: { username: string; zone: string; level?: 2 | 3 }) {
  const query = zone ? `?${new URLSearchParams({ tz: zone })}` : "";
  const url = `/api/user/${encodeURIComponent(username)}/profile${query}`;
  /* Keyed by the URL it answers, so a new username or zone shows the
     skeleton again instead of the last listener's habits. */
  const [loaded, setLoaded] = useState<{ url: string; result: Result } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (result: Result) => {
      if (!cancelled) setLoaded({ url, result });
    };
    fetch(url)
      .then(readResponse)
      .then(settle, () => settle({ kind: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const result = loaded?.url === url ? loaded.result : null;

  // A row that failed is one line, and the rest of the page stands (8.4).
  if (result?.kind === "failed") {
    return (
      <section aria-label={HEADING} className="mt-10">
        <RowFailed name={HEADING} />
      </section>
    );
  }
  if (result?.kind === "too-few") {
    return (
      <Row id="your-habits" title={HEADING} level={level}>
        <p className="text-ink-2 text-sm max-w-xl leading-relaxed">{tooFewLine(result.needed, result.have)}</p>
      </Row>
    );
  }
  return (
    <Row id="your-habits" title={HEADING} sub={LINE} level={level}>
      {result ? <Habits p={result.profile} /> : <HabitsSkeleton />}
    </Row>
  );
}

/* The app's panel look on Roster's Card (outline: no shadow of its own).
   Border colors are set per use, never twice on one element. */
const PANEL = "rounded-lg bg-surface-1 border-[var(--hairline)] text-ink";
const TILE = "rounded-md bg-surface-2 text-ink p-3";

function Habits({ p }: { p: ProfileResponse }) {
  const maxShare = Math.max(...p.hourShares);
  return (
    <Card variant="outline" padding="none" className={`${PANEL} p-5`}>
      {p.archetypes.length > 0 && (
        <ul className="grid sm:grid-cols-3 gap-3 mb-5">
          {p.archetypes.map((a) => (
            <li key={a.label}>
              <Card variant="outline" padding="none" className={`${TILE} h-full border-gold/30`}>
                <p className="text-gold text-sm font-medium">{a.label}</p>
                <p className="text-ink-2 text-xs mt-1.5 leading-relaxed">{a.why}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {p.pendingSentence && (
        <p className="text-ink-2 text-xs mb-5 max-w-xl leading-relaxed">{p.pendingSentence}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-center">
        <MiniTile
          label="golden hour"
          value={`${fmtHour(p.goldenHour.startHour)}–${fmtHour(p.goldenHour.endHour)}`}
          sub={`${Math.round(p.goldenHour.share * 100)}% of all plays`}
        />
        <MiniTile
          label="your day"
          value={`${p.topWeekday.day}s`}
          sub={`${Math.round(p.topWeekday.share * 100)}% of your listening`}
        />
        <MiniTile
          label="loudest month"
          value={p.topMonth.month}
          sub={`${p.topMonth.delta >= 0 ? "+" : ""}${Math.round(p.topMonth.delta * 100)}% vs your usual pace`}
        />
        <MiniTile
          label="pace"
          value={`${Math.round(p.playsPerDay)}/day`}
          sub={`best streak: ${p.longestStreakDays} days straight`}
        />
      </div>

      {/* Hour-of-day rhythm */}
      <div className="flex items-end gap-[3px] h-14" aria-label="Your listening by hour of day" role="img">
        {p.hourShares.map((share, h) => {
          const inGolden =
            p.goldenHour.endHour > p.goldenHour.startHour
              ? h >= p.goldenHour.startHour && h < p.goldenHour.endHour
              : h >= p.goldenHour.startHour || h < p.goldenHour.endHour;
          return (
            <span
              key={h}
              title={`${fmtHour(h)}: ${percentWords(share)}`}
              className="flex-1 rounded-t-[3px]"
              style={{
                height: `${Math.max(4, (share / maxShare) * 100)}%`,
                background: inGolden ? "var(--accent-mark)" : "var(--series-1)",
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-ink-2 tabular mt-1" aria-hidden="true">
        <span>midnight</span>
        <span>6 a.m.</span>
        <span>noon</span>
        <span>6 p.m.</span>
        <span>11 p.m.</span>
      </div>
    </Card>
  );
}

function MiniTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card variant="outline" padding="none" className={`${TILE} border-[var(--hairline)]`}>
      <p className="text-ink-2 text-[10px] uppercase tracking-[0.15em]">{label}</p>
      <p className="font-display text-lg text-ink mt-1">{value}</p>
      <p className="text-ink-2 text-[11px] mt-0.5">{sub}</p>
    </Card>
  );
}

/** Blocks the size of the panel while it loads; never a spinner over content. */
function HabitsSkeleton() {
  return (
    <div aria-hidden="true" className={`${PANEL} border p-5`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] rounded-md bg-surface-2 motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="h-14 rounded-md bg-surface-2 motion-safe:animate-pulse" />
      <div className="h-[15px] mt-1" />
    </div>
  );
}
