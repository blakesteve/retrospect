"use client";

import { useRef, useState } from "react";
import { Button, Spinner } from "@blakesteve/roster";
import type { Report } from "@/lib/report";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS, type MetricKey } from "@/lib/analysis/metrics";
import { gripLevel } from "./GripMeter";
import { sweepNoHitsSentence } from "@/lib/readiness";
import { readTrial, sweepCategory } from "@/lib/likelihood";

interface Hit {
  body: PhenomenonKey;
  metric: MetricKey;
  index: number;
  detail: string;
  /** true = survived the scramble test; false = a big-but-unconfirmed lead. */
  confirmed: boolean;
}

/**
 * The full sweep: every sky × every measure, 25 trials, surfacing the
 * convictions and the leads. Each trial is served (and cached)
 * by the normal report endpoint, so tapping a result is instant.
 */
export function SkyScan({
  username,
  excludeNoise,
  onPick,
}: {
  username: string;
  excludeNoise: boolean;
  onPick: (body: PhenomenonKey, metric: MetricKey) => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ i: number; label: string } | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  /* How many trials were actually tested, and how many are waiting on more
     history (warming up, or too few plays or events for a verdict). A young
     history skips most of them, and the summary must not call a skipped
     trial "clean" or blame a failed one on history length. */
  const [counts, setCounts] = useState({ judged: 0, waiting: 0 });
  const cancelled = useRef(false);

  const TOTAL = PHENOMENON_KEYS.length * Object.keys(METRICS).length;

  const run = async () => {
    setRunning(true);
    setHits(null);
    cancelled.current = false;
    const found: Hit[] = [];
    let judgedCount = 0;
    let waitingCount = 0;
    const tzm = String(-new Date().getTimezoneOffset());
    let i = 0;
    for (const body of PHENOMENON_KEYS) {
      for (const metricKey of Object.keys(METRICS) as MetricKey[]) {
        if (cancelled.current) return;
        i++;
        setProgress({
          i,
          label: `${PHENOMENA[body].glyph} ${PHENOMENA[body].title} × ${METRICS[metricKey].name.replace(" Index", "")}`,
        });
        try {
          const params = new URLSearchParams({
            threshold: String(METRICS[metricKey].slider?.default ?? 365),
            level: "track",
            body,
            metric: metricKey,
            tzm,
          });
          if (excludeNoise) params.set("noise", "exclude");
          const res = await fetch(`/api/user/${encodeURIComponent(username)}/report?${params}`);
          if (!res.ok) continue;
          const report: Report = await res.json();
          /* The same tiers the report's own hero uses. An untested trial is
             never a lead or a conviction: it used to be read off the index
             and p alone, so a withheld trial with no plays of its kind inside
             the windows surfaced as "-100% · a lead". */
          const category = sweepCategory(report);
          if (category === "waiting") waitingCount++;
          if (category === "waiting" || category === "untested") continue;
          judgedCount++;
          const confirmed = category === "conviction";
          if (confirmed || category === "lead") {
            found.push({
              body,
              metric: metricKey,
              index: report.index,
              // The chip's tooltip reads as the trial's own page does.
              detail: (() => {
                const { sub, likelihood } = readTrial(report);
                return likelihood ? `${sub} ${likelihood.label}` : sub;
              })(),
              confirmed,
            });
            setHits([...found].sort(byStrength));
          }
        } catch {
          // one failed trial shouldn't sink the sweep
        }
      }
    }
    setHits([...found].sort(byStrength));
    setCounts({ judged: judgedCount, waiting: waitingCount });
    setRunning(false);
    setProgress(null);
  };

  return (
    <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md">
          <h3 className="text-ink text-sm font-medium mb-1">
            🔭 Where does the sky actually get you?
          </h3>
          <p className="text-ink-3 text-xs leading-relaxed">
            Run every sky against every measure, {TOTAL} trials, and surface the
            convictions and the leads. No more guessing which combination to try.
          </p>
        </div>
        {!running && (
          <Button colorScheme="primary" variant={hits ? "outline" : "solid"} size="sm" onClick={run}>
            {hits ? "Re-run the sweep" : `Run all ${TOTAL} trials`}
          </Button>
        )}
      </div>

      {running && progress && (
        <div className="mt-4 flex items-center gap-3 text-xs text-ink-2">
          <Spinner variant="primary" size="sm" />
          <span className="tabular">
            trial {progress.i}/{TOTAL}
          </span>
          <span className="text-ink-3">{progress.label}</span>
        </div>
      )}

      {hits && hits.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {hits.map((h) => {
            const grip = gripLevel(h.index, h.confirmed, !h.confirmed);
            return (
              <li key={`${h.body}-${h.metric}`}>
                {/* Same call as GenresPanel: the chip is the layout, Roster
                    supplies the focus ring and the disabled semantics. */}
                <Button
                  variant="ghost"
                  onClick={() => onPick(h.body, h.metric)}
                  title={h.detail}
                  /* `flex-col items-start` and `whitespace-normal` because
                     Roster's Button base is `inline-flex items-center
                     justify-center whitespace-nowrap`: without them the chip's
                     two block spans become flex items side by side on one
                     unwrappable line instead of stacking. */
                  className={`flex h-auto flex-col items-start justify-start whitespace-normal rounded-lg border bg-surface-2 px-3 py-2 text-left text-xs transition-colors ${
                    h.confirmed
                      ? "border-gold/50 hover:border-gold"
                      : "border-[var(--hairline)] hover:border-[var(--accent-mark)]"
                  }`}
                >
                  <span className="block text-ink">
                    {PHENOMENA[h.body].glyph} {PHENOMENA[h.body].title} ×{" "}
                    {METRICS[h.metric].name.replace(" Index", "")}
                  </span>
                  <span
                    className="block mt-0.5"
                    style={{ color: h.confirmed ? "var(--gold)" : "var(--accent-mark)" }}
                  >
                    {h.index > 1 ? "+" : ""}
                    {Math.round((h.index - 1) * 100)}% ·{" "}
                    {h.confirmed ? `${grip.label.toLowerCase()} ✦` : "a lead 🔍"}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {hits && hits.length > 0 && (
        <p className="text-ink-3 text-xs mt-2">
          {/* What a lead is, not what to do with it: "chase it in a narrower era"
              was advice to keep slicing until chance produced a conviction. */}
          Tap to open a trial above. ✦ = passed the scramble test, judged on its own ·
          🔍 = a lead: a big swing that chance could still have produced, so a maybe,
          not an answer.
        </p>
      )}

      {hits && hits.length === 0 && !running && (
        <p className="text-ink-2 text-sm mt-4">{sweepNoHitsSentence({ ...counts, total: TOTAL })}</p>
      )}
    </div>
  );
}

const byStrength = (a: Hit, b: Hit) =>
  Math.abs(Math.log(b.index)) - Math.abs(Math.log(a.index));
