"use client";

import { useEffect, useState } from "react";
import { MatchupCard, Spinner } from "@blakesteve/roster";
import type { Report } from "@/lib/report";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS } from "@/lib/analysis/metrics";

/** Neutral fallback avatar: a little gold moon on navy. */
const FALLBACK_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#171c3d"/><circle cx="32" cy="32" r="14" fill="#d4af37"/><circle cx="38" cy="28" r="12" fill="#171c3d"/></svg>`
  );

type Status = "syncing" | "ready" | "error";

interface UserState {
  status: Status;
  progress: string;
  avatar: string;
  reports: Partial<Record<PhenomenonKey, Report>>;
}

const emptyUser = (): UserState => ({
  status: "syncing",
  progress: "locating…",
  avatar: FALLBACK_AVATAR,
  reports: {},
});

/** Effect strength: how far the index sits from 1.0, in percent. */
const strength = (r: Report | undefined) =>
  r && Number.isFinite(r.index) ? Math.round(Math.abs(r.index - 1) * 100) : 0;
const significant = (r: Report | undefined) => Boolean(r?.verdict.significant);

export function Versus({ a, b }: { a: string; b: string }) {
  const [users, setUsers] = useState<Record<"a" | "b", UserState>>({
    a: emptyUser(),
    b: emptyUser(),
  });
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tzm = String(-new Date().getTimezoneOffset());

    async function run(slot: "a" | "b", username: string) {
      // Avatar (best-effort, parallel with sync).
      fetch(`/api/user/${encodeURIComponent(username)}/avatar`)
        .then((res) => (res.ok ? res.json() : null))
        .then((d) => {
          if (!cancelled && d?.imageUrl) {
            setUsers((u) => ({ ...u, [slot]: { ...u[slot], avatar: d.imageUrl } }));
          }
        })
        .catch(() => {});

      // Sync until ready.
      for (;;) {
        const res = await fetch(`/api/user/${encodeURIComponent(username)}/status`);
        if (!res.ok) throw new Error(`${username}: HTTP ${res.status}`);
        const s = await res.json();
        if (cancelled) return;
        if (s.status === "error") throw new Error(`${username}: ${s.error}`);
        setUsers((u) => ({
          ...u,
          [slot]: {
            ...u[slot],
            progress:
              s.totalPages > 0
                ? `${Math.min(s.pagesDone * 200, s.totalScrobbles).toLocaleString()} / ${s.totalScrobbles.toLocaleString()} scrobbles`
                : "locating…",
          },
        }));
        if (s.status === "ready") break;
        await new Promise((r) => setTimeout(r, 800));
      }

      // All five trials, sequentially (each is cached server-side afterwards).
      for (const key of PHENOMENON_KEYS) {
        const metric = METRICS[PHENOMENA[key].metric];
        const params = new URLSearchParams({
          threshold: String(metric.slider?.default ?? 365),
          level: "track",
          body: key,
          noise: "exclude",
          tzm,
        });
        const res = await fetch(`/api/user/${encodeURIComponent(username)}/report?${params}`);
        if (!res.ok) continue;
        const report: Report = await res.json();
        if (cancelled) return;
        setUsers((u) => ({
          ...u,
          [slot]: { ...u[slot], reports: { ...u[slot].reports, [key]: report } },
        }));
      }
      if (!cancelled) {
        setUsers((u) => ({ ...u, [slot]: { ...u[slot], status: "ready" } }));
      }
    }

    Promise.all([run("a", a), run("b", b)]).catch((err) => {
      if (!cancelled) setFatal(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [a, b]);

  if (fatal) {
    return (
      <div className="text-center py-24">
        <h1 className="font-display text-3xl text-gold mb-4">The duel is off.</h1>
        <p className="text-ink-2">{fatal}</p>
      </div>
    );
  }

  const loading = users.a.status !== "ready" || users.b.status !== "ready";
  let winsA = 0;
  let winsB = 0;
  for (const key of PHENOMENON_KEYS) {
    const ra = users.a.reports[key];
    const rb = users.b.reports[key];
    if (!ra || !rb) continue;
    const sa = significant(ra) ? strength(ra) : 0;
    const sb = significant(rb) ? strength(rb) : 0;
    if (sa > sb) winsA++;
    else if (sb > sa) winsB++;
  }

  return (
    <div>
      <header className="text-center mb-10 rise">
        <p className="text-ink-3 tracking-[0.3em] uppercase text-xs mb-3">
          Trial by sky
        </p>
        <h1 className="font-display text-4xl text-ink">
          {a} <span className="text-gold">vs</span> {b}
        </h1>
        {!loading && (
          <p className="text-ink-2 mt-4">
            {winsA === winsB
              ? "A perfect stalemate. The sky refuses to pick a favorite."
              : `${winsA > winsB ? a : b} is the more sky-ruled listener, ${Math.max(winsA, winsB)}–${Math.min(winsA, winsB)}.`}
          </p>
        )}
      </header>

      {loading && (
        <div className="flex flex-col items-center gap-3 py-10 text-ink-3 text-sm">
          <Spinner variant="primary" size="lg" />
          <p>
            {a}: {users.a.status === "ready" ? "ready" : users.a.progress} &middot; {b}:{" "}
            {users.b.status === "ready" ? "ready" : users.b.progress}
          </p>
          <p className="text-xs">First visits pull full histories, so bring snacks.</p>
        </div>
      )}

      {!loading && (
        <p className="text-center text-xs text-ink-3 mb-6 max-w-lg mx-auto leading-relaxed">
          Each round: how strongly that sky bends each listener&rsquo;s habits, as a
          percentage. A score only counts when our scramble test says the effect is real;{" "}
          <span className="text-ink-2">coincidences score zero</span>.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-1 max-w-xl mx-auto">
        {PHENOMENON_KEYS.map((key) => {
          const ph = PHENOMENA[key];
          const metric = METRICS[ph.metric];
          const ra = users.a.reports[key];
          const rb = users.b.reports[key];
          if (!ra && !rb) return null;
          const sa = significant(ra) ? strength(ra) : 0;
          const sb = significant(rb) ? strength(rb) : 0;
          const tie = sa === sb;
          const rowStory = tie
            ? sa === 0
              ? `Neither of you actually responds to ${ph.title.toLowerCase()}s. The sky shrugs.`
              : `Dead heat, you're equally moved.`
            : `${sa > sb ? a : b}'s ${metric.tagNoun} shift ${Math.max(sa, sb)}% when this sky turns${
                Math.min(sa, sb) === 0 ? `; ${sa > sb ? b : a} doesn't budge.` : `, beating ${Math.min(sa, sb)}%.`
              }`;
          return (
            <div key={key} className="rise">
              <p className="text-ink-3 text-xs uppercase tracking-[0.2em] mb-2">
                {ph.glyph} {ph.title} &middot; {metric.name}
              </p>
              <MatchupCard
                awayTeam={{
                  id: a,
                  logoSrc: users.a.avatar,
                  name: a,
                  score: sa,
                  isWinner: !tie && sa > sb,
                  accessory: significant(ra) ? `moved ${strength(ra)}%, real` : "no real effect",
                }}
                homeTeam={{
                  id: b,
                  logoSrc: users.b.avatar,
                  name: b,
                  score: sb,
                  isWinner: !tie && sb > sa,
                  accessory: significant(rb) ? `moved ${strength(rb)}%, real` : "no real effect",
                }}
                isCompleted={Boolean(ra && rb)}
                isTie={tie}
              />
              <p className="text-ink-3 text-xs mt-1.5 text-center">{rowStory}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
