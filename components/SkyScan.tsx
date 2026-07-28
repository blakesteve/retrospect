"use client";

import { useRef, useState } from "react";
import { Button, Spinner } from "@blakesteve/roster";
import type { Report } from "@/lib/report";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS, type MetricKey } from "@/lib/analysis/metrics";
import { gripLevel } from "./GripMeter";

interface Hit {
  body: PhenomenonKey;
  metric: MetricKey;
  index: number;
  detail: string;
  /** true = survived the scramble test; false = a big-but-unconfirmed lead. */
  confirmed: boolean;
}

/**
 * The full sweep: every sky × every measure, 25 trials, surfacing only the
 * verdicts that survive the scramble test. Each trial is served (and cached)
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
  const cancelled = useRef(false);

  const TOTAL = PHENOMENON_KEYS.length * Object.keys(METRICS).length;

  const run = async () => {
    setRunning(true);
    setHits(null);
    cancelled.current = false;
    const found: Hit[] = [];
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
          if (!Number.isFinite(report.index)) continue;
          const pct = Math.abs(report.index - 1) * 100;
          const confirmed = report.verdict.significant;
          const lead = !confirmed && pct >= 10 && report.p < 0.35;
          if (confirmed || lead) {
            found.push({
              body,
              metric: metricKey,
              index: report.index,
              detail: report.verdict.detail,
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
            Run every sky against every measure, {TOTAL} trials, and surface only the
            verdicts that survive the scramble test. No more guessing which combination
            to try.
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
                <button
                  onClick={() => onPick(h.body, h.metric)}
                  title={h.detail}
                  className={`rounded-lg border bg-surface-2 px-3 py-2 text-left text-xs transition-colors ${
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
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hits && hits.length > 0 && (
        <p className="text-ink-3 text-xs mt-2">
          Tap to open a trial above. ✦ = survived the scramble test · 🔍 = big lean chance
          could still fake, worth chasing in a narrower era.
        </p>
      )}

      {hits && hits.length === 0 && !running && (
        <p className="text-ink-2 text-sm mt-4">
          All {TOTAL} trials came back clean, not even a lead. The sky has absolutely no
          hold on you; you may be the most ungovernable listener we&rsquo;ve ever scanned.
          Honestly? Iconic.
        </p>
      )}
    </div>
  );
}

const byStrength = (a: Hit, b: Hit) =>
  Math.abs(Math.log(b.index)) - Math.abs(Math.log(a.index));
