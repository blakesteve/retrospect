import { haloDignity, type SkyAt, type SkyBody } from "@/lib/sky/sky";
import type { Chip } from "./highlights";

/**
 * The reveal's sentences (spec 8.3), built where the facts are so the client
 * only lays them out (9.2).
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** "Twenty-three", spelled to 99, then numerals. */
function capitalNumber(n: number): string {
  const word = n < 20 ? ONES[n] : n < 100 ? `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}` : n.toLocaleString("en-US");
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * "{Length} under the sky" (8.3, card 1): whole years from 2, months under 2
 * years, "A few weeks" under 2 months.
 */
export function lengthWords(first: number, last: number): string {
  const a = new Date(first * 1000);
  const b = new Date(last * 1000);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  if (months < 2) return "A few weeks";
  if (months < 24) return `${capitalNumber(months)} months`;
  return `${capitalNumber(Math.floor(months / 12))} years`;
}

/**
 * The wildest night's line (8.3, card 2): "The strongest geomagnetic storm in
 * about 20 years. You played 39 songs (a usual Friday is 50) and first heard
 * Good Luck, Babe!"
 */
export function wildLine(
  title: string,
  plays: number,
  weekday: string,
  usual: number | null,
  firstHeard: string | null,
): string {
  const played = `You played ${plays.toLocaleString("en-US")} song${plays === 1 ? "" : "s"}${
    usual === null ? "" : ` (a usual ${weekday} is ${usual.toLocaleString("en-US")})`
  }`;
  const line = `${title.replace(/\.$/, "")}. ${played}${firstHeard ? ` and first heard ${firstHeard}` : ""}`;
  // A song title that ends a sentence already ("Good Luck, Babe!") takes no period.
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

const PRONOUN: Record<SkyBody, string> = {
  Sun: "his",
  Moon: "her",
  Mercury: "its",
  Venus: "her",
  Mars: "his",
  Jupiter: "his",
  Saturn: "his",
};
const NAME = (b: SkyBody) => (b === "Moon" || b === "Sun" ? `the ${b}` : b);

/**
 * Venus, Mars and the Moon at a minute, when any is out of a neutral sign or
 * the Moon is new or full (9.3's words): "Venus was in her detriment, Mars in
 * his fall, and the Moon was new." Null when there's nothing to say.
 */
export function skyLine(sky: SkyAt): string | null {
  const clauses: string[] = [];
  for (const body of ["Venus", "Mars", "Moon"] as SkyBody[]) {
    const b = sky.bodies.find((x) => x.body === body)!;
    const d = haloDignity(body, b.sign);
    const words =
      d === "home" ? "at home" : d === "exalted" ? "exalted" : d === "detriment" ? `in ${PRONOUN[body]} detriment` : d === "fall" ? `in ${PRONOUN[body]} fall` : null;
    if (words) clauses.push(`${NAME(body)} ${words}`);
  }
  const phase = sky.conditions.includes("newmoon") ? "new" : sky.conditions.includes("fullmoon") ? "full" : null;
  if (phase && !clauses.some((c) => c.startsWith("the Moon"))) clauses.push(`the Moon was ${phase}`);
  if (clauses.length === 0) return null;
  // The first takes "was"; the rest share it, except a clause that brings its own.
  const withWas = clauses.map((c, i) => (i === 0 && !c.includes(" was ") ? c.replace(/^(\S+(?: Moon| Sun)?) /, "$1 was ") : c));
  const joined =
    withWas.length === 1 ? withWas[0] : withWas.length === 2 ? `${withWas[0]} and ${withWas[1]}` : `${withWas.slice(0, -1).join(", ")}, and ${withWas.at(-1)}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/**
 * The strangest sky's line (8.3, card 3): "First played at 7:18 a.m. CDT,
 * Oct 3, 2024, the minute an X9.0 flare peaked. Venus was in her detriment,
 * Mars in his fall, and the Moon was new." A chip the sky line already says
 * (Venus, Mars or the Moon at home or exalted, a new or full moon) isn't said
 * twice: the first sentence then ends at the date.
 */
export function strangestLine(time: string, date: string, fact: string | null, sky: SkyAt, chip: Chip | null = null): string {
  const line = skyLine(sky);
  const NAMES: Partial<Record<SkyBody, string>> = { Venus: "Venus", Mars: "Mars", Moon: "the Moon" };
  const said = (body: SkyBody) => !!line && !!NAMES[body] && line.toLowerCase().includes(NAMES[body]!.toLowerCase());
  const repeats =
    !!chip &&
    ((chip.kind === "pair" && chip.bodies.every((b) => said(b.body))) ||
      (chip.kind === "home" && said(chip.body)) ||
      (chip.kind === "moon" && !!line && line.toLowerCase().includes(`the moon was ${chip.phase}`)));
  const first = `First played at ${time}, ${date}${fact && !repeats ? `, ${fact}` : ""}.`;
  return line ? `${first} ${line}` : first;
}
