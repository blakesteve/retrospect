"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/* A slider over a run of steps (spec 8.6 item 3, 10, 11): a full-width
   track the caller draws, and a handle at least 54 by 46px. It moves by a
   drag of the handle or across the track, by a tap anywhere on the track
   (2.5.7), and by keys. Nothing here knows nights or skies: the steps, what
   each says and where a key goes come in as props, so it could move to
   Roster as a slider unchanged (with Every night's year strip, 8.5).

   A touch on the track waits to see which way it goes: sideways is a drag,
   up or down is the page scrolling (`touch-action: pan-y`), and no move at
   all is a tap. A mouse on the track is the same, so a click seeks and a
   press-and-move drags. The handle drags at once. */

const HANDLE_W = 54;
const HANDLE_H = 46;
/** The track's drawing sits this far in from each side, so the handle's
    center reaches its first and last steps without leaving the column. */
export const DIAL_PAD = HANDLE_W / 2;
/** The drawing's height; the handle hangs below it. */
export const DIAL_TRACK_H = 76;

export interface TimeDialProps {
  /** How many steps: the value runs from 0 to count - 1. */
  count: number;
  /** Where the handle is, a fraction of a step while something travels. */
  value: number;
  /** The step the dial stands for, which a key moves from and the dial
      speaks: where it's going while it travels. The handle's step if left out. */
  at?: number;
  label: string;
  /** What a step says, for the screen reader (11). */
  valueText: (i: number) => string;
  /** Where a key moves the value, or null for a key it ignores. */
  keyStep: (key: string, shift: boolean, i: number) => number | null;
  /** While dragged: the step under the pointer, as it changes. */
  onDrag: (i: number) => void;
  /** Let go after a drag, at this step. */
  onRelease: (i: number) => void;
  /** A key or a tap asks for a step; the caller may travel there. */
  onGo: (i: number, how: "key" | "tap") => void;
  /** Any input on the dial, before it acts (the caller stops anything playing). */
  onInput?: () => void;
  /** The track's drawing, at the width the steps spread across. */
  track: (width: number) => ReactNode;
  disabled?: boolean;
}

export function TimeDial({ count, value, at, label, valueText, keyStep, onDrag, onRelease, onGo, onInput, track, disabled = false }: TimeDialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(0, el.clientWidth - 2 * DIAL_PAD)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const last = Math.max(0, count - 1);
  const now = Math.round(Math.min(last, Math.max(0, at ?? value)));
  const stepAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = clientX - r.left - DIAL_PAD;
    return last === 0 || width <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, x / width)) * last);
  };

  /** A pointer on the dial: dragging at once (the handle), or not yet decided (the track). */
  const press = useRef<{ id: number; x0: number; y0: number; dragging: boolean; at: number } | null>(null);
  const begin = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button > 0) return;
    onInput?.();
    const onHandle = Boolean((e.target as HTMLElement).closest("[data-dial-handle]"));
    press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: onHandle, at: now };
    if (onHandle) ref.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    if (!p.dragging) {
      const dx = e.clientX - p.x0;
      const dy = e.clientY - p.y0;
      if (Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy)) {
        p.dragging = true;
        try {
          ref.current?.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer already went */
        }
      } else if (Math.abs(dy) > 10) {
        // The page is scrolling: this touch was never the dial's.
        press.current = null;
        return;
      } else return;
    }
    const i = stepAt(e.clientX);
    if (i !== p.at) {
      p.at = i;
      onDrag(i);
    }
  };
  const end = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    press.current = null;
    if (p.dragging) onRelease(p.at);
    else if (!cancelled) onGo(stepAt(e.clientX), "tap");
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = keyStep(e.key, e.shiftKey, now);
    if (next === null) return;
    e.preventDefault();
    onInput?.();
    onGo(next, "key");
  };

  const x = last === 0 ? 0 : (Math.min(last, Math.max(0, value)) / last) * width;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={now}
      aria-valuetext={count > 0 ? valueText(now) : undefined}
      aria-disabled={disabled || undefined}
      onKeyDown={onKey}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      // A capture lost without a pointerup (the browser took the touch) still lets go.
      onLostPointerCapture={(e) => end(e, true)}
      className="relative select-none rounded-xl outline-offset-4"
      style={{ height: DIAL_TRACK_H + HANDLE_H, touchAction: "pan-y", cursor: disabled ? "default" : "pointer" }}
      data-dial
    >
      <div className="absolute top-0" style={{ left: DIAL_PAD, width, height: DIAL_TRACK_H }}>
        {width > 0 && track(width)}
      </div>
      {count > 0 && (
        <div aria-hidden className="pointer-events-none absolute top-0 left-0" style={{ transform: `translateX(${(DIAL_PAD + x).toFixed(1)}px)` }}>
          <span
            className="absolute -left-px top-0 block w-0.5"
            style={{ height: DIAL_TRACK_H, background: "linear-gradient(var(--gold), rgba(212,175,55,.25))" }}
          />
          <span
            data-dial-handle
            className="pointer-events-auto absolute grid place-items-center"
            style={{
              left: -HANDLE_W / 2,
              top: DIAL_TRACK_H - 4,
              width: HANDLE_W,
              height: HANDLE_H,
              borderRadius: HANDLE_H / 2,
              touchAction: "none",
              cursor: disabled ? "default" : "grab",
              background: "radial-gradient(circle at 50% 30%, #f6de84, #b9921f 75%)",
              boxShadow: "0 8px 20px rgba(0,0,0,.5), 0 0 0 5px rgba(212,175,55,.16)",
            }}
          >
            <span className="block size-3.5" style={{ background: "repeating-linear-gradient(90deg, rgba(26,20,5,.55) 0 2px, transparent 2px 5px)" }} />
          </span>
        </div>
      )}
    </div>
  );
}
