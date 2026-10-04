import { Body, Ecliptic, GeoVector, Illumination, MakeTime, MoonPhase, SearchMoonPhase } from "astronomy-engine";

/**
 * The sky's math, in one place: where each body is, its sign and dignity,
 * whether it's retrograde, the aspects between bodies, and which of the 12
 * questions' sky conditions hold at an instant.
 *
 * JSON-free on purpose (spec 7.2). The data generator (`scripts/sky-data.mjs`)
 * computes every window with these functions, the server reads the windows,
 * and the Sky view will import this module to draw the wheel, so the three
 * can't disagree at a sign boundary. Anything that needs the generated windows
 * goes through `src/lib/sky/windows.ts`, which is server-only.
 *
 * Positions are geocentric, tropical and apparent: astronomy-engine's
 * `GeoVector` with aberration, rotated by `Ecliptic` onto the true ecliptic
 * of date. That frame is what "Venus in Taurus" means, and it's the frame the
 * existing ephemeris scripts already use.
 *
 * Written in erasable TypeScript only, so Node can run it directly for the
 * generator.
 */

export const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
] as const;
export type Sign = (typeof SIGNS)[number];

export const BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;
export type SkyBody = (typeof BODIES)[number];

/** The bodies that go retrograde. The Sun and Moon never do. */
export const RETROGRADE_BODIES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

/** Apparent geocentric longitude on the true ecliptic of date, 0 to 360. */
export function longitude(body: SkyBody, date: Date): number {
  const lon = Ecliptic(GeoVector(Body[body], MakeTime(date), true)).elon;
  return ((lon % 360) + 360) % 360;
}

/** 0 for Aries through 11 for Pisces. */
export const signIndexOf = (lon: number): number => Math.floor((((lon % 360) + 360) % 360) / 30);
export const signOf = (lon: number): Sign => SIGNS[signIndexOf(lon)];

/** Whole degrees and minutes into the sign, as "12°34′" reads them. */
export function degreeInSign(lon: number): { degree: number; minute: number } {
  const within = (((lon % 360) + 360) % 360) % 30;
  let degree = Math.floor(within);
  let minute = Math.floor((within - degree) * 60 + 1e-9);
  if (minute === 60) {
    degree += 1;
    minute = 0;
  }
  return { degree, minute };
}

/* Apparent motion in degrees a day, from a symmetric difference over plus or
   minus 6 hours: negative is retrograde. The same estimate
   `scripts/retrograde-windows.mjs` has always used, so stations found here
   match the old files to the second. */
const H6 = 6 * 3_600_000;
export function motion(body: SkyBody, date: Date): number {
  const a = longitude(body, new Date(date.getTime() - H6));
  const b = longitude(body, new Date(date.getTime() + H6));
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d / 0.5;
}

export const isRetrograde = (body: SkyBody, date: Date): boolean =>
  body !== "Sun" && body !== "Moon" && motion(body, date) < 0;

/* ---------------------------------------------------------------------- */
/* Dignities: the traditional table (spec 7.2)                             */
/* ---------------------------------------------------------------------- */

export type Dignity = "home" | "exalted" | "detriment" | "fall";

export const DIGNITY_TABLE: Record<SkyBody, Record<Dignity, readonly Sign[]>> = {
  Sun: { home: ["Leo"], exalted: ["Aries"], detriment: ["Aquarius"], fall: ["Libra"] },
  Moon: { home: ["Cancer"], exalted: ["Taurus"], detriment: ["Capricorn"], fall: ["Scorpio"] },
  Mercury: { home: ["Gemini", "Virgo"], exalted: ["Virgo"], detriment: ["Sagittarius", "Pisces"], fall: ["Pisces"] },
  Venus: { home: ["Taurus", "Libra"], exalted: ["Pisces"], detriment: ["Aries", "Scorpio"], fall: ["Virgo"] },
  Mars: { home: ["Aries", "Scorpio"], exalted: ["Capricorn"], detriment: ["Libra", "Taurus"], fall: ["Cancer"] },
  Jupiter: { home: ["Sagittarius", "Pisces"], exalted: ["Cancer"], detriment: ["Gemini", "Virgo"], fall: ["Capricorn"] },
  Saturn: { home: ["Capricorn", "Aquarius"], exalted: ["Libra"], detriment: ["Cancer", "Leo"], fall: ["Aries"] },
};

const DIGNITY_ORDER: Dignity[] = ["home", "exalted", "detriment", "fall"];

/** Every dignity or debility a body has in a sign, in table order. Empty is a
    neutral sign. */
export const dignitiesOf = (body: SkyBody, sign: Sign): Dignity[] =>
  DIGNITY_ORDER.filter((d) => DIGNITY_TABLE[body][d].includes(sign));

/** The one the halo shows: home over exalted, fall over detriment. */
export function haloDignity(body: SkyBody, sign: Sign): Dignity | "neutral" {
  const all = dignitiesOf(body, sign);
  if (all.includes("home")) return "home";
  if (all.includes("exalted")) return "exalted";
  if (all.includes("fall")) return "fall";
  if (all.includes("detriment")) return "detriment";
  return "neutral";
}

const PRONOUN: Record<SkyBody, "her" | "his" | "its"> = {
  Sun: "his", Moon: "her", Mercury: "its", Venus: "her", Mars: "his", Jupiter: "his", Saturn: "his",
};

/** "her" for Venus and the Moon, "his" for the Sun, Mars, Jupiter and Saturn,
    "its" for Mercury (spec 9.3). */
export const pronounOf = (body: SkyBody): "her" | "his" | "its" => PRONOUN[body];

/**
 * The words for a body's standing in a sign (spec 9.3): "at home", "exalted",
 * "in her detriment", "in his fall", "in its detriment and fall", "a neutral
 * sign". Never "peregrine", which means no dignity of any kind, triplicity
 * and term included, and never "wandering".
 */
export function dignityPhrase(body: SkyBody, sign: Sign): string {
  const all = dignitiesOf(body, sign);
  if (all.length === 0) return "a neutral sign";
  const good = all.filter((d) => d === "home" || d === "exalted").map((d) => (d === "home" ? "at home" : "exalted"));
  const bad = all.filter((d) => d === "detriment" || d === "fall");
  const parts: string[] = [...good];
  if (bad.length > 0) parts.push(`in ${PRONOUN[body]} ${bad.join(" and ")}`);
  return parts.join(" and ");
}

/* ---------------------------------------------------------------------- */
/* A body's words, built with the sky so every endpoint serving it         */
/* carries them and the client only lays them out (spec 9)                 */
/* ---------------------------------------------------------------------- */

/** The practitioner's name for each standing, second in a line (spec 9). */
const DIGNITY_TERM: Record<Dignity, string> = {
  home: "domicile",
  exalted: "exaltation",
  detriment: "detriment",
  fall: "fall",
};

/** "8°06′": whole degrees into the sign, then minutes, always two digits. */
export const degreeText = (degree: number, minute: number): string =>
  `${degree}°${String(minute).padStart(2, "0")}′`;

export interface BodyWords {
  /** "8°06′" */
  degreeText: string;
  /** Spec 9.3: "Venus in Scorpio · in her detriment", "Mercury in Libra · a
      neutral sign". */
  line: string;
  /** Spec 8.7.1 item 3, plain words first, the practitioner's term second:
      "Venus at home · domicile in Taurus, 14°21′", "Saturn in his fall · fall
      in Aries, 11°43′, retrograde", "Mercury in a neutral sign · Libra,
      28°09′". */
  detail: string;
  /** The accessible name: "Venus in Scorpio, in her detriment", "Saturn in
      Aries, in his fall, retrograde". */
  name: string;
}

/** The words for a body in a sign at a degree, retrograde or not. */
export function bodyWords(b: { body: SkyBody; sign: Sign; degree: number; minute: number; retrograde: boolean }): BodyWords {
  const standing = dignityPhrase(b.body, b.sign);
  const deg = degreeText(b.degree, b.minute);
  const rx = b.retrograde ? ", retrograde" : "";
  const all = dignitiesOf(b.body, b.sign);
  const detail =
    all.length === 0
      ? `${b.body} in a neutral sign · ${b.sign}, ${deg}${rx}`
      : `${b.body} ${standing} · ${all.map((d) => DIGNITY_TERM[d]).join(" and ")} in ${b.sign}, ${deg}${rx}`;
  return {
    degreeText: deg,
    line: `${b.body} in ${b.sign} · ${standing}`,
    detail,
    name: `${b.body} in ${b.sign}, ${standing}${rx}`,
  };
}

/* ---------------------------------------------------------------------- */
/* Aspects                                                                */
/* ---------------------------------------------------------------------- */

/** How far `to` sits ahead of `from` along the zodiac, 0 to 360. */
export const separation = (from: number, to: number): number => (((to - from) % 360) + 360) % 360;

/** The major aspects. The spec names only trine and sextile (for question 6);
    the sky at an instant lists all five within the orb. */
export const ASPECTS = [
  { name: "conjunction", angle: 0 },
  { name: "sextile", angle: 60 },
  { name: "square", angle: 90 },
  { name: "trine", angle: 120 },
  { name: "opposition", angle: 180 },
] as const;
export type AspectName = (typeof ASPECTS)[number]["name"];

export const ASPECT_ORB = 3;

/** The aspect two longitudes make, if any lies within the orb. */
export function aspectBetween(a: number, b: number, orb = ASPECT_ORB): { name: AspectName; angle: number; off: number } | null {
  const sep = separation(a, b);
  const apart = sep > 180 ? 360 - sep : sep; // 0 to 180
  for (const { name, angle } of ASPECTS) {
    const off = Math.abs(apart - angle);
    if (off <= orb) return { name, angle, off };
  }
  return null;
}

/* Venus and Mars "get along" (question 6): trine or sextile within 3 degrees.
   The signed separation is Mars minus Venus. Near 60 or 120 is side "+", near
   300 or 240 side "-"; spec 6.2's merge rule needs the side and the aspect. */
export const HARMONY_TARGETS = [
  { target: 60, aspect: 60, side: "+" },
  { target: 120, aspect: 120, side: "+" },
  { target: 240, aspect: 120, side: "-" },
  { target: 300, aspect: 60, side: "-" },
] as const;

/** Signed distance from `target`, in (-180, 180]. */
export const offFrom = (sep: number, target: number): number => {
  const d = (((sep - target) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

export const harmonySeparation = (date: Date): number =>
  separation(longitude("Venus", date), longitude("Mars", date));

export function harmonyAt(date: Date): { aspect: 60 | 120; side: "+" | "-"; off: number } | null {
  const sep = harmonySeparation(date);
  for (const { target, aspect, side } of HARMONY_TARGETS) {
    const off = offFrom(sep, target);
    if (Math.abs(off) <= ASPECT_ORB) return { aspect, side, off };
  }
  return null;
}

/** The harmony separation's rate of change, degrees a day, over plus or minus
    an hour. */
export function harmonyRate(date: Date): number {
  const h = 3_600_000;
  const a = harmonySeparation(new Date(date.getTime() - h));
  const b = harmonySeparation(new Date(date.getTime() + h));
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d * 12;
}

/* ---------------------------------------------------------------------- */
/* The Moon                                                               */
/* ---------------------------------------------------------------------- */

/** Full and new moon windows run 36 hours either side of the exact instant. */
export const MOON_WINDOW_MS = 36 * 3_600_000;

/** The exact instant of the full (180) or new (0) moon nearest `date`, if one
    falls within 36 hours of it. */
export function moonEventNear(phase: 0 | 180, date: Date): Date | null {
  const found = SearchMoonPhase(phase, MakeTime(new Date(date.getTime() - MOON_WINDOW_MS)), 3.1);
  if (!found) return null;
  return Math.abs(found.date.getTime() - date.getTime()) <= MOON_WINDOW_MS ? found.date : null;
}

/* ---------------------------------------------------------------------- */
/* The sky at an instant                                                  */
/* ---------------------------------------------------------------------- */

/** The ids of the 12 questions whose condition is the sky's alone. Questions 7
    and 8 (storms, flares) are NASA's log, not the sky, and aren't here. */
export type SkyConditionId =
  | "mercury" | "fullmoon" | "newmoon" | "venushome" | "moonstrong" | "venusmars"
  | "marswater" | "venusdet" | "venusrx" | "marsrx";

export interface BodyAt {
  body: SkyBody;
  longitude: number;
  sign: Sign;
  degree: number;
  minute: number;
  dignity: Dignity | "neutral";
  dignityPhrase: string;
  retrograde: boolean;
}

export interface SkyAt {
  at: string;
  bodies: BodyAt[];
  /** `phaseAngle` is astronomy-engine's MoonPhase: the Moon's longitude less
      the Sun's, 0 at new, 90 at first quarter, 180 at full, 270 at last
      quarter. (Its `Illumination().phase_angle` runs the other way, 180 at
      new, so the two must not be mixed.) `illumination` is the lit fraction,
      0 to 1. */
  moon: { phaseAngle: number; illumination: number; sign: Sign };
  aspects: { a: SkyBody; b: SkyBody; name: AspectName; off: number }[];
  conditions: SkyConditionId[];
}

/** A body as `skyAt` gives it: its place and its words. */
export type BodyAtWithWords = BodyAt & BodyWords;

/** The sky as `skyAt` gives it, every body with its words. Anything typed as
    `SkyAt` takes it as is. */
export interface SkyAtWithWords extends SkyAt {
  bodies: BodyAtWithWords[];
}

/** The seven bodies at an instant, each with its place, standing and words.
    The server's sky and the Sky view's wheel (8.6, computed in the browser)
    both come from here, so they can't disagree at a sign boundary. */
export function bodiesAt(date: Date): BodyAtWithWords[] {
  return BODIES.map((body) => {
    const lon = longitude(body, date);
    const sign = signOf(lon);
    const at: BodyAt = {
      body,
      longitude: lon,
      sign,
      ...degreeInSign(lon),
      dignity: haloDignity(body, sign),
      dignityPhrase: dignityPhrase(body, sign),
      retrograde: isRetrograde(body, date),
    };
    return { ...at, ...bodyWords(at) };
  });
}

/** The Moon's phase angle (astronomy-engine's MoonPhase): the Moon's
    longitude less the Sun's, 0 new, 90 first quarter, 180 full. */
export const moonPhaseAngle = (date: Date): number => MoonPhase(MakeTime(date));

/** Everything spec 7.2 lists for one instant. A pure function of the time. */
export function skyAt(date: Date): SkyAtWithWords {
  const bodies = bodiesAt(date);
  const byBody = Object.fromEntries(bodies.map((b) => [b.body, b])) as Record<SkyBody, BodyAtWithWords>;

  const aspects: SkyAt["aspects"] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const hit = aspectBetween(bodies[i].longitude, bodies[j].longitude);
      if (hit) aspects.push({ a: bodies[i].body, b: bodies[j].body, name: hit.name, off: hit.off });
    }
  }

  const conditions: SkyConditionId[] = [];
  const inSigns = (body: SkyBody, signs: readonly Sign[]) => signs.includes(byBody[body].sign);
  if (byBody.Mercury.retrograde) conditions.push("mercury");
  if (moonEventNear(180, date)) conditions.push("fullmoon");
  if (moonEventNear(0, date)) conditions.push("newmoon");
  if (inSigns("Venus", ["Taurus", "Libra"])) conditions.push("venushome");
  if (inSigns("Moon", ["Cancer", "Taurus"])) conditions.push("moonstrong");
  if (harmonyAt(date)) conditions.push("venusmars");
  if (inSigns("Mars", ["Cancer", "Scorpio", "Pisces"])) conditions.push("marswater");
  if (inSigns("Venus", ["Aries", "Scorpio"])) conditions.push("venusdet");
  if (byBody.Venus.retrograde) conditions.push("venusrx");
  if (byBody.Mars.retrograde) conditions.push("marsrx");

  const illumination = Illumination(Body.Moon, MakeTime(date)).phase_fraction;
  return {
    at: date.toISOString(),
    bodies,
    moon: { phaseAngle: moonPhaseAngle(date), illumination, sign: byBody.Moon.sign },
    aspects,
    conditions,
  };
}
