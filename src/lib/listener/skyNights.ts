import { Body, Illumination, MakeTime, MoonPhase } from "astronomy-engine";
import { conditionFor } from "@/lib/answers/conditions";
import { QUESTIONS, type QuestionId } from "@/lib/answers/questions";
import { longitude, signOf, type Sign } from "@/lib/sky/sky";
import { eclipseEvents, moonEvents, signWindows } from "@/lib/sky/windows";
import type { ZoneClock } from "@/lib/zone";

/**
 * What the sky did on each night, in the listener's zone (spec 7.3, 7.4,
 * 8.5). SERVER ONLY: it reads the generated sky windows.
 *
 * - A question's condition held that night when one of its windows overlaps
 *   the night at all.
 * - The full- and new-moon filters light only the night holding the exact
 *   instant, one door per moon; an eclipse lights the night holding
 *   greatest eclipse.
 * - The Moon is drawn as it was at 9 p.m. local.
 */

const uts = (iso: string) => Date.parse(iso) / 1000;

/** The nights a window [start, end] (Unix seconds, inclusive) overlaps. */
function nightsOverlapped(clock: ZoneClock, start: number, end: number, into: Set<number>): void {
  for (let n = clock.nightOf(start); n <= clock.nightOf(end); n++) into.add(n);
}

export interface SkyNights {
  /** The sky questions whose condition held, by night. Questions 7 and 8 come from NASA's log. */
  conditions: Map<Exclude<QuestionId, "storms" | "flares">, Set<number>>;
  fullMoon: Map<number, { time: number; sign: Sign }>;
  newMoon: Map<number, { time: number; sign: Sign }>;
  eclipse: Map<number, { kind: string; time: number }>;
  /** Mars at home, in Aries or Scorpio: a filter with no question (8.5). */
  marsHome: Set<number>;
}

/** Every sky fact the nights from `first` to `last` need. */
export function skyNights(clock: ZoneClock, first: number, last: number): SkyNights {
  const from = clock.nightStart(first);
  const to = clock.nightStart(last + 1) - 1;
  const inRange = (start: number, end: number) => end >= from && start <= to;

  const conditions = new Map() as SkyNights["conditions"];
  for (const q of QUESTIONS) {
    if (q.nasa) continue;
    const held = new Set<number>();
    for (const w of conditionFor(q.id)!.windows) if (inRange(w.start, w.end)) nightsOverlapped(clock, w.start, w.end, held);
    conditions.set(q.id as Exclude<QuestionId, "storms" | "flares">, held);
  }

  const fullMoon = new Map<number, { time: number; sign: Sign }>();
  const newMoon = new Map<number, { time: number; sign: Sign }>();
  for (const e of moonEvents) {
    const time = uts(e.peak);
    if (time < from || time > to) continue;
    (e.phase === "full" ? fullMoon : newMoon).set(clock.nightOf(time), { time, sign: e.sign });
  }

  const eclipse = new Map<number, { kind: string; time: number }>();
  for (const e of eclipseEvents) {
    const time = uts(e.peak);
    if (time >= from && time <= to) eclipse.set(clock.nightOf(time), { kind: e.kind, time });
  }

  const marsHome = new Set<number>();
  for (const w of signWindows) {
    if (w.body !== "Mars" || (w.sign !== "Aries" && w.sign !== "Scorpio")) continue;
    if (inRange(uts(w.start), uts(w.end))) nightsOverlapped(clock, uts(w.start), uts(w.end), marsHome);
  }

  // Windows reach past the range; keep the nights asked for.
  const trim = (s: Set<number>) => {
    for (const n of s) if (n < first || n > last) s.delete(n);
  };
  conditions.forEach(trim);
  trim(marsHome);
  return { conditions, fullMoon, newMoon, eclipse, marsHome };
}

/** 9 p.m. local on a night's date: 17 hours after its 4 a.m. start. Daylight
    saving changes at 2 a.m., so none falls in between. */
export const ninePm = (clock: ZoneClock, night: number) => clock.nightStart(night) + 17 * 3600;

/** The Moon at 9 p.m. local: MoonPhase's angle (0 new, 180 full), the lit
    fraction, and her sign (spec 7.4). */
export function moonAt(uts: number): { phaseAngle: number; illumination: number; sign: Sign } {
  const date = new Date(uts * 1000);
  const t = MakeTime(date);
  return {
    phaseAngle: MoonPhase(t),
    illumination: Illumination(Body.Moon, t).phase_fraction,
    sign: signOf(longitude("Moon", date)),
  };
}
