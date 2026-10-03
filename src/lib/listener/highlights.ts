import { runStarts } from "@/lib/answers/nightRuns";
import { kpLabel, stormGrade } from "@/lib/space/kp";
import { SPACE_EVENTS, type SpaceEvent } from "@/lib/space/curated";
import { dignitiesOf, type SkyAt, type SkyBody } from "@/lib/sky/sky";
import { eclipseVisible } from "@/lib/sky/visibility";
import type { ZoneClock } from "@/lib/zone";
import { flareSize, type Asteroid } from "./spaceNights";
import { aboutMeters, dateIn, spelled, timeIn } from "./words";

/**
 * Wild nights, song chips, the strangest sky and pairing sentences (spec
 * 7.5, 9.2). Facts with a date and a time, never a cause. SERVER ONLY.
 */

/* ---- What happened on a night -------------------------------------------- */

export interface NightEvents {
  night: number;
  plays: number;
  eclipse: { kind: string; time: number } | null;
  /** The night's highest Kp in NASA's log, or null. */
  kp: number | null;
  /** X flares peaking that night: [peak, class]. */
  xflares: [number, string][];
  /** The night's nearest approach within 0.05 AU. */
  asteroid: Asteroid | null;
}

/* ---- Wild nights ---------------------------------------------------------- */

const ECLIPSE_RANK: Record<string, number> = { "total solar": 0, "annular solar": 1, "total lunar": 2 };
/** A flare this big or bigger makes a night wild, and scores. */
const BIG_FLARE = flareSize("X5");
/** An asteroid about this big or bigger, closer than the Moon, makes a night wild. */
export const WILD_ASTEROID_METERS = 50;

export interface WildNight {
  night: number;
  /** What heads it: 0 total solar eclipse, 1 annular, 2 total lunar, 3 G5
      storm, 4 G4 storm, 5 X5-or-bigger flare, 6 asteroid of about 50 m closer
      than the Moon. The row's order also reads `visible` (`wildOrder`). */
  rank: number;
  /** An eclipse seen from the zone's principal city (7.5); always true for
      the rest. Missing from a version 2 record, which reads as true. */
  visible?: boolean;
  /** Within a rank, bigger first: the Kp, the flare's size or the meters. */
  size: number;
  title: string;
  /** The curated one-line story (7.3), or null when the title is from the log. */
  story: string | null;
  /** The curated event, when the title is curated. */
  eventId: string | null;
  /** A storm-headed night's best other reason (a flare, say). When the
      storm's card is another night's, this heads the night's own (7.5). */
  then?: WildNight | null;
  /** A storm-headed night's storm, as the first night of its run: the
      consecutive nights NASA logged a storm on, plays or not, which are
      question 7's events (6.2, rule 3, `nightRuns`). One card per run (7.5).
      Missing from a version 3 record, whose runs are read from neighboring
      storm-headed nights instead. */
  stormRun?: number;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (word: string) => (/^[aeiou]|^X/i.test(word) ? "an" : "a");

/**
 * The row's order (7.5, changed 2 Oct 2026): total solar, annular and total
 * lunar eclipses seen from the zone; G5 storms; G4 storms; then the eclipses
 * not seen from it, in the same order; then X5 flares; then asteroids.
 */
export function wildOrder(rank: number, visible = true): number {
  if (rank <= 2) return visible ? rank : rank + 5;
  return rank <= 4 ? rank : rank + 3;
}

/** A night's wild reason, headed by its highest-ranked event (7.5), or null. */
export function wildNight(e: NightEvents, clock: ZoneClock, events: SpaceEvent[] = SPACE_EVENTS): WildNight | null {
  if (e.plays < 1) return null;
  const reasons: { rank: number; size: number; visible: boolean; kind: SpaceEvent["kind"]; logTitle: string }[] = [];
  const add = (rank: number, size: number, kind: SpaceEvent["kind"], logTitle: string, visible = true) =>
    reasons.push({ rank, size, visible, kind, logTitle });
  if (e.eclipse && e.eclipse.kind in ECLIPSE_RANK) {
    const visible = eclipseVisible(clock.zone, e.eclipse.kind, e.eclipse.time);
    add(ECLIPSE_RANK[e.eclipse.kind], 0, "eclipse", `${capital(article(e.eclipse.kind))} ${e.eclipse.kind} eclipse`, visible);
  }
  if (e.kp !== null) {
    const grade = stormGrade(e.kp);
    if (grade === "G5" || grade === "G4") add(grade === "G5" ? 3 : 4, e.kp, "storm", `A ${grade} storm, ${kpLabel(e.kp)}`);
  }
  const bigFlare = e.xflares.reduce<string | null>((a, [, c]) => (!a || flareSize(c) > flareSize(a) ? c : a), null);
  if (bigFlare && flareSize(bigFlare) >= BIG_FLARE) add(5, flareSize(bigFlare), "flare", `An ${bigFlare} flare`);
  if (e.asteroid && e.asteroid.ld < 1 && e.asteroid.meters !== null && e.asteroid.meters >= WILD_ASTEROID_METERS) {
    add(6, e.asteroid.meters, "asteroid", `An asteroid ${aboutMeters(e.asteroid.meters)} wide, closer than the Moon`);
  }
  if (reasons.length === 0) return null;
  const ordered = reasons.sort((a, b) => wildOrder(a.rank, a.visible) - wildOrder(b.rank, b.visible) || b.size - a.size);
  const card = (r: (typeof reasons)[number]): WildNight => {
    const curated = events.find((ev) => ev.kind === r.kind && clock.nightOf(Date.parse(ev.at) / 1000) === e.night);
    return {
      night: e.night,
      rank: r.rank,
      visible: r.visible,
      size: r.size,
      title: curated?.title ?? r.logTitle,
      story: curated?.story ?? null,
      eventId: curated?.id ?? null,
    };
  };
  const head = card(ordered[0]);
  // A storm can head two nights in a row; if this one's card goes to the
  // other night, the night keeps its next reason (7.5).
  const other = ordered[0].kind === "storm" ? ordered.find((r) => r.kind !== "storm") : undefined;
  return other ? { ...head, then: card(other) } : head;
}

/** The row's order, bigger first within a rank, then newest first (7.5). */
export const byWildness = (a: WildNight, b: WildNight) =>
  wildOrder(a.rank, a.visible ?? true) - wildOrder(b.rank, b.visible ?? true) || b.size - a.size || b.night - a.night;

/** Headed by a G5 or G4 storm. */
export const isStormHeaded = (w: Pick<WildNight, "rank">) => w.rank === 3 || w.rank === 4;

/**
 * One event, one card (7.5, changed 2 Oct 2026). A storm is one event for as
 * many nights in a row as NASA logged it (6.2, rule 3), the same runs
 * question 7 counts, so a night with no plays, or one an eclipse heads,
 * doesn't split it. Its card is the storm-headed night with the higher
 * reading, on a tie the night with a curated title, then the earlier. Only a
 * storm can: an eclipse, a flare's peak and an asteroid's closest approach
 * are each one instant, so one night. A night whose storm card goes to
 * another night keeps a card for its next reason, if it has one (an X5.8
 * flare the same night). Every night stays wild for the glow and the filter;
 * this is the row and the reveal, in the row's order (7.5).
 */
export function oneCardPerEvent(wild: WildNight[]): WildNight[] {
  const storms = wild.filter(isStormHeaded).sort((a, b) => a.night - b.night);
  // A version 3 record carries no runs: its storm-headed neighbors make them.
  const older = runStarts(storms.filter((w) => w.stormRun === undefined).map((w) => w.night));
  const best = new Map<number, WildNight>();
  for (const w of storms) {
    const run = w.stormRun ?? older.get(w.night)!;
    const b = best.get(run);
    if (!b || w.size > b.size || (w.size === b.size && w.eventId !== null && b.eventId === null)) best.set(run, w);
  }
  const keep = new Set([...best.values()].map((w) => w.night));
  return wild.flatMap((w) => (!isStormHeaded(w) || keep.has(w.night) ? [w] : w.then ? [w.then] : [])).sort(byWildness);
}

/* ---- Song chips, scores and pairings ------------------------------------- */

const HOME_OR_EXALTED: SkyBody[] = ["Venus", "Mars", "Moon"];
const RETROGRADE_ORDER: SkyBody[] = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const BODY_WORD = (b: SkyBody) => (b === "Moon" ? "the Moon" : b === "Sun" ? "the Sun" : b);

export type Chip =
  | { kind: "eclipse"; eclipse: string }
  | { kind: "storm"; kp: number }
  | { kind: "flare"; cls: string; minutes: number }
  | { kind: "asteroid"; meters: number | null }
  | { kind: "pair"; bodies: { body: SkyBody; dignity: "home" | "exalted" }[] }
  | { kind: "home"; body: SkyBody }
  | { kind: "moon"; phase: "full" | "new" }
  | { kind: "retrograde"; body: SkyBody }
  | { kind: "fireball"; minutes: number };

/** Everything a song's first-play minute is checked against. */
export interface FirstPlaySky {
  uts: number;
  night: NightEvents;
  sky: SkyAt;
  /** Fireball times anywhere near the first play. */
  fireballs: number[];
  /** X flares peaking near the first play, whichever night they're on: a
      3:50 a.m. peak is within the hour of a 4:10 a.m. play. Without it, the
      night's own flares. */
  flares?: [number, string][];
}

/** Venus, Mars and the Moon at home or exalted, in that order (7.5). */
const strongOf = (sky: SkyAt) =>
  HOME_OR_EXALTED.map((body) => sky.bodies.find((b) => b.body === body)!)
    .flatMap((b) => {
      const d = dignitiesOf(b.body, b.sign);
      const best = d.includes("home") ? "home" : d.includes("exalted") ? "exalted" : null;
      return best ? [{ body: b.body, dignity: best as "home" | "exalted" }] : [];
    });

/** The biggest X flare peaking within an hour of the first play. */
function flareNear(f: FirstPlaySky): { cls: string; minutes: number } | null {
  let best: { cls: string; minutes: number } | null = null;
  for (const [peak, cls] of f.flares ?? f.night.xflares) {
    const minutes = Math.abs(peak - f.uts) / 60;
    if (minutes <= 60 && (!best || flareSize(cls) > flareSize(best.cls))) best = { cls, minutes };
  }
  return best;
}

/** The highlight chip: the first that applies (7.5), or null. */
export function chipFor(f: FirstPlaySky): Chip | null {
  if (f.night.eclipse) return { kind: "eclipse", eclipse: f.night.eclipse.kind };
  if (f.night.kp !== null) return { kind: "storm", kp: f.night.kp };
  const flare = flareNear(f);
  if (flare) return { kind: "flare", ...flare };
  if (f.night.asteroid && f.night.asteroid.ld < 1) return { kind: "asteroid", meters: f.night.asteroid.meters };
  const strong = strongOf(f.sky);
  if (strong.length >= 2) return { kind: "pair", bodies: strong };
  const home = f.sky.bodies.find((b) => dignitiesOf(b.body, b.sign).includes("home"));
  if (home) return { kind: "home", body: home.body };
  if (f.sky.conditions.includes("fullmoon")) return { kind: "moon", phase: "full" };
  if (f.sky.conditions.includes("newmoon")) return { kind: "moon", phase: "new" };
  const rx = RETROGRADE_ORDER.find((body) => f.sky.bodies.find((b) => b.body === body)?.retrograde);
  if (rx) return { kind: "retrograde", body: rx };
  const fireball = f.fireballs.reduce<number | null>((a, t) => (a === null || Math.abs(t - f.uts) < Math.abs(a - f.uts) ? t : a), null);
  if (fireball !== null && Math.abs(fireball - f.uts) <= 6 * 3600) return { kind: "fireball", minutes: (f.uts - fireball) / 60 };
  return null;
}

const listBodies = (bodies: { body: SkyBody; dignity: string }[]) => {
  const names = bodies.map((b) => BODY_WORD(b.body));
  const joined = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const same = bodies.every((b) => b.dignity === bodies[0].dignity);
  if (same) return `${capital(joined)} ${names.length === 2 ? "both" : "all"} ${bodies[0].dignity === "home" ? "at home" : "exalted"}`;
  return capital(bodies.map((b) => `${BODY_WORD(b.body)} ${b.dignity === "home" ? "at home" : "exalted"}`).join(", "));
};

const hoursWords = (minutes: number) => {
  const h = Math.round(Math.abs(minutes) / 60);
  return `${spelled(h)} hour${h === 1 ? "" : "s"}`;
};

/** The chip's words (7.5): "Solar storm, Kp 9", "X9.0 flare, that minute". */
export function chipText(c: Chip): string {
  switch (c.kind) {
    case "eclipse":
      return `${capital(c.eclipse)} eclipse`;
    case "storm":
      return `Solar storm, ${kpLabel(c.kp)}`;
    case "flare":
      return `${c.cls} flare, ${c.minutes <= 5 ? "that minute" : "within the hour"}`;
    case "asteroid":
      return c.meters === null ? "Asteroid closer than the Moon" : `${aboutMeters(c.meters).replace("about ", "")} asteroid`;
    case "pair":
      return listBodies(c.bodies);
    case "home":
      return `${capital(BODY_WORD(c.body))} at home`;
    case "moon":
      return c.phase === "full" ? "Full moon" : "New moon";
    case "retrograde":
      return `${c.body} retrograde`;
    case "fireball":
      return Math.abs(c.minutes) < 60
        ? "Fireball, within the hour"
        : `Fireball, ${hoursWords(c.minutes)} ${c.minutes > 0 ? "earlier" : "later"}`;
  }
}

/** The strangest-sky score (7.5): eclipse night 3, X5-or-bigger flare
    within the hour 3, G4 or G5 storm night 2, asteroid under 1 lunar
    distance that night 2, Venus, Mars and the Moon 1 each at home or
    exalted, a full or new moon window 1. */
export function strangeness(f: FirstPlaySky): number {
  let score = 0;
  if (f.night.eclipse) score += 3;
  const flare = flareNear(f);
  if (flare && flareSize(flare.cls) >= BIG_FLARE) score += 3;
  if (f.night.kp !== null && (stormGrade(f.night.kp) === "G4" || stormGrade(f.night.kp) === "G5")) score += 2;
  if (f.night.asteroid && f.night.asteroid.ld < 1) score += 2;
  score += strongOf(f.sky).length;
  if (f.sky.conditions.includes("fullmoon") || f.sky.conditions.includes("newmoon")) score += 1;
  return score;
}

/**
 * The pairing sentence (9.2): "You first played Apple at 7:18 a.m. CDT on
 * Oct 3, 2024, the minute an X9.0 flare peaked." Null without a chip: then
 * there's no pairing to state.
 */
export function pairingSentence(
  track: string,
  zone: string,
  f: FirstPlaySky,
  chip: Chip | null,
  stormSpans: [number, number, number][],
  clock: ZoneClock,
  events: SpaceEvent[] = SPACE_EVENTS,
): string | null {
  const fact = pairingFact(f, chip, stormSpans, clock, events);
  return fact ? `You first played ${track} at ${timeIn(zone, f.uts)} on ${dateIn(zone, f.uts)}, ${fact}.` : null;
}

/**
 * The pairing's closing clause: "the minute an X9.0 flare peaked". A storm
 * is "during" only when the first play falls inside one of its readings;
 * otherwise "on the night of".
 */
export function pairingFact(
  f: FirstPlaySky,
  chip: Chip | null,
  stormSpans: [number, number, number][],
  clock: ZoneClock,
  events: SpaceEvent[] = SPACE_EVENTS,
): string | null {
  if (!chip) return null;
  const curated = (kind: string) =>
    events.find((ev) => ev.kind === kind && clock.nightOf(Date.parse(ev.at) / 1000) === f.night.night);
  // Inside a sentence: "the Moon", "the strongest storm", but "Venus" stays.
  const lower = (title: string) => (/^(The|A|An) /.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title);
  let fact: string;
  switch (chip.kind) {
    case "eclipse":
      fact = `the night of ${article(chip.eclipse)} ${chip.eclipse} eclipse`;
      break;
    case "storm": {
      const during = stormSpans.some(([s, e]) => f.uts >= s && f.uts <= e);
      const ev = curated("storm");
      const what = ev ? lower(ev.title) : `a ${stormGrade(chip.kp) ?? "geomagnetic"} storm (${kpLabel(chip.kp)})`;
      fact = during ? `during ${what}` : `on the night of ${what}`;
      break;
    }
    case "flare":
      fact = chip.minutes <= 5 ? `the minute ${article(chip.cls)} ${chip.cls} flare peaked` : `within an hour of ${article(chip.cls)} ${chip.cls} flare's peak`;
      break;
    case "asteroid":
      fact =
        chip.meters === null
          ? "the night an asteroid passed closer than the Moon"
          : `the night an asteroid ${aboutMeters(chip.meters)} wide passed closer than the Moon`;
      break;
    case "pair":
      fact = `with ${lower(listBodies(chip.bodies))}`;
      break;
    case "home":
      fact = `with ${BODY_WORD(chip.body)} at home`;
      break;
    case "moon":
      fact = `in a ${chip.phase} moon window`;
      break;
    case "retrograde":
      fact = `with ${chip.body} retrograde`;
      break;
    case "fireball":
      fact =
        Math.abs(chip.minutes) < 60
          ? "within an hour of a fireball"
          : `about ${hoursWords(chip.minutes)} ${chip.minutes > 0 ? "after" : "before"} a fireball`;
      break;
  }
  return fact;
}
