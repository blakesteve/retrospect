import retrogradesRaw from "./data/retrogrades.json";
import signsRaw from "./data/signs.json";
import moonsRaw from "./data/moons.json";
import eclipsesRaw from "./data/eclipses.json";
import harmonyRaw from "./data/harmony.json";
import type { Sign, SkyBody } from "./sky";

/**
 * The generated sky, 2002 through 2035 (spec 7.2). SERVER ONLY.
 *
 * About a megabyte of windows. Client code never imports this module or the
 * JSON behind it: each view gets its slice from an endpoint. Two checks hold
 * that line, `clientImports.test.ts` over the import graph and
 * `scripts/check-sky-server-only.mjs` over the built chunks. The math the
 * client may share lives in `./sky.ts`, which has no data in it.
 *
 * Regenerate with `npm run sky`. Times are ISO, whole seconds, UTC. A window
 * at the range's edge keeps its true start or end, outside the range.
 */

export const SKY_RANGE = {
  from: Date.parse(retrogradesRaw.range.from),
  to: Date.parse(retrogradesRaw.range.to), // exclusive
};

export interface RetrogradeWindow {
  body: "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn";
  start: string;
  end: string;
  /** Sign at the station retrograde, and at the station direct. */
  sign: Sign;
  signAtDirect: Sign;
}

export interface SignWindow {
  body: SkyBody;
  sign: Sign;
  start: string;
  end: string;
  /** Inside a station-to-station window of that body at the window's start
      or end (spec 6.2's sign merges need both). Always false for the Sun
      and Moon. */
  retrogradeAtStart: boolean;
  retrogradeAtEnd: boolean;
}

export interface MoonEvent {
  phase: "full" | "new";
  peak: string;
  /** Peak less and plus 36 hours. */
  start: string;
  end: string;
  sign: Sign;
}

export interface EclipseEvent {
  /** e.g. "total solar", "penumbral lunar". Global greatest-eclipse time: no
      copy may claim one was visible anywhere in particular. */
  kind: string;
  peak: string;
  /** Peak less and plus 60 hours. */
  start: string;
  end: string;
  sign: Sign;
}

export interface HarmonyWindow {
  aspect: 60 | 120;
  /** "+" when Mars-minus-Venus sits near 60 or 120, "-" near 300 or 240. */
  side: "+" | "-";
  start: string;
  end: string;
  /** Degrees a day the separation was changing at each end. */
  rateAtStart: number;
  rateAtEnd: number;
}

export const retrogradeWindows = retrogradesRaw.windows as RetrogradeWindow[];
export const signWindows = signsRaw.windows as SignWindow[];
export const moonEvents = moonsRaw.events as MoonEvent[];
export const eclipseEvents = eclipsesRaw.events as EclipseEvent[];
export const harmonyWindows = harmonyRaw.windows as HarmonyWindow[];
