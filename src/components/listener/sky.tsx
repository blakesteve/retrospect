"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Dignity, Planet } from "./api";

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
export const BODY_ORDER = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

export const signGlyph = (sign: string) => `${SIGN_GLYPHS[SIGNS.indexOf(sign)] ?? ""}${VS}`;
export const planetGlyph = (body: string) => `${PLANET_GLYPHS[body] ?? ""}${VS}`;

export const DIGNITY_COLOR: Record<Dignity, string | null> = {
  home: "var(--home)",
  exalted: "var(--exalt)",
  detriment: "var(--detr)",
  fall: "var(--fall)",
  neutral: null,
};

interface Placed {
  body: string;
  lon: number;
  a: number;
  sz: number;
}

/** Push glyphs that would overlap apart along the circle, symmetrically, so
    every planet stays readable; each keeps a tick at its true longitude. */
function relax(items: Placed[], rp: number) {
  const sep = (a: Placed, b: Placed) => (((a.sz + b.sz) / 2) * 1.28 * 180) / (rp * Math.PI);
  for (let it = 0; it < 90 && items.length > 1; it++) {
    items.sort((x, y) => x.a - y.a);
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      const A = items[i];
      const B = items[(i + 1) % items.length];
      let d = B.a - A.a;
      if (i === items.length - 1) d += 360;
      const need = sep(A, B);
      if (d < need) {
        const push = (need - d) / 2 + 0.05;
        A.a -= push;
        B.a += push;
        moved = true;
      }
    }
    for (const x of items) x.a = ((x.a % 360) + 360) % 360;
    if (!moved) break;
  }
}

const VB = 320;
const C = VB / 2;
const R0 = C - 3;
const R1 = R0 * 0.8;
const RP = R0 * 0.6;
const RA = R0 * 0.36;

/** 0° Aries at 9 o'clock, the zodiac running counterclockwise, as a chart
    is drawn. */
const at = (lon: number, r: number): [number, number] => {
  const a = (lon * Math.PI) / 180;
  return [C - r * Math.cos(a), C + r * Math.sin(a)];
};
const f = (n: number) => n.toFixed(2);

export interface SkyWheelProps {
  bodies: Planet[];
  /** Rendered width in CSS pixels; the hit areas stay 44px at any size. */
  size: number;
  /** Tappable planets (Tonight, a song's sky); small wheels on cards are not. */
  onPlanet?: (body: string) => void;
  aspects?: { a: string; b: string; name: string }[];
  className?: string;
}

/**
 * The sky wheel: 12 sectors with their glyphs, each planet at its real
 * longitude with a halo colored by dignity (home over exalted, fall over
 * detriment, decided by the server). Interactive wheels are a group named
 * "Sky wheel" whose planets are buttons with roving tabindex, arrow keys
 * moving in angular order (11); a tap goes to the nearest planet within
 * 22 CSS pixels, so neighboring hit areas never fight.
 */
export function SkyWheel({ bodies, size, onPlanet, aspects = [], className = "" }: SkyWheelProps) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const interactive = Boolean(onPlanet);
  const scale = size / VB;
  const hitR = 22 / scale + 0.5;

  const placed = useMemo(() => {
    const gs = VB * 0.074;
    const items: Placed[] = BODY_ORDER.flatMap((body) => {
      const p = bodies.find((b) => b.body === body);
      return p ? [{ body, lon: p.longitude, a: p.longitude, sz: body === "Sun" || body === "Moon" ? gs * 1.32 : gs }] : [];
    });
    relax(items, RP);
    return items;
  }, [bodies]);

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
      {placed.map((p) => {
        const planet = byBody.get(p.body)!;
        const r = p.sz;
        const [gx, gy] = at(p.a, RP);
        const [tx1, ty1] = at(p.lon, R1);
        const [tx2, ty2] = at(p.lon, R1 - 7);
        const moved = Math.abs(((p.a - p.lon + 540) % 360) - 180) > 1.5;
        const [lx, ly] = at(p.lon, R1 - 7);
        const color = DIGNITY_COLOR[planet.dignity];
        const [rx, ry] = at(p.a, RP - r * 0.95);
        const focusable = interactive;
        return (
          <g
            key={p.body}
            data-body={p.body}
            {...(focusable
              ? {
                  role: "button",
                  tabIndex: tabStop === p.body ? 0 : -1,
                  "aria-label": planet.name ?? `${p.body} in ${planet.sign}, ${planet.dignityPhrase}`,
                  onKeyDown: (e: KeyboardEvent<SVGGElement>) => onKey(e, p.body),
                  onFocus: () => setFocusBody(p.body),
                  className: "outline-none [&:focus-visible_.pl-sel]:opacity-100",
                }
              : {})}
          >
            <line x1={f(tx1)} y1={f(ty1)} x2={f(tx2)} y2={f(ty2)} stroke="rgba(242,239,230,.6)" strokeWidth={1.6} />
            {moved && <line x1={f(lx)} y1={f(ly)} x2={f(gx)} y2={f(gy)} stroke="rgba(242,239,230,.3)" strokeWidth={0.7} />}
            {color ? (
              <>
                <circle cx={f(gx)} cy={f(gy)} r={(r * 0.74).toFixed(1)} fill={color} opacity={0.5} filter={`url(#${uid}bl)`} />
                <circle cx={f(gx)} cy={f(gy)} r={(r * 0.62).toFixed(1)} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.2} />
              </>
            ) : (
              <circle cx={f(gx)} cy={f(gy)} r={(r * 0.56).toFixed(1)} fill="rgba(242,239,230,.04)" stroke="rgba(242,239,230,.2)" strokeWidth={0.8} />
            )}
            {focusable && (
              <>
                {/* Two-tone focus ring (11): sky inside gold. */}
                <circle className="pl-sel" cx={f(gx)} cy={f(gy)} r={(r * 0.86).toFixed(1)} fill="none" stroke="var(--sky)" strokeWidth={5} opacity={0} />
                <circle className="pl-sel" cx={f(gx)} cy={f(gy)} r={(r * 0.86 + 2.5).toFixed(1)} fill="none" stroke="var(--gold)" strokeWidth={2.2} opacity={0} />
              </>
            )}
            <text
              x={f(gx)}
              y={f(gy)}
              fontSize={r.toFixed(1)}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--text-primary)"
              className="font-glyph"
              aria-hidden
            >
              {planetGlyph(p.body)}
            </text>
            {planet.retrograde && (
              <text x={f(rx)} y={f(ry)} fontSize={(r * 0.42).toFixed(1)} textAnchor="middle" dominantBaseline="central" fill="var(--text-secondary)" aria-hidden>
                {"℞"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const PHASE_NAMES: [number, string][] = [
  [12, "New moon"],
  [78, "Waxing crescent"],
  [102, "First quarter"],
  [168, "Waxing gibbous"],
  [192, "Full moon"],
  [258, "Waning gibbous"],
  [282, "Last quarter"],
  [348, "Waning crescent"],
  [360, "New moon"],
];

/** A name for a phase angle, for the Moon's own label when no line came with it. */
export const phaseName = (phase: number) => PHASE_NAMES.find(([lim]) => ((phase % 360) + 360) % 360 < lim)![1];

/**
 * The Moon, drawn from the phase angle (0 new, 180 full), lit on the right
 * while waxing, never an emoji. Beside text it's aria-hidden; alone it's an
 * image named by `label` (11).
 */
export function MoonDrawing({ phaseAngle, size = 40, label }: { phaseAngle: number; size?: number; label?: string }) {
  const uid = useId().replace(/:/g, "");
  const r = 20;
  const c = 22;
  const p = ((phaseAngle % 360) + 360) % 360;
  const k = Math.cos((p * Math.PI) / 180);
  const rx = Math.abs(k) * r;
  const wax = p <= 180;
  const limb = wax ? 1 : 0;
  const term = wax ? (k > 0 ? 0 : 1) : k < 0 ? 0 : 1;
  const lit = (1 - k) / 2;
  const top = `${c} ${c - r}`;
  const bot = `${c} ${c + r}`;
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
      {lit > 0.995 ? (
        <circle cx={c} cy={c} r={r} fill={`url(#${uid}m)`} />
      ) : lit >= 0.005 ? (
        <path d={`M${top}A${r} ${r} 0 0 ${limb} ${bot}A${rx.toFixed(2)} ${r} 0 0 ${term} ${top}Z`} fill={`url(#${uid}m)`} />
      ) : null}
    </svg>
  );
}
