import { MakeTime, SearchMoonPhase } from "astronomy-engine";
import { conditionFor } from "@/lib/answers/conditions";
import { QUESTIONS, type Question } from "@/lib/answers/questions";
import { nightDate, timeIn } from "@/lib/listener/words";
import { happenedWhen, startsWhen } from "@/lib/listener/when";
import { nightName, nightWeekday, zoneClock } from "@/lib/zone";
import {
  DIGNITY_TABLE,
  haloDignity,
  pronounOf,
  type Dignity,
  type Sign,
  type SkyAtWithWords,
  type SkyBody,
} from "./sky";
import { moonEvents, retrogradeWindows, signWindows, type MoonEvent } from "./windows";

/**
 * The top of Tonight (spec 8.4, item 2, and item 3's "none overhead" line):
 * the heading, the time, the Moon's line, up to three sky chips, every
 * planet's words for the wheel and the practitioners' disclosure, and any
 * mutual reception. Every sentence is built here, so the client only lays it
 * out. SERVER ONLY: it reads the generated sky windows.
 */

const DAY = 86_400;
const HOUR = 3_600;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const uts = (iso: string) => Date.parse(iso) / 1000;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Mars", "the Sun", "the Moon", for the middle of a sentence. */
const bodyName = (body: SkyBody) => (body === "Sun" || body === "Moon" ? `the ${body}` : body);

/* ---- The heading (8.4) ----------------------------------------------------- */

/**
 * By local time: 0:00 to 3:59, the night before ("Monday night, Sept 28" at
 * 1 a.m. Tuesday); 4:00 to 15:59, "Tuesday, Sept 29"; 16:00 to 23:59,
 * "Tuesday night, Sept 29". A night runs 4 a.m. to 4 a.m. (7.1), so the date
 * is always the night's.
 */
export function tonightHeading(zone: string, now: number): string {
  const clock = zoneClock(zone, now);
  const hour = new Date(clock.localSeconds(now) * 1000).getUTCHours();
  const night = clock.nightOf(now);
  const date = nightDate(nightName(night)).replace(/, \d{4}$/, "");
  const weekday = WEEKDAYS[nightWeekday(night)];
  return hour >= 4 && hour < 16 ? `${weekday}, ${date}` : `${weekday} night, ${date}`;
}

/* ---- The Moon (8.4) -------------------------------------------------------- */

export type PhaseName =
  | "new"
  | "waxing crescent"
  | "first quarter"
  | "waxing gibbous"
  | "full"
  | "waning gibbous"
  | "last quarter"
  | "waning crescent";

const PHASE_LABEL: Record<PhaseName, string> = {
  new: "New moon",
  "waxing crescent": "Waxing crescent",
  "first quarter": "First quarter",
  "waxing gibbous": "Waxing gibbous",
  full: "Full moon",
  "waning gibbous": "Waning gibbous",
  "last quarter": "Last quarter",
  "waning crescent": "Waning crescent",
};

const inMoonWindow = (phase: MoonEvent["phase"], t: number) =>
  moonEvents.some((e) => e.phase === phase && uts(e.start) <= t && t <= uts(e.end));

/** A quarter is named for 12 hours either side of its exact instant. */
export const QUARTER_WINDOW_SECONDS = 12 * HOUR;

/** A quarter moon (90 first, 270 last) within 12 hours of `t`. */
function quarterNear(phase: 90 | 270, t: number): boolean {
  const found = SearchMoonPhase(phase, MakeTime(new Date((t - QUARTER_WINDOW_SECONDS) * 1000)), 1.1);
  return !!found && Math.abs(found.date.getTime() / 1000 - t) <= QUARTER_WINDOW_SECONDS;
}

/**
 * The phase's name. Full and new are the sky data's own windows, 36 hours
 * either side of the exact instant, so the Moon's line agrees with the "Full
 * moon" chip and with questions 2 and 3 for as long as they count it. In
 * those 36 hours her light stays within about 3 points of full or new. A
 * quarter has no question, and her light changes about three times as fast
 * there, so it's named for the day centered on its instant, 12 hours either
 * side, while she's within about 6 points of half lit. (36 hours would call
 * a 67%-lit Moon a quarter.) Otherwise waxing or waning by the phase angle
 * (under 180 is waxing), crescent or gibbous by which side of a quarter
 * she's on.
 */
export function phaseName(t: number, phaseAngle: number): PhaseName {
  if (inMoonWindow("full", t)) return "full";
  if (inMoonWindow("new", t)) return "new";
  if (quarterNear(90, t)) return "first quarter";
  if (quarterNear(270, t)) return "last quarter";
  const waxing = phaseAngle < 180;
  const crescent = phaseAngle < 90 || phaseAngle >= 270;
  return `${waxing ? "waxing" : "waning"} ${crescent ? "crescent" : "gibbous"}`;
}

/**
 * How far the nearest full or new moon is, from the sky data's exact
 * instants, never the phase angle: "less than an hour after full", "an hour
 * before new", "8 hours after full", "a day before new", "2 days after
 * full". Hours under a day, then whole days rounded, so it's the same in
 * every zone.
 */
export function moonContext(t: number): string | null {
  let nearest: MoonEvent | null = null;
  for (const e of moonEvents) {
    if (!nearest || Math.abs(uts(e.peak) - t) < Math.abs(uts(nearest.peak) - t)) nearest = e;
  }
  if (!nearest) return null;
  const span = Math.abs(t - uts(nearest.peak));
  const hours = Math.round(span / HOUR);
  const days = Math.round(span / DAY);
  const amount =
    span < HOUR ? "less than an hour" : hours < 24 ? (hours === 1 ? "an hour" : `${hours} hours`) : days === 1 ? "a day" : `${days} days`;
  return `${amount} ${t >= uts(nearest.peak) ? "after" : "before"} ${nearest.phase}`;
}

/** "where she's exalted" and the rest (8.4); nothing in a neutral sign. */
const MOON_DIGNITY: Record<Dignity, string> = {
  home: ", at home",
  exalted: ", where she's exalted",
  detriment: ", in her detriment",
  fall: ", in her fall",
};

export interface TonightMoon {
  phaseName: PhaseName;
  /** Whole percent lit. */
  illumination: number;
  /** "Waning gibbous, 93% lit" */
  label: string;
  /** "Waning gibbous, 93% lit · 2 days after full, in Taurus, where she's exalted" */
  line: string;
}

export function tonightMoon(t: number, moon: { phaseAngle: number; illumination: number; sign: Sign }): TonightMoon {
  const name = phaseName(t, moon.phaseAngle);
  const illumination = Math.round(moon.illumination * 100);
  const label = `${PHASE_LABEL[name]}, ${illumination}% lit`;
  const dignity = haloDignity("Moon", moon.sign);
  const where = `in ${moon.sign}${dignity === "neutral" ? "" : MOON_DIGNITY[dignity]}`;
  const context = moonContext(t);
  return { phaseName: name, illumination, label, line: `${label} · ${context ? `${context}, ` : ""}${where}` };
}

/* ---- The chips (8.4) ------------------------------------------------------- */

export interface TonightChip {
  kind: "station" | "sign" | "dignity" | "moon";
  body?: SkyBody;
  /** The standing the halo shows, when the body has one. */
  dignity?: Dignity;
  text: string;
}

export const CHIPS_MAX = 3;
/** A station this close, before or after now, gets a chip. */
export const STATION_CHIP_SECONDS = 3 * DAY;
/** A sign change this recent gets a chip. */
export const SIGN_CHIP_SECONDS = 2 * DAY;
/** Sign changes worth a chip. The Moon changes sign every two or three days,
    so she'd always take one; her sign is in her line and her dignity chip. */
const SIGN_CHIP_BODIES: readonly SkyBody[] = ["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
/** The bodies a question tests, in the order spec 8.7.4 lists their questions. */
const DIGNITY_CHIP_BODIES: readonly SkyBody[] = ["Venus", "Mars", "Moon", "Mercury"];

const standing = (body: SkyBody, sign: Sign): Dignity | undefined => {
  const d = haloDignity(body, sign);
  return d === "neutral" ? undefined : d;
};

/**
 * Up to three, in spec 8.4's order: a station within 3 days either way; a
 * sign change in the last 2 days (the Moon's aside); Venus, Mars, the Moon
 * or Mercury at home, exalted, in detriment or in fall; a full or new moon
 * window. Stations nearest first, sign changes newest first. A body with a
 * sign chip doesn't get a dignity chip too: its sign chip carries the
 * dignity for the halo.
 */
export function tonightChips(zone: string, now: number, sky: SkyAtWithWords): TonightChip[] {
  const chips: TonightChip[] = [];

  const stations: { t: number; chip: TonightChip }[] = [];
  for (const w of retrogradeWindows) {
    for (const [t, turn] of [[uts(w.start), "retrograde"], [uts(w.end), "direct"]] as const) {
      if (Math.abs(t - now) > STATION_CHIP_SECONDS) continue;
      const her = pronounOf(w.body);
      const text =
        t > now
          ? `${w.body} ${turn === "retrograde" ? "turns retrograde" : `ends ${her} retrograde`} ${startsWhen(zone, now, t)}`
          : `${w.body} ${turn === "retrograde" ? "turned retrograde" : `ended ${her} retrograde`} ${happenedWhen(zone, now, t)}`;
      stations.push({ t, chip: { kind: "station", body: w.body, text } });
    }
  }
  chips.push(...stations.sort((a, b) => Math.abs(a.t - now) - Math.abs(b.t - now)).map((s) => s.chip));

  const entered = signWindows
    .filter((w) => SIGN_CHIP_BODIES.includes(w.body) && uts(w.start) <= now && now - uts(w.start) <= SIGN_CHIP_SECONDS)
    .sort((a, b) => uts(b.start) - uts(a.start));
  for (const w of entered) {
    const verb = w.retrogradeAtStart ? "just backed into" : "just entered";
    const dignity = standing(w.body, w.sign);
    chips.push({ kind: "sign", body: w.body, ...(dignity ? { dignity } : {}), text: `${capital(bodyName(w.body))} ${verb} ${w.sign}` });
  }

  for (const body of DIGNITY_CHIP_BODIES) {
    const b = sky.bodies.find((x) => x.body === body)!;
    const dignity = standing(body, b.sign);
    if (!dignity || entered.some((w) => w.body === body)) continue;
    chips.push({ kind: "dignity", body, dignity, text: b.line });
  }

  if (inMoonWindow("full", now)) chips.push({ kind: "moon", text: "Full moon" });
  if (inMoonWindow("new", now)) chips.push({ kind: "moon", text: "New moon" });

  return chips.slice(0, CHIPS_MAX);
}

/* ---- Every planet, and mutual receptions ------------------------------------ */

export interface TonightPlanet {
  body: SkyBody;
  sign: Sign;
  degreeText: string;
  dignity: Dignity | "neutral";
  retrograde: boolean;
  line: string;
  detail: string;
  name: string;
}

/**
 * Pairs each in a sign the other rules, by domicile: "Venus and Mars are each
 * in a sign the other rules · mutual reception". A body at home in its own
 * sign isn't one.
 */
export function receptions(bodies: readonly { body: SkyBody; sign: Sign }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (DIGNITY_TABLE[b.body].home.includes(a.sign) && DIGNITY_TABLE[a.body].home.includes(b.sign)) {
        out.push(`${capital(bodyName(a.body))} and ${bodyName(b.body)} are each in a sign the other rules · mutual reception`);
      }
    }
  }
  return out;
}

/* ---- None overhead (8.4, item 3) -------------------------------------------- */

/**
 * "None of the 12 questions' skies is overhead tonight. Next: a full moon
 * begins Sunday." The next is the sky question whose condition starts
 * soonest (NASA's two can't be foreseen), named by its spec 9.2 subject, the
 * day by `startsWhen`. Null while any question is overhead. When NASA's log
 * didn't load, storms and flares can't be checked: no count, and it says why
 * (architect, 2 Oct 2026).
 */
export function noneOverhead(zone: string, now: number, questionsHeld: readonly string[], nasaLoaded = true): string | null {
  if (questionsHeld.length > 0) return null;
  let next: { start: number; q: Question } | null = null;
  for (const q of QUESTIONS) {
    if (q.nasa) continue;
    const w = conditionFor(q.id)?.windows.find((x) => x.start > now);
    if (w && (!next || w.start < next.start)) next = { start: w.start, q };
  }
  const none = nasaLoaded
    ? "None of the 12 questions' skies is overhead tonight."
    : "None of these skies is overhead tonight. NASA's log didn't load, so storms and flares can't be checked.";
  const when = next ? startsWhen(zone, now, next.start) : null;
  return next && when ? `${none} Next: ${next.q.subject} begins ${when}.` : none;
}

/* ---- All of it ------------------------------------------------------------- */

export interface Tonight {
  heading: string;
  /** "The sky right now, 10:00 p.m. CDT" */
  timeLine: string;
  moon: TonightMoon;
  chips: TonightChip[];
  planets: TonightPlanet[];
  receptions: string[];
  noneOverhead: string | null;
}

export function tonightSky({
  now,
  zone,
  sky,
  questionsHeld,
  nasaLoaded = true,
}: {
  now: number;
  zone: string;
  sky: SkyAtWithWords;
  questionsHeld: readonly string[];
  /** Whether NASA's log read, so storms and flares were checked. */
  nasaLoaded?: boolean;
}): Tonight {
  return {
    heading: tonightHeading(zone, now),
    timeLine: `The sky right now, ${timeIn(zone, now)}`,
    moon: tonightMoon(now, sky.moon),
    chips: tonightChips(zone, now, sky),
    planets: sky.bodies.map((b) => ({
      body: b.body,
      sign: b.sign,
      degreeText: b.degreeText,
      dignity: b.dignity,
      retrograde: b.retrograde,
      line: b.line,
      detail: b.detail,
      name: b.name,
    })),
    receptions: receptions(sky.bodies),
    noneOverhead: noneOverhead(zone, now, questionsHeld, nasaLoaded),
  };
}
