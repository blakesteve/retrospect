"use client";

import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { BODY_ORDER, C, R0, R1, RA, RP, VB, glyphAngles, glyphSize } from "@/lib/motion/wheelLayout";
import type { Dignity, Planet } from "./api";
import { moonLit, phaseName } from "@/lib/client/moon";

/* The sky wheel and the Moon (spec 8.9). Drawn from the numbers the sky
   routes send; nothing here knows any sky data. Glyphs carry U+FE0E so they
   never render as emoji, and are aria-hidden beside text (11). */

const VS = "︎";
export const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const PLANET_GLYPHS: Record<string, string> = {
  Sun: "☉",
  Moon: "☽",
  Mercury: "☿",
  Venus: "♀",
  Mars: "♂",
  Jupiter: "♃",
  Saturn: "♄",
};
export { BODY_ORDER };

export const signGlyph = (sign: string) => `${SIGN_GLYPHS[SIGNS.indexOf(sign)] ?? ""}${VS}`;
export const planetGlyph = (body: string) => `${PLANET_GLYPHS[body] ?? ""}${VS}`;

export const DIGNITY_COLOR: Record<Dignity, string | null> = {
  home: "var(--home)",
  exalted: "var(--exalt)",
  detriment: "var(--detr)",
  fall: "var(--fall)",
  neutral: null,
};

/** 0° Aries at 9 o'clock, the zodiac running counterclockwise, as a chart
    is drawn. */
const at = (lon: number, r: number): [number, number] => {
  const a = (lon * Math.PI) / 180;
  return [C - r * Math.cos(a), C + r * Math.sin(a)];
};
const f = (n: number) => n.toFixed(2);

export interface SkyWheelProps {
  bodies: Planet[];
  /** Rendered width in CSS pixels; the hit areas stay 44px at any size. A
      `className` size may override it (Tonight's 280px under 400px wide). */
  size: number;
  /** Tappable planets (Tonight, a song's sky); small wheels on cards are not. */
  onPlanet?: (body: string) => void;
  aspects?: { a: string; b: string; name: string }[];
  className?: string;
  /** Bodies kept lit while the others dim to 40% (8.11 item 2). */
  highlight?: readonly string[] | null;
  /** Bodies that pulse `times` times; a new `key` starts it again (8.11). */
  pulse?: { bodies: readonly string[]; times: number; key: string; delayMs?: number; onEnd?: () => void } | null;
  /** The planets arrive: from 30% and transparent, 60ms apart (8.11 item 4). */
  arrive?: boolean;
  /** Traveling (8.11 item 1): the planets move by transform alone, so the
      lines from a nudged glyph to its true longitude wait for the end. */
  moving?: boolean;
  /** Each glyph's angle while traveling, blended by the trip; otherwise laid out here. */
  glyphs?: Record<string, number> | null;
  /** The arrival has finished (its last planet's animation ended). */
  onArrived?: () => void;
}

export function SkyWheel({
  bodies,
  size,
  onPlanet,
  aspects = [],
  className = "",
  highlight = null,
  pulse = null,
  arrive = false,
  moving = false,
  glyphs = null,
  onArrived,
}: SkyWheelProps) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const interactive = Boolean(onPlanet);
  const scale = size / VB;
  const hitR = 22 / scale + 0.5;

  // Always in BODY_ORDER, so a planet's node never moves in the DOM (which
  // would restart its arrival) when it passes another.
  const placed = useMemo(() => {
    const angles = glyphs ?? glyphAngles(bodies);
    return BODY_ORDER.flatMap((body) => {
      const p = bodies.find((b) => b.body === body);
      return p ? [{ body, lon: p.longitude, a: angles[body] ?? p.longitude, sz: glyphSize(body) }] : [];
    });
  }, [bodies, glyphs]);

  // Angular order for the arrow keys: by true longitude.
  const angular = useMemo(() => [...placed].sort((x, y) => x.lon - y.lon).map((p) => p.body), [placed]);
  const [focusBody, setFocusBody] = useState<string | null>(null);
  const tabStop = focusBody ?? angular[0];

  const byBody = new Map(bodies.map((b) => [b.body, b]));

  const nearest = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best: { body: string; d: number } | null = null;
    for (const p of placed) {
      const [x, y] = at(p.a, RP);
      const d = Math.hypot(pt.x - x, pt.y - y);
      if (d <= hitR && (!best || d < best.d)) best = { body: p.body, d };
    }
    return best?.body ?? null;
  };

  const onKey = (e: KeyboardEvent<SVGGElement>, body: string) => {
    const i = angular.indexOf(body);
    let next: string | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = angular[(i + 1) % angular.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = angular[(i - 1 + angular.length) % angular.length];
    else if (e.key === "Home") next = angular[0];
    else if (e.key === "End") next = angular[angular.length - 1];
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPlanet?.(body);
      return;
    }
    if (next) {
      e.preventDefault();
      setFocusBody(next);
      svgRef.current?.querySelector<SVGGElement>(`[data-body="${next}"]`)?.focus();
    }
  };

  const fs = (R0 - R1) * 0.6;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      className={`block select-none ${className}`}
      {...(interactive ? { role: "group", "aria-label": "Sky wheel" } : { "aria-hidden": true })}
      onPointerUp={
        interactive
          ? (e) => {
              const body = nearest(e);
              if (!body) return;
              // Focus the planet first, so a sheet it opens returns focus to it (11).
              svgRef.current?.querySelector<SVGGElement>(`[data-body="${body}"]`)?.focus({ preventScroll: true });
              onPlanet?.(body);
            }
          : undefined
      }
      style={interactive ? { touchAction: "manipulation", cursor: "pointer" } : undefined}
    >
      <defs>
        <radialGradient id={`${uid}bg`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#1c2456" />
          <stop offset=".78" stopColor="#11163c" />
          <stop offset="1" stopColor="#0c1130" />
        </radialGradient>
        <filter id={`${uid}bl`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation={(VB / 95).toFixed(1)} />
        </filter>
      </defs>
      <circle cx={C} cy={C} r={R0} fill={`url(#${uid}bg)`} stroke="rgba(212,175,55,.45)" strokeWidth={1} />
      {SIGNS.map((sign, i) => {
        const a0 = i * 30;
        const a1 = a0 + 30;
        const [x0, y0] = at(a0, R0);
        const [x1, y1] = at(a1, R0);
        const [x2, y2] = at(a1, R1);
        const [x3, y3] = at(a0, R1);
        const [gx, gy] = at(a0 + 15, (R0 + R1) / 2);
        return (
          <g key={sign}>
            <path
              d={`M${f(x0)} ${f(y0)}A${R0} ${R0} 0 0 0 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${R1} ${R1} 0 0 1 ${f(x3)} ${f(y3)}Z`}
              fill={i % 2 ? "rgba(212,175,55,.1)" : "rgba(212,175,55,.05)"}
              stroke="rgba(212,175,55,.22)"
              strokeWidth={0.6}
            />
            <text
              x={f(gx)}
              y={f(gy)}
              fontSize={fs.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgba(222,190,90,.85)"
              className="font-glyph"
              aria-hidden
            >
              {signGlyph(sign)}
            </text>
          </g>
        );
      })}
      {Array.from({ length: 36 }, (_, k) => {
        const d = k * 10;
        const [x1, y1] = at(d, R1);
        const [x2, y2] = at(d, R1 - (d % 30 ? 2.5 : 5));
        return <line key={d} x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} stroke="rgba(212,175,55,.35)" strokeWidth={0.6} />;
      })}
      <circle cx={C} cy={C} r={R1} fill="none" stroke="rgba(212,175,55,.3)" strokeWidth={0.8} />
      <circle cx={C} cy={C} r={RA} fill="none" stroke="rgba(242,239,230,.08)" strokeWidth={0.8} strokeDasharray="2 4" />
      {aspects.map((a) => {
        const pa = byBody.get(a.a);
        const pb = byBody.get(a.b);
        if (!pa || !pb || a.name === "conjunction") return null;
        const [x1, y1] = at(pa.longitude, RA);
        const [x2, y2] = at(pb.longitude, RA);
        const easy = a.name === "trine" || a.name === "sextile";
        return (
          <line
            key={`${a.a}-${a.b}`}
            x1={f(x1)}
            y1={f(y1)}
            x2={f(x2)}
            y2={f(y2)}
            stroke={easy ? "var(--exalt)" : "var(--detr)"}
            strokeWidth={1.2}
            opacity={0.7}
          />
        );
      })}
      {placed.map((p, index) => {
        const planet = byBody.get(p.body)!;
        const r = p.sz;
        const [gx, gy] = at(p.a, RP);
        const moved = Math.abs(((p.a - p.lon + 540) % 360) - 180) > 1.5;
        const [lx, ly] = at(p.lon, R1 - 7);
        const color = DIGNITY_COLOR[planet.dignity];
        const [rx, ry] = at(p.a, RP - r * 0.95);
        const focusable = interactive;
        const dim = highlight !== null && highlight.length > 0 && !highlight.includes(p.body);
        const pulsing = pulse !== null && pulse.bodies.includes(p.body);
        return (
          <g
            key={p.body}
            data-body={p.body}
            style={{ opacity: dim ? 0.4 : 1 }}
            className={`motion-safe:transition-opacity motion-safe:duration-200 ${focusable ? "outline-none [&:focus-visible_.pl-sel]:opacity-100" : ""}`}
            {...(focusable
              ? {
                  role: "button",
                  tabIndex: tabStop === p.body ? 0 : -1,
                  "aria-label": planet.name ?? `${p.body} in ${planet.sign}, ${planet.dignityPhrase}`,
                  onKeyDown: (e: KeyboardEvent<SVGGElement>) => onKey(e, p.body),
                  onFocus: () => setFocusBody(p.body),
                }
              : {})}
          >
            {/* The tick at the true longitude, turned into place. */}
            <line x1={f(C - R1)} y1={C} x2={f(C - R1 + 7)} y2={C} transform={`rotate(${f(-p.lon)} ${C} ${C})`} stroke="rgba(242,239,230,.6)" strokeWidth={1.6} />
            {moved && !moving && <line x1={f(lx)} y1={f(ly)} x2={f(gx)} y2={f(gy)} stroke="rgba(242,239,230,.3)" strokeWidth={0.7} />}
            <g transform={`translate(${f(gx)} ${f(gy)})`}>
              <g
                className={arrive ? "pl-arrive" : undefined}
                style={arrive ? ({ "--i": index } as CSSProperties) : undefined}
                onAnimationEnd={arrive && index === placed.length - 1 ? (e) => e.animationName === "pl-in" && onArrived?.() : undefined}
              >
                <g
                  key={pulsing ? pulse!.key : "still"}
                  className={pulsing ? "pl-pulse" : undefined}
                  style={pulsing ? ({ "--pulse-n": pulse!.times, "--pulse-delay": `${pulse!.delayMs ?? 0}ms` } as CSSProperties) : undefined}
                  onAnimationEnd={pulsing ? () => pulse!.onEnd?.() : undefined}
                >
                  {color ? (
                    <>
                      <circle r={(r * 0.74).toFixed(1)} fill={color} opacity={0.5} filter={`url(#${uid}bl)`} />
                      <circle r={(r * 0.62).toFixed(1)} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.2} />
                    </>
                  ) : (
                    <circle r={(r * 0.56).toFixed(1)} fill="rgba(242,239,230,.04)" stroke="rgba(242,239,230,.2)" strokeWidth={0.8} />
                  )}
                  {focusable && (
                    <>
                      {/* Two-tone focus ring (11): sky inside gold. */}
                      <circle className="pl-sel" r={(r * 0.86).toFixed(1)} fill="none" stroke="var(--sky)" strokeWidth={5} opacity={0} />
                      <circle className="pl-sel" r={(r * 0.86 + 2.5).toFixed(1)} fill="none" stroke="var(--gold)" strokeWidth={2.2} opacity={0} />
                    </>
                  )}
                  <text fontSize={r.toFixed(1)} textAnchor="middle" dominantBaseline="central" fill="var(--text-primary)" className="font-glyph" aria-hidden>
                    {planetGlyph(p.body)}
                  </text>
                  {planet.retrograde && (
                    <text x={f(rx - gx)} y={f(ry - gy)} fontSize={(r * 0.42).toFixed(1)} textAnchor="middle" dominantBaseline="central" fill="var(--text-secondary)" aria-hidden>
                      {"℞"}
                    </text>
                  )}
                </g>
              </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

const KEY: { dignity: Dignity; word: string }[] = [
  { dignity: "home", word: "At home" },
  { dignity: "exalted", word: "Exalted" },
  { dignity: "detriment", word: "In detriment" },
  { dignity: "fall", word: "In fall" },
];

/**
 * The line under a wheel whose planets open something (8.9): "Tap any
 * planet." and a key for the halo colors on that wheel right now, and only
 * those, each a dot with its word.
 */
export function WheelKey({ bodies, className = "" }: { bodies: Planet[]; className?: string }) {
  const shown = KEY.filter((k) => bodies.some((b) => b.dignity === k.dignity));
  return (
    <p className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-ink-2 ${className}`}>
      <span className="text-ink">Tap any planet.</span>
      {shown.map((k) => (
        <span key={k.dignity} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: DIGNITY_COLOR[k.dignity] ?? undefined }} />
          {k.word}
        </span>
      ))}
    </p>
  );
}

/** A name for a phase angle (`lib/client/moon.ts`), kept here for the sheets that import it. */
export { phaseName };

/**
 * The Moon, drawn from the phase angle (0 new, 180 full), lit on the right
 * while waxing, never an emoji. Beside text it's aria-hidden; alone it's an
 * image named by `label` (11).
 */
export function MoonDrawing({ phaseAngle, size = 40, label }: { phaseAngle: number; size?: number; label?: string }) {
  const uid = useId().replace(/:/g, "");
  const r = 20;
  const c = 22;
  const lit = moonLit(phaseAngle, c, r);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      className="shrink-0"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <defs>
        <radialGradient id={`${uid}m`} cx="40%" cy="38%" r="70%">
          <stop offset="0" stopColor="#fbf7ea" />
          <stop offset="1" stopColor="#cfc8b0" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={r} fill="#1e2448" stroke="rgba(242,239,230,.25)" strokeWidth={0.8} />
      {lit === "full" ? <circle cx={c} cy={c} r={r} fill={`url(#${uid}m)`} /> : lit !== "none" ? <path d={lit} fill={`url(#${uid}m)`} /> : null}
    </svg>
  );
}
