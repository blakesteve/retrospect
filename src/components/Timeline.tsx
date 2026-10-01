"use client";

import { useState } from "react";
import { TooltipBox } from "./Histogram";

interface Props {
  yearly: { year: number; count: number }[];
  windows: { start: string; end: string }[];
  firstUts: number;
  lastUts: number;
}

/**
 * Listening volume per year (indigo bars) over the retrograde calendar
 * (ochre bands). Bands sit behind the bars; both are labeled in the caption,
 * so neither identity rides on color alone.
 */
export function Timeline({ yearly, windows, firstUts, lastUts }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (yearly.length === 0) return null;

  const W = 640;
  const H = 150;
  const PAD_BOTTOM = 20;
  const plotH = H - PAD_BOTTOM;
  const t0 = firstUts;
  const t1 = lastUts;
  const x = (uts: number) => ((uts - t0) / (t1 - t0)) * W;
  const maxCount = Math.max(...yearly.map((y) => y.count));

  const yearStart = (year: number) => Date.UTC(year, 0, 1) / 1000;
  const yearEnd = (year: number) => Date.UTC(year + 1, 0, 1) / 1000;

  const visibleWindows = windows.filter(
    (w) => Date.parse(w.end) / 1000 > t0 && Date.parse(w.start) / 1000 < t1
  );

  const labelEvery = Math.ceil(yearly.length / 8);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Scrobbles per year with Mercury retrograde periods shaded"
      onMouseLeave={() => setHover(null)}
    >
      {/* baseline */}
      <line x1={0} y1={plotH} x2={W} y2={plotH} stroke="var(--hairline)" strokeWidth={1} />

      {/* yearly bars */}
      {yearly.map(({ year, count }, i) => {
        const a = Math.max(0, x(Math.max(yearStart(year), t0)));
        const b = Math.min(W, x(Math.min(yearEnd(year), t1)));
        const w = Math.max(2, b - a - 2);
        const h = (count / maxCount) * (plotH - 14);
        return (
          <g key={year}>
            <rect
              x={a + 1}
              y={plotH - h}
              width={w}
              height={h}
              rx={3}
              fill="var(--series-1)"
              opacity={hover === null || hover === i ? 0.9 : 0.4}
            />
            <rect
              x={a}
              y={0}
              width={b - a}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {i % labelEvery === 0 && (
              <text
                x={(a + b) / 2}
                y={H - 5}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-muted)"
                className="tabular"
              >
                {year}
              </text>
            )}
          </g>
        );
      })}

      {/* retrograde bands wash over the bars so they stay visible */}
      {visibleWindows.map((w, i) => {
        const a = Math.max(0, x(Date.parse(w.start) / 1000));
        const b = Math.min(W, x(Date.parse(w.end) / 1000));
        return (
          <rect
            key={i}
            x={a}
            y={0}
            width={Math.max(1.5, b - a)}
            height={plotH}
            fill="var(--accent-mark)"
            opacity={0.28}
            pointerEvents="none"
          />
        );
      })}

      {hover !== null && (
        <TooltipBox
          x={x((yearStart(yearly[hover].year) + yearEnd(yearly[hover].year)) / 2)}
          w={W}
          lines={[
            `${yearly[hover].year}`,
            `${yearly[hover].count.toLocaleString()} scrobbles`,
          ]}
        />
      )}
    </svg>
  );
}
