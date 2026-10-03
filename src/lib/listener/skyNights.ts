import { Body, Illumination, MakeTime, MoonPhase } from "astronomy-engine";
import { conditionFor } from "@/lib/answers/conditions";
import { QUESTIONS, type QuestionId } from "@/lib/answers/questions";
import { PRECISION } from "@/lib/sky/planet";
import { longitude, signOf, type Sign, type SkyBody } from "@/lib/sky/sky";
import { eclipseEvents, moonEvents, retrogradeWindows, signWindows } from "@/lib/sky/windows";
import type { ZoneClock } from "@/lib/zone";
import { timeIn } from "./words";

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

/** The Moon's phase angle at an instant (MoonPhase: 0 new, 90 first quarter,
    180 full), to 0.01°, the precision `moonAt` explains. */
export const moonPhaseAt = (uts: number): number => Math.round(MoonPhase(MakeTime(new Date(uts * 1000))) * 100) / 100;

/** The Moon at 9 p.m. local: MoonPhase's angle (0 new, 180 full), the lit
    fraction, and her sign (spec 7.4). The angle is kept to 0.01°, finer than
    any drawing needs, and the fraction to the whole percent the copy says,
    rounded once from the raw value (rounding twice moved "% lit" a point on
    1 night in 200). The digits past those come from the trigonometry, which
    differs between Node versions and platforms, and the committed sample
    must read the same on CI's Node 22 as on a laptop's Node 24. */
export function moonAt(uts: number): { phaseAngle: number; illumination: number; sign: Sign } {
  const date = new Date(uts * 1000);
  const t = MakeTime(date);
  return {
    phaseAngle: moonPhaseAt(uts),
    illumination: Math.round(Illumination(Body.Moon, t).phase_fraction * 100) / 100,
    sign: signOf(longitude("Moon", date)),
  };
}

/* ---- What changed during a night (8.7.2, item 4) ------------------------- */

export interface NightChange {
  /** Unix seconds. */
  time: number;
  /** The display name: "Moon", "Venus". */
  body: string;
  kind: "sign" | "station";
  /** "The Moon entered Cancer at 10:13 p.m. CDT."; "Venus turned retrograde
      at 2:09 a.m. CDT."; "Saturn turned direct that night." */
  text: string;
}

/** "the Moon", "the Sun", "Venus", inside a sentence. */
const named = (body: SkyBody) => (body === "Sun" || body === "Moon" ? `the ${body}` : body);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Every sign change and station during each night from `first` to `last` (4
 * a.m. to 4 a.m.), in time order: the wheel shows one minute and the night
 * lasts 24 hours, so without these the night sheet contradicts itself. The
 * Sun and Moon included. Jupiter and Saturn keep the precision the sky data
 * has, the day (`PRECISION`), so theirs say "that night" with no time. A
 * change still to come tonight (after `now`) is in the present tense, and
 * tonight's undated one says "tonight" (8.7.2).
 */
export function nightChanges(clock: ZoneClock, first: number, last: number, now: number): Map<number, NightChange[]> {
  const from = clock.nightStart(first);
  const to = clock.nightStart(last + 1) - 1;
  const tonight = clock.nightOf(now);
  const out = new Map<number, NightChange[]>();
  const add = (time: number, body: SkyBody, kind: NightChange["kind"], past: string, future: string) => {
    if (time < from || time > to) return;
    const night = clock.nightOf(time);
    const ahead = time > now;
    const when = PRECISION[body] === "day" ? (night === tonight ? "tonight" : "that night") : `at ${timeIn(clock.zone, time)}`;
    const text = `${capital(named(body))} ${ahead ? future : past} ${when}.`;
    out.set(night, [...(out.get(night) ?? []), { time, body, kind, text }]);
  };
  for (const w of signWindows) {
    const t = uts(w.start);
    const verb = w.retrogradeAtStart ? ["backed into", "backs into"] : ["entered", "enters"];
    add(t, w.body, "sign", `${verb[0]} ${w.sign}`, `${verb[1]} ${w.sign}`);
  }
  for (const w of retrogradeWindows) {
    add(uts(w.start), w.body, "station", "turned retrograde", "turns retrograde");
    add(uts(w.end), w.body, "station", "turned direct", "turns direct");
  }
  for (const list of out.values()) list.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * For each night, the sky questions whose condition began or ended inside
 * it (8.7.2, item 6): "from 10:13 p.m. CDT", "until 2:40 a.m. CDT", or "9:05
 * to 11:50 p.m. CDT". A condition that held the whole night has none. Two in
 * one night join with "and". Questions 7 and 8 are whole nights by
 * definition and never have one.
 */
export function conditionNotes(clock: ZoneClock, first: number, last: number): Map<number, Partial<Record<QuestionId, string>>> {
  const from = clock.nightStart(first);
  const to = clock.nightStart(last + 1) - 1;
  const zone = clock.zone;
  const parts = new Map<number, Map<QuestionId, string[]>>();
  const add = (night: number, id: QuestionId, text: string) => {
    if (night < first || night > last) return;
    let byId = parts.get(night);
    if (!byId) parts.set(night, (byId = new Map()));
    byId.set(id, [...(byId.get(id) ?? []), text]);
  };
  for (const q of QUESTIONS) {
    if (q.nasa) continue;
    for (const w of conditionFor(q.id)!.windows) {
      if (w.end < from || w.start > to) continue;
      const a = clock.nightOf(w.start);
      const b = clock.nightOf(w.end);
      const beganInside = w.start > clock.nightStart(a);
      const endedInside = w.end < clock.nightStart(b + 1) - 1;
      if (a === b && beganInside && endedInside) add(a, q.id, timeSpan(zone, w.start, w.end));
      else {
        if (beganInside) add(a, q.id, `from ${timeIn(zone, w.start)}`);
        if (endedInside) add(b, q.id, `until ${timeIn(zone, w.end)}`);
      }
    }
  }
  const out = new Map<number, Partial<Record<QuestionId, string>>>();
  for (const [night, byId] of parts) {
    const notes: Partial<Record<QuestionId, string>> = {};
    for (const [id, texts] of byId) notes[id] = texts.join(" and ");
    out.set(night, notes);
  }
  return out;
}

/** "9:05 to 11:50 p.m. CDT", or "11:05 p.m. to 1:50 a.m. CDT" when the
    half of the day changes; both in full when the zone's name does. */
export function timeSpan(zone: string, a: number, b: number): string {
  const [ta, ...ra] = timeIn(zone, a).split(" ");
  const tb = timeIn(zone, b);
  const sa = ra.join(" ");
  const sb = tb.split(" ").slice(1).join(" ");
  if (sa === sb) return `${ta} to ${tb}`;
  const [, ...ma] = ra;
  const [, ...mb] = tb.split(" ").slice(1);
  return ma.join(" ") === mb.join(" ") ? `${ta} ${ra[0]} to ${tb}` : `${ta} ${sa} to ${tb}`;
}
