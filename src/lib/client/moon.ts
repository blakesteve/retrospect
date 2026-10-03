/* The Moon's shape and name from its phase angle (0 new, 180 full), shared
   by the big Moon drawing and Every night's doors (spec 8.9: drawn from the
   phase angle, never an emoji). No React, so a door doesn't carry the wheel. */

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
 * The Moon's lit part inside a circle of radius r centered at (c, c):
 * an SVG path, lit on the right while waxing, or "full" or "none" when it's
 * within half a percent of either.
 */
export function moonLit(phaseAngle: number, c: number, r: number): string {
  const p = ((phaseAngle % 360) + 360) % 360;
  const k = Math.cos((p * Math.PI) / 180);
  const lit = (1 - k) / 2;
  if (lit > 0.995) return "full";
  if (lit < 0.005) return "none";
  const rx = Math.abs(k) * r;
  const wax = p <= 180;
  const limb = wax ? 1 : 0;
  const term = wax ? (k > 0 ? 0 : 1) : k < 0 ? 0 : 1;
  const top = `${c} ${c - r}`;
  const bot = `${c} ${c + r}`;
  return `M${top}A${r} ${r} 0 0 ${limb} ${bot}A${rx.toFixed(2)} ${r} 0 0 ${term} ${top}Z`;
}
