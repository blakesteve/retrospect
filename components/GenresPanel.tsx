"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@blakesteve/roster";
import type { GenreAnalysis } from "@/lib/genres";
import { PHENOMENA, type PhenomenonKey } from "@/lib/ephemeris/phenomena";

interface Building {
  status: "building";
  done: number;
  total: number;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Genres × the sky: which corners of your taste each phenomenon actually
 * moves, plus a forecast for upcoming events. First visit builds the tag
 * cache (~200 artist lookups); after that it's instant.
 */
export function GenresPanel({ username, body }: { username: string; body: PhenomenonKey }) {
  const [state, setState] = useState<GenreAnalysis | Building | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      for (;;) {
        try {
          const res = await fetch(`/api/user/${encodeURIComponent(username)}/genres`);
          if (!res.ok) throw new Error(String(res.status));
          const data: GenreAnalysis | Building = await res.json();
          if (cancelled) return;
          setState(data);
          if (data.status === "ready") return;
        } catch {
          if (!cancelled) setFailed(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 900));
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (failed || (state?.status === "ready" && state.genres.length === 0)) return null;

  if (!state || state.status === "building") {
    const pct = state && state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    return (
      <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5 flex items-center gap-4">
        <Spinner variant="primary" size="sm" />
        <div className="flex-1">
          <p className="text-ink text-sm">Reading the liner notes&hellip;</p>
          <p className="text-ink-3 text-xs mt-0.5 tabular">
            {state
              ? `${state.done} of ${state.total} artists tagged (${pct}%). One-time setup, cached forever`
              : "warming up the genre engine…"}
          </p>
        </div>
      </div>
    );
  }

  const a = state;
  const rows = a.affinity[body] ?? [];
  const meta = PHENOMENA[body];

  // Forecast: for each phenomenon's NEXT window, its strongest significant genre.
  const now = Date.now();
  const forecasts = (Object.keys(PHENOMENA) as PhenomenonKey[])
    .map((key) => {
      const next = PHENOMENA[key].windows.find((w) => Date.parse(w.start) > now);
      const top = (a.affinity[key] ?? []).find((g) => g.p < 0.05);
      if (!next || !top) return null;
      return { key, next, top };
    })
    .filter(Boolean)
    .slice(0, 3) as { key: PhenomenonKey; next: { start: string; end: string; sign: string }; top: { genre: string; index: number } }[];

  return (
    <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
      <h3 className="text-ink text-sm font-medium mb-1">Your genres &amp; the sky</h3>
      <p className="text-ink-3 text-xs mb-4 max-w-xl leading-relaxed">
        Built from your top {a.artistsTagged} artists&rsquo; Last.fm tags. Does{" "}
        {meta.title.toLowerCase()} change <em>what kind</em>
        {" of music you reach for? "}Bars show each genre&rsquo;s share of your listening
        inside the windows vs. outside.
      </p>

      {a.headline && (
        <p className="text-ink-2 text-xs mb-4 rounded-md bg-surface-2 border border-gold/30 p-3">
          ✦ Your headline: <strong className="text-ink">{a.headline.genre}</strong>{" "}
          {a.headline.index > 1 ? "rises" : "fades"}{" "}
          {Math.abs(Math.round((a.headline.index - 1) * 100))}%{" "}
          {PHENOMENA[a.headline.body].when}, and it survived the scramble test.
        </p>
      )}

      {rows.length > 0 ? (
        <ul className="space-y-1.5">
          {rows.slice(0, 8).map((g) => {
            const delta = Math.round((g.index - 1) * 100);
            const width = Math.min(100, Math.abs(g.index - 1) * 250);
            const isOpen = expanded === g.genre;
            return (
              <li key={g.genre}>
                <button
                  onClick={() => setExpanded(isOpen ? null : g.genre)}
                  aria-expanded={isOpen}
                  className="flex items-center gap-3 text-xs w-full rounded-md px-1 py-0.5 hover:bg-surface-2 transition-colors text-left"
                >
                  <span className="w-32 text-ink-2 shrink-0 truncate">
                    <span className={`inline-block mr-1 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                      ▸
                    </span>
                    {g.genre}
                  </span>
                  <span className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(3, width)}%`,
                        background: g.index >= 1 ? "var(--series-1)" : "var(--accent-mark)",
                      }}
                    />
                  </span>
                  <span className="w-12 text-right tabular text-ink shrink-0">
                    {delta > 0 ? `+${delta}%` : `${delta}%`}
                  </span>
                  <span className="w-16 text-right shrink-0">
                    {g.p < 0.05 ? (
                      <span className="text-gold">real ✦</span>
                    ) : (
                      <span className="text-ink-3">chance?</span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="ml-6 mt-2 mb-3 rounded-md bg-surface-2 border border-[var(--hairline)] p-3">
                    <p className="text-ink-3 text-[11px] mb-2 uppercase tracking-[0.15em]">
                      {g.genre} across every sky
                    </p>
                    <ul className="space-y-1">
                      {(Object.keys(a.affinity) as PhenomenonKey[]).map((k) => {
                        const entry = a.affinity[k]?.find((x) => x.genre === g.genre);
                        if (!entry) {
                          return (
                            <li key={k} className="flex items-center gap-2 text-[11px] text-ink-3">
                              <span className="w-36 shrink-0">
                                {PHENOMENA[k].glyph} {PHENOMENA[k].title}
                              </span>
                              <span>too little data</span>
                            </li>
                          );
                        }
                        const d = Math.round((entry.index - 1) * 100);
                        const w = Math.min(100, Math.abs(entry.index - 1) * 250);
                        return (
                          <li key={k} className="flex items-center gap-2 text-[11px]">
                            <span className="w-36 shrink-0 text-ink-2">
                              {PHENOMENA[k].glyph} {PHENOMENA[k].title}
                            </span>
                            <span className="flex-1 h-1.5 bg-surface-1 rounded-full overflow-hidden">
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${Math.max(3, w)}%`,
                                  background:
                                    entry.index >= 1 ? "var(--series-1)" : "var(--accent-mark)",
                                }}
                              />
                            </span>
                            <span className="w-10 text-right tabular text-ink shrink-0">
                              {d > 0 ? `+${d}%` : `${d}%`}
                            </span>
                            <span className="w-12 text-right shrink-0">
                              {entry.p < 0.05 ? (
                                <span className="text-gold">real ✦</span>
                              ) : (
                                <span className="text-ink-3">chance?</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-ink-3 text-xs">
          Not enough per-genre data inside {meta.title.toLowerCase()} windows for this one.
        </p>
      )}

      {(forecasts.length > 0 || a.rising.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-4 mt-5 pt-4 border-t border-[var(--hairline)]">
          {forecasts.length > 0 && (
            <div>
              <h4 className="text-ink text-xs font-medium mb-2 uppercase tracking-[0.15em]">
                Your forecast
              </h4>
              <ul className="space-y-2 text-xs text-ink-3 leading-relaxed">
                {forecasts.map((f) => (
                  <li key={f.key}>
                    <span className="text-ink-2">
                      {PHENOMENA[f.key].glyph} {fmt(f.next.start)}
                    </span>{" "}
                    brings {PHENOMENA[f.key].title.toLowerCase()} in {f.next.sign}. History says
                    your <strong className="text-ink-2">{f.top.genre}</strong>{" "}
                    {f.top.index > 1 ? "comes back" : "goes quiet"} (
                    {f.top.index > 1 ? "+" : ""}
                    {Math.round((f.top.index - 1) * 100)}%).
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.rising.length > 0 && (
            <div>
              <h4 className="text-ink text-xs font-medium mb-2 uppercase tracking-[0.15em]">
                Rising in your rotation (90 days)
              </h4>
              <ul className="space-y-1 text-xs text-ink-3">
                {a.rising.slice(0, 4).map((r) => (
                  <li key={r.genre} className="flex justify-between gap-2">
                    <span className="truncate">{r.genre}</span>
                    <span className="tabular text-ink-2 shrink-0">
                      {r.ratio >= 1 ? "↑" : "↓"} {Math.round(Math.abs(r.ratio - 1) * 100)}%
                      vs your usual
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
