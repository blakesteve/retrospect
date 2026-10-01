"use client";

import { useEffect, useState } from "react";
import { MatchupCard, Spinner } from "@blakesteve/roster";
import type { Report } from "@/lib/report";
import { duelSideLabel, duelUnscoredReason } from "@/lib/likelihood";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS } from "@/lib/analysis/metrics";
import {
  apiError,
  toVisitorErrorCode,
  visitorError,
  visitorErrorCodeOf,
  type VisitorErrorCode,
} from "@/lib/visitorErrors";

/** Which duelist's sync failed, so the message can name them. */
class DuelError extends Error {
  constructor(
    readonly username: string,
    readonly code: VisitorErrorCode,
    detail: string,
  ) {
    super(detail);
  }
}

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
/** A side with no report, or one whose verdict was withheld, wasn't tested. */
const tested = (r: Report | undefined) => r?.verdict.status === "tested";

export function Versus({ a, b }: { a: string; b: string }) {
  const [users, setUsers] = useState<Record<"a" | "b", UserState>>({
    a: emptyUser(),
    b: emptyUser(),
  });
  // A code and a name, never raw text: see src/lib/visitorErrors.ts.
  const [fatal, setFatal] = useState<{ code: VisitorErrorCode; username: string } | null>(null);

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
        if (!res.ok) {
          const err = await apiError(res);
          throw new DuelError(username, err.code, err.message);
        }
        const s = await res.json();
        if (cancelled) return;
        if (s.status === "error") throw new DuelError(username, toVisitorErrorCode(s.code), s.error);
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
        // Kept even when untested (warming up, or withheld): the card says so,
        // and the round isn't scored.
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
      console.error("[retrospect] duel failed:", err);
      if (cancelled) return;
      setFatal(
        err instanceof DuelError
          ? { code: err.code, username: err.username }
          : { code: visitorErrorCodeOf(err), username: "" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [a, b]);

  if (fatal) {
    const message = visitorError(fatal.code, fatal.username);
    return (
      <div className="text-center py-24 max-w-md mx-auto">
        <h1 className="font-display text-3xl text-gold mb-4">The duel is off.</h1>
        <p className="text-ink-2">{message.title}</p>
        <p className="text-ink-3 text-sm mt-2">{message.body}</p>
      </div>
    );
  }

  const loading = users.a.status !== "ready" || users.b.status !== "ready";
  let winsA = 0;
  let winsB = 0;
  let scored = 0;
  for (const key of PHENOMENON_KEYS) {
    const ra = users.a.reports[key];
    const rb = users.b.reports[key];
    // Only a round both sides were tested in can be won.
    if (!tested(ra) || !tested(rb)) continue;
    scored++;
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
            {/* A draw needs rounds to draw: with none scored it isn't one. */}
            {scored === 0
              ? "No round could be scored yet: there isn't enough to test on one side or both."
              : winsA === winsB
                ? scored === PHENOMENON_KEYS.length
                  ? "A perfect stalemate. The sky refuses to pick a favorite."
                  : `A stalemate over the ${scored} ${scored === 1 ? "round" : "rounds"} that could be scored.`
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
          percentage. A score only counts when our scramble test says it&rsquo;s unlikely to
          be chance; <span className="text-ink-2">coincidences score zero</span>, and a round
          one side has too little listening for isn&rsquo;t scored.
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
          const scoredRound = tested(ra) && tested(rb);
          // A missing report is a failed load, or one still on its way.
          const rowStory = !ra || !rb
            ? loading
              ? ""
              : "Not scored: this round didn't load."
            : !scoredRound
              ? `Not scored: ${[
                  !tested(ra) && duelUnscoredReason(a, ra, ph.eventNoun.many),
                  !tested(rb) && duelUnscoredReason(b, rb, ph.eventNoun.many),
                ]
                  .filter(Boolean)
                  .join(", and ")}.`
              : tie
            ? sa === 0
              ? `Neither of you moves with ${ph.eventNoun.many} by more than chance. The sky shrugs.`
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
                  // No number for an untested side: 0 would read as a result.
                  score: tested(ra) ? sa : undefined,
                  isWinner: scoredRound && !tie && sa > sb,
                  accessory: duelSideLabel(ra),
                }}
                homeTeam={{
                  id: b,
                  logoSrc: users.b.avatar,
                  name: b,
                  score: tested(rb) ? sb : undefined,
                  isWinner: scoredRound && !tie && sb > sa,
                  accessory: duelSideLabel(rb),
                }}
                /* Only a scored round is "completed": otherwise the card greys
                   out both sides as losers and shows a tested side's 0. */
                isCompleted={scoredRound}
                isTie={scoredRound && tie}
              />
              <p className="text-ink-3 text-xs mt-1.5 text-center">{rowStory}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
