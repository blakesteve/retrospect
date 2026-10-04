import { kpLabel } from "@/lib/space/kp";
import { oneCardPerEvent, type WildNight } from "./highlights";
import type { ListenerRecord } from "./record";
import type { SpaceNight } from "./spaceNights";
import type { DialMarks } from "@/lib/client/dial";

/**
 * The Sky view's dial (spec 8.6, item 3; 11): the whole history as one
 * compact series, a night at a time from the history's first night to
 * tonight, with the ticks the track draws. SERVER ONLY. Every mark is
 * `[offset, ...]`, the night's place in `plays` (0 for the first night), in
 * night order.
 */

/* The marks' shape is the client's (`DialMarks` in `src/lib/client/dial.ts`),
   so the route and the dial can't drift apart. */
export type { DialMarks };

export const NO_MARKS: DialMarks = { storm: [], xflare: [], eclipse: [], asteroid: [], wild: [] };

/** Plays per night from `first` to `tonight`, 0 for a night with none;
    tonight's so far. Empty when tonight comes before the first night. */
export function dialPlays(nights: ListenerRecord["nights"], first: number, tonight: number): number[] {
  const plays = new Array<number>(Math.max(0, tonight - first + 1)).fill(0);
  for (const [night, count] of nights) if (night >= first && night <= tonight) plays[night - first] = count;
  return plays;
}

/**
 * The ticks, only on nights with at least one play, as Every night's
 * filters count them (7.5, 8.5), so a tick never sits on an empty stretch
 * of the waveform:
 *
 * - storm: the night's highest Kp as NOAA writes it, as a door's name reads
 *   it (7.3, 11).
 * - xflare: the night's biggest flare, an X class.
 * - eclipse: the kind of the eclipse whose greatest moment fell that night.
 * - asteroid: the night's offset alone, when an asteroid came closer than
 *   the Moon (one lunar distance): the dial flashes it and says so, and
 *   names none, so the names would be a third of the answer for nothing.
 * - wild: every wild night (the glow), with whether it heads its event. A
 *   storm that runs on past 4 a.m. is one event, headed by one night (7.5,
 *   "One event, one card"); the run's other nights glow but don't head it.
 *   A night whose storm card went to another night keeps a card for its next
 *   reason (an X5.8 flare the same night), and heads that, under its rank
 *   and title, as the Tonight row shows it.
 *
 * `space` is null when NASA's log is unavailable: the storm, flare and
 * asteroid ticks are left out (8.5), and the eclipses and wild nights stay.
 */
export function dialMarks(
  plays: number[],
  first: number,
  eclipse: Map<number, { kind: string }>,
  space: Map<number, SpaceNight> | null,
  wild: WildNight[],
): DialMarks {
  const listened = (night: number) => (plays[night - first] ?? 0) > 0;
  const marks: DialMarks = { storm: [], xflare: [], eclipse: [], asteroid: [], wild: [] };
  for (let i = 0; i < plays.length; i++) {
    const night = first + i;
    if (!listened(night)) continue;
    const s = space?.get(night);
    if (s && s.kp !== null) marks.storm.push([i, kpLabel(s.kp)]);
    if (s?.xFlare && s.biggestFlare) marks.xflare.push([i, s.biggestFlare]);
    const e = eclipse.get(night);
    if (e) marks.eclipse.push([i, e.kind]);
    if (s?.asteroid && s.asteroid.ld < 1) marks.asteroid.push(i);
  }
  const cards = new Map(oneCardPerEvent(wild).map((card) => [card.night, card]));
  for (const w of [...wild].sort((a, b) => a.night - b.night)) {
    if (!listened(w.night)) continue;
    const card = cards.get(w.night);
    const shown = card ?? w;
    marks.wild.push([w.night - first, shown.rank, shown.title, card !== undefined]);
  }
  return marks;
}
