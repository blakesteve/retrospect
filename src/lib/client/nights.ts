/**
 * Every night's calendar as plain logic (spec 8.5, 11): the months, the
 * weeks, where a key moves the focused night, what a door is called, and
 * what the filter dock says. The routes write the sky's sentences; these are
 * the calendar's own words. No data, so the browser imports it.
 */
import type { QuestionId } from "@/lib/answers/questions";

import { addDays, dateText, daysIn, MONTHS, shiftMonth, weekdayOf, WEEKDAYS, type NightDate } from "./dates";
export { addDays, daysIn, shiftMonth, weekdayOf, WEEKDAYS, dateText, type NightDate } from "./dates";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "May 2024" */
export const monthTitle = (month: string) => `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** "Sept 2024": the year strip's label, one line in its column (8.5). */
export const monthShort = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Every month from first to last ("YYYY-MM"), newest first (8.5 item 3). */
export function monthsNewestFirst(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = last; m >= first; m = shiftMonth(m, -1)) out.push(m);
  return out;
}

/** A month's weeks, Sunday first: each a row of 7, null where the day belongs to another month. */
export function monthWeeks(month: string): (NightDate | null)[][] {
  const cells: (NightDate | null)[] = Array(weekdayOf(`${month}-01`)).fill(null);
  for (let d = 1; d <= daysIn(month); d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/**
 * Where a key moves the focused night (11): keys move in time, not on
 * screen. Right and Left one night later or earlier, Down and Up seven
 * nights, Page Down and Page Up a month (the same day, or the month's last),
 * Home and End the week's Sunday and Saturday. Never before the history's
 * first night or after tonight. Null for any other key.
 */
export function stepNight(date: NightDate, key: string, first: NightDate, last: NightDate): NightDate | null {
  let next: NightDate;
  switch (key) {
    case "ArrowRight":
      next = addDays(date, 1);
      break;
    case "ArrowLeft":
      next = addDays(date, -1);
      break;
    case "ArrowDown":
      next = addDays(date, 7);
      break;
    case "ArrowUp":
      next = addDays(date, -7);
      break;
    case "PageDown":
    case "PageUp": {
      const month = shiftMonth(date.slice(0, 7), key === "PageDown" ? 1 : -1);
      next = `${month}-${String(Math.min(Number(date.slice(8, 10)), daysIn(month))).padStart(2, "0")}`;
      break;
    }
    case "Home":
      next = addDays(date, -weekdayOf(date));
      break;
    case "End":
      next = addDays(date, 6 - weekdayOf(date));
      break;
    default:
      return null;
  }
  return next < first ? first : next > last ? last : next;
}

/** The same day `k` months on (or the month's last), held between the history's first night and tonight. */
function pageBy(date: NightDate, k: number, first: NightDate, last: NightDate): NightDate {
  const month = shiftMonth(date.slice(0, 7), k);
  const next = `${month}-${String(Math.min(Number(date.slice(8, 10)), daysIn(month))).padStart(2, "0")}`;
  return next < first ? first : next > last ? last : next;
}

/**
 * Where a key moves the focused night when some nights can't be doors (a
 * filter folded their month, or their year didn't load): on past them in
 * the same direction. Page Up and Page Down keep the day of the month they
 * started from; the other keys step on night by night or week by week.
 * Null when nothing that way can be a door, so focus stays where it is.
 */
export function stepPast(date: NightDate, key: string, first: NightDate, last: NightDate, skip: (night: NightDate) => boolean): NightDate | null {
  let next = stepNight(date, key, first, last);
  for (let k = 2; next && skip(next) && k < 8000; k++) {
    const on = key === "PageUp" || key === "PageDown" ? pageBy(date, key === "PageDown" ? k : -k, first, last) : stepNight(next, key, first, last);
    next = on === next ? null : on;
  }
  return next;
}

/** How a night's plays compare with a usual night of its weekday, 0 (none) to 4 (half again or more), for its door's fill. */
export function playsLevel(plays: number, usual: number | null): 0 | 1 | 2 | 3 | 4 {
  if (plays <= 0) return 0;
  if (!usual) return 2;
  const r = plays / usual;
  return r < 0.5 ? 1 : r < 1 ? 2 : r < 1.5 ? 3 : 4;
}

export interface DoorFacts {
  date: NightDate;
  plays: number;
  usual: number | null;
  tonight: boolean;
  /** The Moon's phase name at 9 p.m.: "Waxing crescent", "Full moon"; null while the night isn't known. */
  moon: string | null;
  /** An eclipse's kind: "total solar", "penumbral lunar". */
  eclipse: string | null;
  /** "Kp 9" */
  kp: string | null;
  /** "X5.8" */
  flare: string | null;
  /** An asteroid passed closer than the Moon. */
  asteroid: boolean;
  firstHeard: { track: string; artist: string }[];
  /** A wild night's title (7.5). */
  wild: string | null;
  /** Lit by the filter that's on. */
  lit: boolean;
}

/**
 * A door's accessible name (11): "Friday, May 10, 2024. 39 plays, 7 fewer
 * than a usual Friday. Waxing crescent Moon. Solar storm, Kp 9. X5.8 flare.
 * First heard Good Luck, Babe! by Chappell Roan." A night with no plays says
 * "no listening". What the door shows only by its look is said here too:
 * a wild night's glow, and a filter's light (1.4.1).
 */
export function doorName(f: DoorFacts): string {
  const weekday = WEEKDAYS[weekdayOf(f.date)];
  const parts = [`${f.tonight ? "Tonight, " : ""}${weekday}, ${dateText(f.date)}.`];
  if (f.plays === 0) parts.push(f.tonight ? "No listening yet." : "No listening.");
  else {
    const plays = `${f.plays.toLocaleString("en-US")} play${f.plays === 1 ? "" : "s"}${f.tonight ? " so far" : ""}`;
    const d = f.usual === null ? null : Math.round(f.plays - f.usual);
    parts.push(
      d === null
        ? `${plays}.`
        : d === 0
          ? `${plays}, as many as a usual ${weekday}.`
          : `${plays}, ${Math.abs(d).toLocaleString("en-US")} ${d < 0 ? "fewer" : "more"} than a usual ${weekday}.`,
    );
  }
  if (f.eclipse) parts.push(`${f.eclipse.charAt(0).toUpperCase()}${f.eclipse.slice(1)} eclipse.`);
  else if (f.moon) parts.push(/moon$/.test(f.moon) ? `${f.moon}.` : `${f.moon} Moon.`);
  if (f.kp) parts.push(`Solar storm, ${f.kp}.`);
  if (f.flare) parts.push(`${f.flare} flare.`);
  if (f.asteroid) parts.push("An asteroid passed closer than the Moon.");
  for (const s of f.firstHeard) parts.push(`First heard ${s.track} by ${s.artist}.`);
  if (f.wild) parts.push(`A wild night: ${f.wild}.`);
  if (f.lit) parts.push("Lit by the filter.");
  return parts.join(" ");
}

interface SkyFilter {
  id: string;
  label: string;
  /** The question that tests it, or null. */
  question: QuestionId | null;
  /** Hidden when NASA's data didn't load (8.5). */
  nasa: boolean;
  /** The dock's words alone: "storm night(s) you listened on". */
  alone: [string, string];
  /** With a genre on: "storm night(s) with at least 3 shoegaze plays". */
  kind: [string, string];
}

/** The sky filters, in 8.5's order, with the question that tests each (none for six). */
export const SKY_FILTERS = [
  {
    id: "storm",
    label: "Storm nights",
    question: "storms",
    nasa: true,
    alone: ["storm night you listened on", "storm nights you listened on"],
    kind: ["storm night", "storm nights"],
  },
  {
    id: "xflare",
    label: "X-flare nights",
    question: "flares",
    nasa: true,
    alone: ["X-flare night you listened on", "X-flare nights you listened on"],
    kind: ["X-flare night", "X-flare nights"],
  },
  {
    id: "eclipse",
    label: "Eclipses",
    question: null,
    nasa: false,
    alone: ["eclipse night you listened on", "eclipse nights you listened on"],
    kind: ["eclipse night", "eclipse nights"],
  },
  {
    id: "fullmoon",
    label: "Full moons",
    question: "fullmoon",
    nasa: false,
    alone: ["full moon you listened under", "full moons you listened under"],
    kind: ["full moon night", "full moon nights"],
  },
  {
    id: "newmoon",
    label: "New moons",
    question: "newmoon",
    nasa: false,
    alone: ["new moon you listened under", "new moons you listened under"],
    kind: ["new moon night", "new moon nights"],
  },
  {
    id: "firstplay",
    label: "Your first plays",
    question: null,
    nasa: false,
    alone: ["night you first played one of your songs", "nights you first played one of your songs"],
    kind: ["night of a first play", "nights of first plays"],
  },
  {
    id: "wild",
    label: "Wild nights",
    question: null,
    nasa: false,
    alone: ["wild night you listened on", "wild nights you listened on"],
    kind: ["wild night", "wild nights"],
  },
  {
    id: "venushome",
    label: "Venus at home",
    question: "venushome",
    nasa: false,
    alone: ["night you listened with Venus at home", "nights you listened with Venus at home"],
    kind: ["night with Venus at home", "nights with Venus at home"],
  },
  {
    id: "marshome",
    label: "Mars at home",
    question: null,
    nasa: false,
    alone: ["night you listened with Mars at home", "nights you listened with Mars at home"],
    kind: ["night with Mars at home", "nights with Mars at home"],
  },
  {
    id: "moonstrong",
    label: "Strong Moon",
    question: "moonstrong",
    nasa: false,
    alone: ["night you listened under a strong Moon", "nights you listened under a strong Moon"],
    kind: ["night under a strong Moon", "nights under a strong Moon"],
  },
  {
    id: "asteroid",
    label: "Asteroids closer than the Moon",
    question: null,
    nasa: true,
    alone: ["night you listened as an asteroid passed closer than the Moon", "nights you listened as an asteroid passed closer than the Moon"],
    kind: ["night an asteroid passed closer than the Moon", "nights an asteroid passed closer than the Moon"],
  },
  {
    id: "fireball",
    label: "Fireballs",
    question: null,
    nasa: true,
    alone: ["fireball night you listened on", "fireball nights you listened on"],
    kind: ["fireball night", "fireball nights"],
  },
] as const satisfies readonly SkyFilter[];

export type SkyFilterId = (typeof SKY_FILTERS)[number]["id"];

/** Where NASA's logs start (src/lib/space/sources.ts, copied: the client can't import it). A month before
    a filter's source shows its line once, never "nothing" (7.3). */
export const COVERAGE: Partial<Record<SkyFilterId, { from: string; line: string }>> = {
  storm: { from: "2010-04", line: "NASA's storm log starts in 2010." },
  xflare: { from: "2010-04", line: "NASA's flare log starts in 2010." },
  fireball: { from: "1988-04", line: "NASA's fireball log starts in 1988." },
};

export interface QuestionFacts {
  number: number;
  subject: string;
  word: string;
  /** The question's own events (6.2): for storms and flares, the stretches the dock names. */
  events: number;
}

export interface DockLines {
  /** "92" */
  count: string;
  /** "storm nights you listened on" */
  what: string;
  /** "These make 55 stretches of storm nights for the question · NASA logged 63 solar storms in this time" */
  noun: string | null;
  /** "Coincidence or pattern? Question 7, on solar storms, has the answer." */
  question: string | null;
  /** The reminder that genres aren't tested (7.6). */
  facts: string | null;
}

export const GENRE_FACTS =
  "Facts, not proof. Retrospect doesn't test genres against the sky: with a dozen genres and a dozen skies, chance alone would hand you several 'patterns'.";

/**
 * The filter dock's words (8.5 item 5, 9.2). count is the lit nights you
 * listened on; logged is NASA's own count over the history (storms, or X
 * flares). Stretches are the question's events, so the dock and the
 * question can't disagree; with a genre on they'd count other nights than
 * the lit ones, so they're left out.
 */
export function dockLines(filter: SkyFilterId | null, genre: string | null, count: number, question: QuestionFacts | null, logged: number | null): DockLines {
  const f = filter ? SKY_FILTERS.find((x) => x.id === filter)! : null;
  const n = count === 1 ? 0 : 1;
  const what = f ? (genre ? `${f.kind[n]} with at least 3 ${genre} plays` : f.alone[n]) : `night${count === 1 ? "" : "s"} with at least 3 ${genre} plays`;
  let noun: string | null = null;
  if (f && !genre && question && question.events > 0 && (f.id === "storm" || f.id === "xflare")) {
    const storm = f.id === "storm";
    const stretches = `These make ${question.events.toLocaleString("en-US")} stretch${question.events === 1 ? "" : "es"} of ${storm ? "storm" : "X-flare"} nights for the question`;
    const nasa =
      logged === null || logged === 0
        ? ""
        : ` · NASA logged ${logged.toLocaleString("en-US")} ${storm ? "solar storm" : "X-class flare"}${logged === 1 ? "" : "s"} in this time`;
    noun = stretches + nasa;
  }
  let q: string | null = null;
  if (f && question) {
    const end =
      question.word === "Too early"
        ? "needs more nights to say."
        : question.word === "Not checked" || question.word === "Checking"
          ? "isn't checked yet."
          : "has the answer.";
    q = `Coincidence or pattern? Question ${question.number}, on ${question.subject}, ${end}`;
  }
  return { count: count.toLocaleString("en-US"), what, noun, question: q, facts: genre ? GENRE_FACTS : null };
}

/** Which of the history's months (newest first) collapse with a filter on (8.5): "nothing" for a month
    with no lit night, "coverage" for the newest month before the filter's source starts, "hidden"
    for the older ones (the line was said once), null for a month that shows its doors. The lit
    function gives a month's count, or undefined while it isn't known. */
export function collapse(
  months: string[],
  filter: SkyFilterId | null,
  lit: (month: string) => number | undefined,
): Map<string, "nothing" | "coverage" | "hidden"> {
  const out = new Map<string, "nothing" | "coverage" | "hidden">();
  const from = filter ? COVERAGE[filter]?.from : undefined;
  let said = false;
  for (const m of months) {
    if (from && m < from) {
      out.set(m, said ? "hidden" : "coverage");
      said = true;
    } else if (lit(m) === 0) out.set(m, "nothing");
  }
  return out;
}

/** A month weighted by its lit nights, for "random lit door": r in [0, 1). */
export function pickMonth(counts: Record<string, number>, r: number): string | null {
  const months = Object.keys(counts)
    .filter((m) => counts[m] > 0)
    .sort();
  const total = months.reduce((s, m) => s + counts[m], 0);
  let x = r * total;
  for (const m of months) {
    x -= counts[m];
    if (x < 0) return m;
  }
  return months[months.length - 1] ?? null;
}
