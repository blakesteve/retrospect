"use client";

import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { preload } from "react-dom";
import type { Dignity, Planet } from "./api";
import { DIGNITY_COLOR, SIGNS, SKY_GLYPH_FONT, planetGlyph, signGlyph } from "./sky";
import { moonLit } from "@/lib/client/moon";
import { pt } from "@/lib/client/spiral";
import { ORBITS, RR, arcEdge, movedOff, orbitGlyph, orbitGlyphSize, placeCovered, retroMark, truePlace, turn, type OrbitGlyph } from "@/lib/client/orbitGlyphs";
import { PATHS } from "./pieces";

/* The Sky view's wheel (spec 8.6 item 2, 8.9): the seven planets on their
   own orbits at their real longitudes, the signs around them with Aries at
   9 o'clock running counterclockwise, your songs as stars on a spiral
   outside the signs, and that night's Moon and date at the center. It draws
   what it's given; the view computes the sky. Units are the Orrery's: the
   drawing is 436 across, centered on 0. */

export const H = 218;

export { pt, RR };
const f = (n: number) => n.toFixed(1);

/** A four-pointed sparkle, r from its center to each point (the Orrery's). */
const spark = (r: number) => {
  const q = r * 0.2;
  return `M0 ${f(-r)}L${f(q)} ${f(-q)}L${f(r)} 0L${f(q)} ${f(q)}L0 ${f(r)}L${f(-q)} ${f(q)}L${f(-r)} 0L${f(-q)} ${f(-q)}Z`;
};
/** The sign ring's ticks, every 5°, longer every 10°. */
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const [ax, ay] = pt(i * 5, RR.zi);
  const [bx, by] = pt(i * 5, RR.zi + (i % 2 ? 3.5 : 6));
  return `M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}`;
}).join("");

function sector(l1: number, l2: number, r1: number, r2: number): string {
  const [ax, ay] = pt(l1, r2);
  const [bx, by] = pt(l2, r2);
  const [cx, cy] = pt(l2, r1);
  const [dx, dy] = pt(l1, r1);
  return `M${f(ax)} ${f(ay)}A${r2} ${r2} 0 0 0 ${f(bx)} ${f(by)}L${f(cx)} ${f(cy)}A${r1} ${r1} 0 0 1 ${f(dx)} ${f(dy)}Z`;
}

/** A sector's tint by the selected planet's standing in its sign. */
const TINT: Record<Dignity, string | null> = {
  home: "rgba(212,175,55,.34)",
  exalted: "rgba(127,179,165,.36)",
  detriment: "rgba(168,97,127,.42)",
  fall: "rgba(200,106,74,.38)",
  neutral: null,
};

export interface SkyStar {
  id: string;
  /** The Sun's longitude at the first play. */
  angle: number;
  r: number;
  size: number;
  /** "Aquarius by Boards of Canada, first played Apr 8, 2024 at 1:38 p.m. CDT" */
  name: string;
  /** The first scrobble: drawn as a ring. */
  origin: boolean;
  /** Among the most played: a sparkle behind it (the Orrery's, over 100 of its 212). */
  sparkle: boolean;
}

export interface SkySpiral {
  /** The whole path, and its length. */
  d: string;
  length: number;
  /** How far along it the dial's moment is. */
  done: number;
  strokes: { baseWidth: number; baseOpacity: number; baseDash: string | undefined; doneWidth: number; doneOpacity: number };
  /** The year behind the moment, earliest piece first, brightening to the moment. */
  tail: string[];
  /** The moment itself: where the Sun was, on the spiral. */
  head: { x: number; y: number };
}

export interface SkyOrbitsProps {
  size: number;
  bodies: Planet[];
  /** The Moon at the center, by its phase angle; null before the sky arrives. */
  moonPhase: number | null;
  /** "THU" and "May 10" under the Moon. */
  day: { dow: string; date: string } | null;
  stars: SkyStar[];
  spiral: SkySpiral | null;
  natal: { body: string; longitude: number }[];
  /** The selected planet, whose standing in each sign tints the sectors. */
  selected: string | null;
  tints: Partial<Record<string, Dignity>> | null;
  onPlanet: (body: string) => void;
  onStar: (id: string) => void;
  /** A star passed by the dial: lit, its title shown for a moment. */
  lit: { id: string; title: string; n: number } | null;
  /** A flash for the night the dial crossed: its kind, numbered to restart. */
  flash: { kind: "storm" | "flare" | "eclipse" | "asteroid"; n: number } | null;
  /** The ring around the center, as wide as the night's plays, and its beat, numbered to restart. */
  pulse: { width: number; n: number };
  /** The opening (8.11): waiting or running, p (0 to 1) of the way, and the
      seconds the stars' flight has to end inside it (null: they don't fly). */
  opening: { state: "wait" | "run" | null; p: number; stars: number | null; endedBy: RefObject<number | null> };
  /** "Play your years" is running: the stars twinkle while it does. */
  playing: boolean;
  /** How far each planet's glyph stands off its longitude, in degrees, so
      none covers another (`orbitGlyphs.ts`); null: none does. */
  nudges: Record<string, number> | null;
  /** The planets are still (no trip, no opening), so a nudged glyph's true place is marked. */
  still: boolean;
}

type Item = { kind: "planet" | "star"; id: string; angle: number; x: number; y: number };

/** A star or planet shows focus as its own two-tone circle (11), not the
    page's square ring around its box: inline, so the page's rule can't win. */
const NO_BOX: CSSProperties = { outline: "none", boxShadow: "none" };

export function SkyOrbits({
  size,
  bodies,
  moonPhase,
  day,
  stars,
  spiral,
  natal,
  selected,
  tints,
  onPlanet,
  onStar,
  lit,
  flash,
  pulse,
  opening,
  playing,
  nudges,
  still,
}: SkyOrbitsProps) {
  // The glyphs' own font, asked for as the wheel first draws.
  preload(SKY_GLYPH_FONT, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const pressedAt = useRef<number | null>(null);
  const scale = size / (2 * H);
  // A 44px hit circle at any size (10, 11): overlaps go to the nearest center.
  const hitR = 22 / scale;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const b of bodies) {
      const r = RR[b.body as (typeof ORBITS)[number]];
      if (!r) continue;
      // Hit, and ordered for the arrow keys, where the glyph is drawn.
      const angle = b.longitude + (nudges?.[b.body] ?? 0);
      const [x, y] = pt(angle, r);
      out.push({ kind: "planet", id: b.body, angle: ((angle % 360) + 360) % 360, x, y });
    }
    for (const s of stars) {
      const [x, y] = pt(s.angle, s.r);
      out.push({ kind: "star", id: s.id, angle: s.angle, x, y });
    }
    // Arrow keys move in angular order (11).
    return out.sort((a, b) => a.angle - b.angle || (a.kind === b.kind ? 0 : a.kind === "planet" ? -1 : 1));
  }, [bodies, stars, nudges]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabStop = items.some((i) => `${i.kind}:${i.id}` === focusId) ? focusId : items[0] ? `${items[0].kind}:${items[0].id}` : null;

  const activate = (it: Item) => (it.kind === "planet" ? onPlanet(it.id) : onStar(it.id));
  const focusItem = (key: string) => {
    setFocusId(key);
    svgRef.current?.querySelector<SVGGElement>(`[data-item="${key}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, it: Item) => {
    const i = items.indexOf(it);
    let next: Item | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = items[(i + 1) % items.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
    else if (e.key === "Home") next = items[0];
    else if (e.key === "End") next = items[items.length - 1];
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(it);
      return;
    }
    if (next) {
      e.preventDefault();
      focusItem(`${next.kind}:${next.id}`);
    }
  };
  const nearest = (e: PointerEvent<SVGSVGElement>): Item | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best: { it: Item; d: number } | null = null;
    for (const it of items) {
      const d = Math.hypot(p.x - it.x, p.y - it.y);
      if (d <= hitR && (!best || d < best.d)) best = { it, d };
    }
    return best?.it ?? null;
  };

  // Each planet's glyph where it's drawn, and the true places to mark.
  const placed = useMemo(
    () =>
      ORBITS.flatMap((o) => {
        const b = bodies.find((p) => p.body === o);
        const g = b && orbitGlyph(b);
        return g ? [[g, g.longitude + (nudges?.[o] ?? 0)] as [OrbitGlyph, number]] : [];
      }),
    [bodies, nudges],
  );
  const marks = useMemo(
    () =>
      !still
        ? []
        : placed.flatMap(([g, angle]) => {
            if (!movedOff(g.longitude, angle)) return [];
            const place = truePlace(g, angle);
            if (!place.beside) return [];
            // The arc runs along the orbit from the true place to the glyph's ink circle.
            const edge = arcEdge(g, angle);
            const ahead = turn(g.longitude, angle) > 0;
            const [ex, ey] = edge === null ? [0, 0] : pt(edge, g.r);
            const arc = edge === null ? null : `M${f(place.x)} ${f(place.y)}A${g.r} ${g.r} 0 0 ${ahead ? 0 : 1} ${f(ex)} ${f(ey)}`;
            return [{ g, place, arc, over: placeCovered(g, placed) }];
          }),
    [placed, still],
  );
  const lit2 = lit ? stars.find((s) => s.id === lit.id) : null;
  const moon = moonPhase === null ? null : moonLit(moonPhase, 0, 14);
  const focusRing = (r: number) => (
    <>
      <circle className="pl-sel" r={f(r)} fill="none" stroke="var(--sky)" strokeWidth={5} opacity={0} />
      <circle className="pl-sel" r={f(r + 2.5)} fill="none" stroke="var(--gold)" strokeWidth={2.2} opacity={0} />
    </>
  );
  // The stars' flight fits what's left of the opening: their delays spread
  // over up to 1.05s, each 0.7s long, all ended before it's still (8.11).
  const flight = opening.stars === null ? null : Math.max(0, Math.min(1.05, opening.stars - 0.85));
  const sun = bodies.find((b) => b.body === "Sun");
  const sunAt = sun ? pt(sun.longitude, RR.Sun) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`${-H} ${-H} ${2 * H} ${2 * H}`}
      width={size}
      height={size}
      role="group"
      aria-label="Sky wheel"
      className="mx-auto block select-none overflow-visible"
      style={{ touchAction: "manipulation", cursor: "pointer" }}
      onPointerDown={(e) => {
        pressedAt.current = e.timeStamp;
      }}
      onPointerUp={(e) => {
        // A press that stopped the opening only stopped it: the planets have
        // jumped to their places, and the tap would land on where one was going.
        if (opening.endedBy.current !== null && opening.endedBy.current === pressedAt.current) return;
        const it = nearest(e);
        if (!it) return;
        // Focus first, so a sheet it opens returns focus to it (11).
        setFocusId(`${it.kind}:${it.id}`);
        svgRef.current?.querySelector<SVGGElement>(`[data-item="${it.kind}:${it.id}"]`)?.focus({ preventScroll: true });
        activate(it);
      }}
      data-sky-wheel
      data-opening={opening.state ?? undefined}
      data-playing={playing || undefined}
    >
      <defs>
        <radialGradient id={`${uid}c`}>
          <stop offset="0" stopColor="#20275a" />
          <stop offset="1" stopColor="#0d112b" />
        </radialGradient>
        <radialGradient id={`${uid}s`}>
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".3" stopColor="#d4af37" stopOpacity=".5" />
          <stop offset="1" stopColor="#d4af37" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}sun`}>
          <stop offset="0" stopColor="#ffd76a" stopOpacity=".6" />
          <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}moon`}>
          <stop offset="0" stopColor="#e8e6ff" stopOpacity=".4" />
          <stop offset="1" stopColor="#e8e6ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The signs, and the selected planet's standing in each (8.6). */}
      {SIGNS.map((sign, i) => {
        const tint = tints?.[sign] ? TINT[tints[sign]!] : null;
        const [gx, gy] = pt(i * 30 + 15, (RR.zi + RR.zo) / 2);
        return (
          <g key={sign}>
            <path
              d={sector(i * 30, i * 30 + 30, RR.zi, RR.zo)}
              fill={i % 2 ? "rgba(116,135,234,.055)" : "rgba(255,255,255,.022)"}
              stroke="rgba(212,175,55,.26)"
              strokeWidth={0.8}
            />
            {tint && <path d={sector(i * 30, i * 30 + 30, RR.zi, RR.zo)} fill={tint} />}
            <text x={f(gx)} y={f(gy)} dy=".36em" fontSize={21} textAnchor="middle" fill="rgba(222,190,90,.85)" className="font-glyph" aria-hidden>
              {signGlyph(sign)}
            </text>
          </g>
        );
      })}
      <path d={TICKS} stroke="rgba(212,175,55,.35)" strokeWidth={0.8} aria-hidden />
      {ORBITS.map((o, i) => (
        <circle key={o} r={RR[o]} fill="none" stroke="rgba(212,175,55,.12)" strokeWidth={0.8} strokeDasharray={i % 2 ? undefined : "1 3"} />
      ))}

      {/* Your songs on a spiral calendar around the rim (8.6): the track, the
          part the dial has passed, its last year brightening to the moment,
          and the moment itself, joined to the Sun whose place it is. */}
      {spiral && (
        <g aria-hidden>
          <path
            d={spiral.d}
            fill="none"
            stroke="rgb(185,182,171)"
            strokeOpacity={spiral.strokes.baseOpacity}
            strokeWidth={spiral.strokes.baseWidth}
            strokeDasharray={spiral.strokes.baseDash}
          />
          <path
            d={spiral.d}
            pathLength={spiral.length}
            fill="none"
            stroke="var(--gold)"
            strokeOpacity={spiral.strokes.doneOpacity}
            strokeWidth={spiral.strokes.doneWidth}
            strokeDasharray={`${f(spiral.done)} ${f(spiral.length + 20)}`}
            data-spiral-done
          />
          {spiral.tail.map((d, k) =>
            d ? (
              <path
                key={k}
                d={d}
                fill="none"
                stroke="var(--gold)"
                strokeOpacity={f(0.12 + (0.78 * (k + 1)) / spiral.tail.length)}
                strokeWidth={f(spiral.strokes.doneWidth + (0.8 * (k + 1)) / spiral.tail.length)}
              />
            ) : null,
          )}
          {sunAt && (
            <line
              x1={f(sunAt[0])}
              y1={f(sunAt[1])}
              x2={f(spiral.head.x)}
              y2={f(spiral.head.y)}
              stroke="rgba(255,215,106,.28)"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={opening.p}
            />
          )}
          <g transform={`translate(${f(spiral.head.x)} ${f(spiral.head.y)})`} opacity={opening.p} data-comet>
            <circle r={10} fill={`url(#${uid}s)`} />
            <circle r={3.3} fill="#fff8e0" />
          </g>
        </g>
      )}
      <g>
        {stars.map((s, i) => {
          const [x, y] = pt(s.angle, s.r);
          const key = `star:${s.id}`;
          // The opening: stars fly in from nearer the center, oldest first.
          // While Play runs they twinkle, each at its own pace and start, so
          // none move together and none jumps as it begins.
          const fly = (s.r - RR.si) / (RR.so - RR.si);
          const vars = {
            "--sd": `${(0.05 + fly * (flight ?? 0)).toFixed(2)}s`,
            "--tx": `${f(-x * 0.25)}px`,
            "--ty": `${f(-y * 0.25)}px`,
            "--tw": `${(0.8 + ((i * 0.61) % 0.4)).toFixed(2)}s`,
            "--dp": `${((i * 0.83) % 2).toFixed(2)}s`,
          } as CSSProperties;
          return (
            <g
              key={s.id}
              data-item={key}
              data-star={s.id}
              transform={`translate(${f(x)} ${f(y)})`}
              role="button"
              tabIndex={tabStop === key ? 0 : -1}
              aria-label={s.name}
              onKeyDown={(e) =>
                onKey(
                  e,
                  items.find((it) => it.kind === "star" && it.id === s.id)!,
                )
              }
              onFocus={() => setFocusId(key)}
              className="[&:focus-visible_.pl-sel]:opacity-100"
              style={NO_BOX}
            >
              <g className={flight !== null ? "sky-star-in" : undefined} style={vars}>
                <circle r={f(s.size * 3.1)} fill={`url(#${uid}s)`} opacity={0.62} className="sky-tw" />
                {lit?.id === s.id && <circle key={lit.n} r={f(s.size * 3.1)} fill={`url(#${uid}s)`} className="sky-lit" />}
                {s.origin ? (
                  <>
                    <circle r={4.6} fill="none" stroke="var(--gold)" strokeWidth={1.6} />
                    <circle r={1.6} fill="#fff4cf" />
                  </>
                ) : (
                  <>
                    {s.sparkle && <path d={spark(s.size * 2.3)} fill="#fff4cf" />}
                    <circle r={f(s.size)} fill="#fff4cf" />
                  </>
                )}
              </g>
              {focusRing(s.size + 7.5)}
            </g>
          );
        })}
      </g>

      {/* Your natal planets, small open glyphs just inside the signs (8.6 item 5). */}
      {natal.map((n) => {
        const [x, y] = pt(n.longitude, RR.nt);
        return (
          <text
            key={n.body}
            data-natal={n.body}
            x={f(x)}
            y={f(y)}
            dy=".35em"
            fontSize={21}
            textAnchor="middle"
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth={1.1}
            className="wheel-glyph"
            aria-hidden
          >
            {planetGlyph(n.body)}
          </text>
        );
      })}

      {/* The center: that night's Moon, drawn, and the date (8.6, 8.9), in a
          ring as wide as the night's plays that beats as the dial passes music. */}
      <g aria-hidden>
        <circle r={f(RR.c + 1 + pulse.width / 2)} fill="none" stroke="var(--gold)" strokeOpacity={0.45} strokeWidth={f(pulse.width)} data-pulse />
        {pulse.n > 0 && (
          <circle key={pulse.n} r={f(RR.c + 1 + pulse.width / 2)} fill="none" stroke="var(--gold)" strokeWidth={f(pulse.width)} className="sky-beat" />
        )}
        <circle r={RR.c} fill={`url(#${uid}c)`} stroke="rgba(212,175,55,.35)" strokeWidth={1} />
        {moon !== null && (
          <g transform="translate(0 -13)">
            <circle r={14} fill="#1b2046" stroke="rgba(242,239,230,.25)" strokeWidth={0.8} />
            {moon === "full" ? <circle r={14} fill="#f4efd9" /> : moon !== "none" ? <path d={moon} fill="#f4efd9" /> : null}
          </g>
        )}
        {day && (
          <>
            <text y={12} textAnchor="middle" fontSize={11.5} fontWeight={700} letterSpacing="0.16em" fill="var(--gold)">
              {day.dow}
            </text>
            <text y={30} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--text-primary)" className="font-display">
              {day.date}
            </text>
          </>
        )}
      </g>

      {/* The planets on their orbits: each a button with its glow, dignity
          halo and rings here; its true place's mark over that; its glyph and
          ℞ over those, so a dot never covers ink. A glyph that would cover a
          neighbor's stands off along its orbit (orbitGlyphs.ts). */}
      <g>
        {ORBITS.map((o) => {
          const b = bodies.find((p) => p.body === o);
          if (!b) return null;
          const [x, y] = pt(b.longitude + (nudges?.[o] ?? 0), RR[o]);
          const big = o === "Sun" || o === "Moon";
          const halo = big ? 16 : 12.5;
          const color = DIGNITY_COLOR[b.dignity];
          const key = `planet:${o}`;
          const on = selected === o;
          return (
            <g
              key={o}
              data-item={key}
              data-body={o}
              data-longitude={b.longitude.toFixed(2)}
              transform={`translate(${f(x)} ${f(y)})`}
              role="button"
              tabIndex={tabStop === key ? 0 : -1}
              aria-label={b.name ?? `${o} in ${b.sign}, ${b.dignityPhrase}`}
              data-selected={on || undefined}
              onKeyDown={(e) =>
                onKey(
                  e,
                  items.find((it) => it.kind === "planet" && it.id === o)!,
                )
              }
              onFocus={() => setFocusId(key)}
              className="[&:focus-visible_.pl-sel]:opacity-100"
              style={NO_BOX}
            >
              {o === "Sun" && <circle r={26} fill={`url(#${uid}sun)`} />}
              {o === "Moon" && <circle r={22} fill={`url(#${uid}moon)`} />}
              {color && <circle r={halo} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.6} />}
              {on && <circle r={halo + 3.5} fill="none" stroke="var(--text-primary)" strokeWidth={1.2} strokeDasharray="2 2" />}
              {focusRing(halo + 5)}
            </g>
          );
        })}
      </g>

      {/* A moved glyph's true place, once the planets are still, where it
          falls beside the glyph's ink: the orbit picked out from there to the
          glyph's edge, and a dot, here under the glyphs so it covers no ink. */}
      {marks.length > 0 && (
        <g aria-hidden pointerEvents="none">
          {marks.map((m) => (
            <g key={m.g.body} data-true={m.over ? undefined : m.g.body}>
              {m.arc && <path d={m.arc} fill="none" stroke="rgba(242,239,230,.6)" strokeWidth={1.2} />}
              {!m.over && <circle cx={f(m.place.x)} cy={f(m.place.y)} r={2.6} fill="var(--text-primary)" stroke="#0b1026" strokeWidth={1.4} />}
            </g>
          ))}
        </g>
      )}

      {/* The glyphs and their ℞, over the planets and the marks; taps and keys go to the planets. */}
      <g aria-hidden pointerEvents="none">
        {ORBITS.map((o) => {
          const b = bodies.find((p) => p.body === o);
          if (!b) return null;
          const [x, y] = pt(b.longitude + (nudges?.[o] ?? 0), RR[o]);
          const mark = retroMark(o);
          return (
            <g key={o} data-glyph={o} transform={`translate(${f(x)} ${f(y)})`}>
              <text
                dy=".35em"
                fontSize={orbitGlyphSize(o)}
                textAnchor="middle"
                fill={o === "Sun" ? "#ffe39a" : "var(--text-primary)"}
                stroke="#0b1026"
                strokeWidth={4.5}
                paintOrder="stroke"
                strokeLinejoin="round"
                className="wheel-glyph"
              >
                {planetGlyph(o)}
              </text>
              {b.retrograde && (
                <text
                  data-rx
                  x={mark.dx}
                  y={mark.dy}
                  dy=".35em"
                  fontSize={mark.size}
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  stroke="#0b1026"
                  strokeWidth={3}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                  className="wheel-glyph"
                >
                  {"℞"}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* A true place under a neighbor's glyph (the middle of a tight cluster
          can't clear both of its neighbors'): a ring over it, so the ink
          shows through. */}
      {marks.some((m) => m.over) && (
        <g aria-hidden pointerEvents="none">
          {marks
            .filter((m) => m.over)
            .map((m) => (
              <g key={m.g.body} data-true={m.g.body} data-over>
                <circle cx={f(m.place.x)} cy={f(m.place.y)} r={3} fill="none" stroke="#0b1026" strokeWidth={2.6} />
                <circle cx={f(m.place.x)} cy={f(m.place.y)} r={3} fill="none" stroke="var(--text-primary)" strokeWidth={1.2} />
              </g>
            ))}
        </g>
      )}

      {/* A night's events flash as the dial crosses it (8.6, 8.11); none under
          reduced motion. Each key says which: the two count separately, and
          sharing one ("1" and "1") had React re-insert the flash every frame. */}
      {flash && <FlashMark key={`flash-${flash.n}`} kind={flash.kind} />}
      {lit2 && lit && (
        <g key={`lit-${lit.n}`} className="sky-flash" style={{ animationDuration: "2.4s" } as CSSProperties} aria-hidden>
          <StarTitle star={lit2} title={lit.title} />
        </g>
      )}
    </svg>
  );
}

/** A night's event flashes its icon over the center (8.6), with the storm's aurora around the rim. */
const FLASH_COLOR = { storm: "var(--aurora)", flare: "var(--flare)", eclipse: "#fff6d8", asteroid: "#d6c9a8" } as const;
function FlashMark({ kind }: { kind: "storm" | "flare" | "eclipse" | "asteroid" }) {
  return (
    <g className="sky-flash" aria-hidden data-flash={kind}>
      {kind === "storm" && <circle r={RR.so + 2} fill="none" stroke="var(--aurora)" strokeWidth={9} strokeOpacity={0.35} />}
      <circle r={RR.c - 2} fill="#0b1026" opacity={0.85} />
      <g transform="translate(-21 -21) scale(1.75)" fill="none" stroke={FLASH_COLOR[kind]} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {PATHS[kind]}
      </g>
    </g>
  );
}

function StarTitle({ star, title }: { star: SkyStar; title: string }) {
  const [x, y] = pt(star.angle, star.r);
  // Inside the wheel from the star, so it never runs off the column.
  const lx = Math.max(-H + 70, Math.min(H - 70, x * 0.78));
  const ly = Math.max(-H + 20, Math.min(H - 20, y * 0.78));
  const w = Math.min(200, 14 + title.length * 7.6);
  return (
    <g transform={`translate(${f(lx)} ${f(ly)})`}>
      <rect x={-w / 2} y={-14} width={w} height={28} rx={8} fill="rgba(12,15,38,.92)" stroke="rgba(212,175,55,.28)" />
      <text textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={600} fill="var(--text-primary)">
        {title.length > 24 ? `${title.slice(0, 23)}…` : title}
      </text>
    </g>
  );
}
