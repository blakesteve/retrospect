"use client";

import { useId, useRef } from "react";
import type { AnswerWord } from "@/lib/answers/words";
import { useSeen } from "./media";

/* The jar and the answer words' colors (spec 8.9), on their own so the
   landing's tiles can draw a jar without the rest of the pieces. */

export const WORD_COLOR: Record<AnswerWord, string> = {
  Yes: "var(--word-yes)",
  Maybe: "var(--word-maybe)",
  "Not clearly": "var(--word-notclearly)",
  No: "var(--word-no)",
  "Too early": "var(--word-early)",
  "Not checked": "var(--word-quiet)",
  Checking: "var(--word-quiet)",
};

const JAR = "M12 22C12 16.5 16 13 22 13H38C44 13 48 16.5 48 22V64C48 70 44 74 38 74H22C16 74 12 70 12 64Z";

/** The jar: fills by events (or plays) toward the floor, "1 of the 6".
    `fills`: a Too early jar in a question sheet fills once, from empty to
    its level over 600ms, the first time it's on screen (8.11 item 6). */
export function Jar({ fill, color, width = 34, fills = false }: { fill: number; color: string; width?: number; fills?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const seen = useSeen(ref, fills);
  const ff = Math.max(0, Math.min(1, fill));
  const level = 72 - ff * 56;
  return (
    <svg ref={ref} viewBox="0 0 60 76" width={width} height={Math.round((width * 76) / 60)} aria-hidden className="shrink-0">
      <defs>
        <clipPath id={`${uid}j`}>
          <path d={JAR} />
        </clipPath>
      </defs>
      <rect x="18" y="1.5" width="24" height="6.5" rx="2.2" fill="rgba(212,175,55,.55)" />
      <rect x="21" y="7.5" width="18" height="6" rx="1.5" fill="rgba(242,239,230,.12)" />
      {ff > 0 && (
        <g clipPath={`url(#${uid}j)`}>
          {/* Its foot at the jar's bottom, so it grows from there. */}
          <rect
            x="0"
            y={level.toFixed(1)}
            width="60"
            height={(76 - level).toFixed(1)}
            fill={color}
            opacity={0.85}
            className={fills ? "jar-fill" : undefined}
            {...(fills && seen ? { "data-run": "" } : {})}
          />
        </g>
      )}
      <path d={JAR} fill="rgba(242,239,230,.04)" stroke="rgba(242,239,230,.45)" strokeWidth={1.4} />
      <path d="M17.5 27v28" stroke="rgba(242,239,230,.18)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
