import {
  harmonyWindows,
  moonEvents,
  retrogradeWindows,
  signWindows,
  type HarmonyWindow,
  type SignWindow,
} from "@/lib/sky/windows";
import type { Sign, SkyBody } from "@/lib/sky/sky";
import type { ZoneClock } from "@/lib/zone";
import type { QuestionId } from "./questions";

/**
 * Each question's sky condition as windows and events (spec 6.2). SERVER
 * ONLY: it reads the generated sky through `src/lib/sky/windows.ts`.
 *
 * An event is one window, or several merged. Only the event count merges:
 * the days between merged windows stay outside the windows.
 */

export interface ConditionWindow {
  /** Unix seconds, whole, inclusive at both ends as today's lookup is. */
  start: number;
  end: number;
  /** Index of the event this window belongs to, counting from 0 in time order. */
  event: number;
  /** Sign conditions: the sign the planet was in. Retrogrades: the sign at
      the station retrograde. Moon windows: the Moon's sign at the peak. */
  sign?: Sign;
  /** Retrogrades: the sign at the station direct. */
  signAtDirect?: Sign;
  /** The aspect condition: which aspect, and on which side (spec 7.2). */
  aspect?: 60 | 120;
  side?: "+" | "-";
}

export type ConditionKind = "retrograde" | "moon" | "sign" | "aspect" | "nights";

export interface Condition {
  kind: ConditionKind;
  /** The planet the condition is about, for retrogrades and sign conditions. */
  body?: SkyBody;
  /** Sorted by start, and disjoint. */
  windows: ConditionWindow[];
  /** How many events the windows make. */
  eventCount: number;
}

const uts = (iso: string) => Date.parse(iso) / 1000;

/** One event per window: retrogrades, full moons and new moons (6.2, rule 4),
    and the Moon's signs, which never merge. */
function oneEach<T>(items: T[], toWindow: (item: T) => Omit<ConditionWindow, "event">): ConditionWindow[] {
  return items.map((item, i) => ({ ...toWindow(item), event: i }));
}

/**
 * Spec 6.2, rule 1. Consecutive windows of one planet's condition merge when
 * the planet left the condition's signs, or came back into them, while
 * retrograde: inside one of its station-to-station windows. So Venus in Aries,
 * Feb 4 to Jun 5, 2025, is one event: she backed into Pisces on Mar 27 while
 * retrograde and came back on Apr 30. Merges chain.
 */
export function mergeSignWindows(windows: SignWindow[]): ConditionWindow[] {
  const sorted = [...windows].sort((a, b) => uts(a.start) - uts(b.start));
  let event = -1;
  return sorted.map((w, i) => {
    const prev = sorted[i - 1];
    if (!prev || !(prev.retrogradeAtEnd || w.retrogradeAtStart)) event++;
    return { start: uts(w.start), end: uts(w.end), event, sign: w.sign };
  });
}

/**
 * Spec 6.2, rule 2. Consecutive windows merge only when they're the same
 * aspect on the same side and the separation turned around between them: its
 * rate of change has opposite signs at the end of the first and the start of
 * the second. Jan 23 to 28, Apr 2 to 12 and May 13 to 29, 2025 (trine, "+")
 * are one event.
 */
export function mergeAspectWindows(windows: HarmonyWindow[]): ConditionWindow[] {
  const sorted = [...windows].sort((a, b) => uts(a.start) - uts(b.start));
  let event = -1;
  return sorted.map((w, i) => {
    const prev = sorted[i - 1];
    const turned =
      prev !== undefined &&
      prev.aspect === w.aspect &&
      prev.side === w.side &&
      Math.sign(prev.rateAtEnd) !== Math.sign(w.rateAtStart) &&
      prev.rateAtEnd !== 0 &&
      w.rateAtStart !== 0;
    if (!turned) event++;
    return { start: uts(w.start), end: uts(w.end), event, aspect: w.aspect, side: w.side };
  });
}

const signCondition = (body: SkyBody, signs: Sign[]): Condition => {
  const windows = mergeSignWindows(signWindows.filter((w) => w.body === body && signs.includes(w.sign)));
  return { kind: "sign", body, windows, eventCount: countOf(windows) };
};

const retrogradeCondition = (body: SkyBody): Condition => {
  const windows = oneEach(
    retrogradeWindows.filter((w) => w.body === body),
    (w) => ({ start: uts(w.start), end: uts(w.end), sign: w.sign, signAtDirect: w.signAtDirect }),
  );
  return { kind: "retrograde", body, windows, eventCount: windows.length };
};

const moonCondition = (phase: "full" | "new"): Condition => {
  const windows = oneEach(
    moonEvents.filter((e) => e.phase === phase),
    (e) => ({ start: uts(e.start), end: uts(e.end), sign: e.sign }),
  );
  return { kind: "moon", windows, eventCount: windows.length };
};

const countOf = (windows: ConditionWindow[]) => (windows.length ? windows[windows.length - 1].event + 1 : 0);

const BUILDERS: Partial<Record<QuestionId, () => Condition>> = {
  mercury: () => retrogradeCondition("Mercury"),
  fullmoon: () => moonCondition("full"),
  newmoon: () => moonCondition("new"),
  venushome: () => signCondition("Venus", ["Taurus", "Libra"]),
  moonstrong: () => {
    const windows = oneEach(
      signWindows.filter((w) => w.body === "Moon" && (w.sign === "Cancer" || w.sign === "Taurus")),
      (w) => ({ start: uts(w.start), end: uts(w.end), sign: w.sign }),
    );
    return { kind: "sign", body: "Moon", windows, eventCount: windows.length };
  },
  venusmars: () => {
    const windows = mergeAspectWindows(harmonyWindows);
    return { kind: "aspect", windows, eventCount: countOf(windows) };
  },
  marswater: () => signCondition("Mars", ["Cancer", "Scorpio", "Pisces"]),
  venusdet: () => signCondition("Venus", ["Aries", "Scorpio"]),
  venusrx: () => retrogradeCondition("Venus"),
  marsrx: () => retrogradeCondition("Mars"),
};

/**
 * Questions 7 and 8: the listener's nights (4 a.m. to 4 a.m. in their zone)
 * as windows, one per night. Consecutive nights are one event (6.2, rule 3).
 * The days around them stay outside.
 */
export function nightsCondition(nights: number[], clock: ZoneClock): Condition {
  const sorted = [...new Set(nights)].sort((a, b) => a - b);
  let event = -1;
  const windows = sorted.map((n, i) => {
    if (i === 0 || sorted[i - 1] !== n - 1) event++;
    return { start: clock.nightStart(n), end: clock.nightStart(n + 1) - 1, event };
  });
  return { kind: "nights", windows, eventCount: event + 1 };
}

const built = new Map<QuestionId, Condition>();

/** A question's condition, or null for the two NASA questions (7 and 8),
    whose nights come from NASA's log rather than the sky data. */
export function conditionFor(id: QuestionId): Condition | null {
  const build = BUILDERS[id];
  if (!build) return null;
  let c = built.get(id);
  if (!c) {
    c = build();
    built.set(id, c);
  }
  return c;
}
