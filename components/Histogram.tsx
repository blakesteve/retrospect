"use client";

import { useMemo, useState } from "react";

/**
 * Null-distribution histogram for the skeptic panel. Single series (indigo)
 * with the observed index as an ochre reference line — identity is carried by
 * the direct labels, not color alone.
 */
export function Histogram({ samples, observed }: { samples: number[]; observed: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const obs = Number.isFinite(observed) ? (observed as number) : NaN;

  const { bins, lo, hi, maxCount } = useMemo(() => {
    if (samples.length === 0) return { bins: [] as number[], lo: 0, hi: 1, maxCount: 0 };
    const values = [...samples, obs].filter((v) => Number.isFinite(v));
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = (hi - lo) * 0.08 || 0.05;
    lo -= pad;
    hi += pad;
    const BINS = 36;
    const bins = new Array<number>(BINS).fill(0);
    for (const v of samples) {
      const i = Math.min(BINS - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * BINS)));
      bins[i]++;
    }
    return { bins, lo, hi, maxCount: Math.max(...bins) };
  }, [samples, obs]);

  if (bins.length === 0) {
    return <p className="text-ink-3 text-sm">Not enough data for a null distribution.</p>;
  }

  const W = 640;
  const H = 180;
  const PAD_BOTTOM = 22;
  const plotH = H - PAD_BOTTOM;
  const binW = W / bins.length;
  const x = (v: number) => ((v - lo) / (hi - lo)) * W;
  const obsX = Number.isFinite(obs) ? Math.max(4, Math.min(W - 4, x(obs))) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Histogram of ${samples.length} null-distribution index values${Number.isFinite(obs) ? `; observed value ${obs.toFixed(2)}` : ""}`}
      onMouseLeave={() => setHover(null)}
    >
      {/* baseline */}
      <line x1={0} y1={plotH} x2={W} y2={plotH} stroke="var(--hairline)" strokeWidth={1} />

      {bins.map((count, i) => {
        const h = maxCount ? (count / maxCount) * (plotH - 12) : 0;
        return (
          <g key={i}>
            {/* visible bar: 2px gaps, rounded data-end anchored to baseline */}
            {count > 0 && (
              <path
                d={roundedTopBar(i * binW + 1, plotH - h, binW - 2, h, 3)}
                fill="var(--series-1)"
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            )}
            {/* hit target wider than the mark */}
            <rect
              x={i * binW}
              y={0}
              width={binW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          </g>
        );
      })}

      {/* observed value: ochre reference line + direct label */}
      {obsX !== null && (
        <>
          <line
            x1={obsX}
            y1={6}
            x2={obsX}
            y2={plotH}
            stroke="var(--accent-mark)"
            strokeWidth={2}
            strokeDasharray="1 0"
          />
          <text
            x={obsX + (obsX > W - 90 ? -6 : 6)}
            y={16}
            textAnchor={obsX > W - 90 ? "end" : "start"}
            className="tabular"
            fill="var(--text-primary)"
            fontSize={12}
          >
            you: {obs.toFixed(2)}&times;
          </text>
        </>
      )}

      {/* hover tooltip */}
      {hover !== null && bins[hover] > 0 && (
        <TooltipBox
          x={hover * binW + binW / 2}
          w={W}
          lines={[
            `${(lo + ((hover + 0.5) / bins.length) * (hi - lo)).toFixed(2)}× index`,
            `${bins[hover]} of ${samples.length} rotations`,
          ]}
        />
      )}

      {/* x axis labels */}
      <text x={2} y={H - 6} fill="var(--text-muted)" fontSize={11} className="tabular">
        {lo.toFixed(2)}&times;
      </text>
      <text x={x(1)} y={H - 6} fill="var(--text-muted)" fontSize={11} textAnchor="middle" className="tabular">
        1.00&times;
      </text>
      <text x={W - 2} y={H - 6} fill="var(--text-muted)" fontSize={11} textAnchor="end" className="tabular">
        {hi.toFixed(2)}&times;
      </text>
    </svg>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

export function TooltipBox({ x, w, lines }: { x: number; w: number; lines: string[] }) {
  const boxW = Math.max(...lines.map((l) => l.length)) * 6.4 + 16;
  const left = Math.max(4, Math.min(w - boxW - 4, x - boxW / 2));
  return (
    <g pointerEvents="none">
      <rect x={left} y={26} width={boxW} height={lines.length * 16 + 12} rx={5} fill="var(--surface-2)" stroke="var(--hairline)" />
      {lines.map((l, i) => (
        <text key={i} x={left + 8} y={44 + i * 16} fontSize={11} fill={i === 0 ? "var(--text-primary)" : "var(--text-secondary)"} className="tabular">
          {l}
        </text>
      ))}
    </g>
  );
}
