/**
 * Kp as NOAA writes it (spec 7.3). DONKI reports Kp in thirds: 5.67 is
 * "Kp 6-", 6 is "Kp 6", 6.33 is "Kp 6+". Storm grades follow NOAA's G scale.
 *
 * DONKI only carries Kp readings inside storms it logged, and its lowest
 * from 2010 to 2026 is 5 (checked over the whole log, 1 Oct 2026), so there's
 * no quiet value here: a night with no storm reads "No storm in NASA's log
 * that night", never "Kp 0". Readings up to mid-2013 are whole numbers.
 */

/** The nearest whole Kp and which third: 5.67 is 6 and "-". */
function thirds(kp: number): { whole: number; sign: "-" | "" | "+" } {
  const whole = Math.round(kp);
  const rest = Math.round((kp - whole) * 3); // -1, 0 or 1
  return { whole, sign: rest < 0 ? "-" : rest > 0 ? "+" : "" };
}

/** "Kp 6-", "Kp 9". */
export function kpLabel(kp: number): string {
  const { whole, sign } = thirds(kp);
  return `Kp ${whole}${sign}`;
}

export type StormGrade = "G1" | "G2" | "G3" | "G4" | "G5";

/**
 * NOAA's grade: G1 is 5-, 5 and 5+; G2 6-, 6 and 6+; G3 7-, 7 and 7+; G4 8-,
 * 8, 8+ and 9-; G5 is 9, the scale's top. Below 5- it isn't a storm.
 */
export function stormGrade(kp: number): StormGrade | null {
  const { whole, sign } = thirds(kp);
  if (whole >= 9) return sign === "-" ? "G4" : "G5";
  if (whole === 8) return "G4";
  if (whole === 7) return "G3";
  if (whole === 6) return "G2";
  if (whole === 5) return "G1";
  return null;
}

/** The storm meter lights as many of its 9 cells as the number: 6- lights six. */
export const kpCells = (kp: number): number => Math.min(9, Math.max(0, thirds(kp).whole));
