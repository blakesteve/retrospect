import raw from "./mercury-retrogrades.json";

/** [startUts, endUts] in unix seconds, sorted ascending. */
export type WindowBounds = [number, number];

export type ZodiacSign =
  | "Aries" | "Taurus" | "Gemini" | "Cancer" | "Leo" | "Virgo"
  | "Libra" | "Scorpio" | "Sagittarius" | "Capricorn" | "Aquarius" | "Pisces";

export interface RetrogradeWindow {
  start: string; // ISO 8601
  end: string;
  /** Sign Mercury stationed retrograde in — the astrologically quoted one. */
  sign: ZodiacSign;
  /** Sign it stationed direct in (retrogrades can back into the previous sign). */
  signAtDirect: ZodiacSign;
}

export const mercuryRetrogrades: RetrogradeWindow[] =
  raw.windows as RetrogradeWindow[];

export const SIGN_ELEMENTS: Record<ZodiacSign, "fire" | "earth" | "air" | "water"> = {
  Aries: "fire", Leo: "fire", Sagittarius: "fire",
  Taurus: "earth", Virgo: "earth", Capricorn: "earth",
  Gemini: "air", Libra: "air", Aquarius: "air",
  Cancer: "water", Scorpio: "water", Pisces: "water",
};

export const mercuryBounds: WindowBounds[] = raw.windows
  .map((w): WindowBounds => [Date.parse(w.start) / 1000, Date.parse(w.end) / 1000])
  .sort((a, b) => a[0] - b[0]);

/**
 * Returns a predicate testing whether a unix-seconds timestamp falls inside
 * any of the given (sorted, non-overlapping) windows. Binary search, O(log n).
 */
export function makeInWindow(bounds: WindowBounds[]): (uts: number) => boolean {
  return (uts: number) => {
    let lo = 0;
    let hi = bounds.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (uts < bounds[mid][0]) hi = mid - 1;
      else if (uts > bounds[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  };
}
