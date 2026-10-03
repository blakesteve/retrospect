import { conditionFor } from "@/lib/answers/conditions";
import type { SkyBody } from "./sky";
import { QUESTIONS, type QuestionId } from "@/lib/answers/questions";
import { eclipseEvents, moonEvents, retrogradeWindows, signWindows } from "./windows";

/**
 * "Coming up" on Tonight (spec 7.4): the next 45 days of stations, the Sun's,
 * Mercury's, Venus's and Mars's sign changes, full and new moons, eclipses,
 * and the start of any question's condition, at most 6. A condition that
 * starts with one of those events is named on it rather than listed twice.
 * SERVER ONLY: it reads the generated sky windows.
 */

export interface ComingUp {
  /** Unix seconds. */
  time: number;
  kind: "station" | "sign" | "moon" | "eclipse" | "condition";
  text: string;
  /** The questions whose condition starts with it, in question order. */
  questions: QuestionId[];
  /** The body it's about, for the wheel's pulse (8.11): a station's or sign
      change's planet, "Moon" for her phases, a lunar eclipse and her signs,
      "Sun" for a solar eclipse, "Venus" for Venus and Mars in harmony. */
  body: string | null;
}

export const COMING_UP_DAYS = 45;
export const COMING_UP_MAX = 6;

const uts = (iso: string) => Date.parse(iso) / 1000;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function comingUp(now: number, days = COMING_UP_DAYS, max = COMING_UP_MAX): ComingUp[] {
  const end = now + days * 86_400;
  const soon = (t: number) => t > now && t <= end;
  const items: ComingUp[] = [];

  for (const w of retrogradeWindows) {
    if (soon(uts(w.start))) items.push({ time: uts(w.start), kind: "station", text: `${w.body} stations retrograde in ${w.sign}`, questions: [], body: w.body });
    if (soon(uts(w.end))) items.push({ time: uts(w.end), kind: "station", text: `${w.body} stations direct in ${w.signAtDirect}`, questions: [], body: w.body });
  }
  for (const w of signWindows) {
    if (!["Sun", "Mercury", "Venus", "Mars"].includes(w.body) || !soon(uts(w.start))) continue;
    items.push({ time: uts(w.start), kind: "sign", text: `${w.body === "Sun" ? "The Sun" : w.body} enters ${w.sign}`, questions: [], body: w.body });
  }
  const eclipses = eclipseEvents.filter((e) => soon(uts(e.peak)));
  for (const e of eclipses) {
    items.push({ time: uts(e.peak), kind: "eclipse", text: `${capital(e.kind)} eclipse`, questions: [], body: e.kind.endsWith("solar") ? "Sun" : "Moon" });
  }
  for (const e of moonEvents) {
    const t = uts(e.peak);
    // An eclipse is a full or new moon too: it's listed once, as the eclipse.
    if (!soon(t) || eclipses.some((x) => Math.abs(uts(x.peak) - t) < 86_400)) continue;
    items.push({ time: t, kind: "moon", text: `${e.phase === "full" ? "Full" : "New"} moon in ${e.sign}`, questions: [], body: "Moon" });
  }

  for (const q of QUESTIONS) {
    if (q.nasa) continue;
    for (const w of conditionFor(q.id)!.windows) {
      if (!soon(w.start)) continue;
      /* A moon question's window opens 36 hours before its moon: it's named on
         that moon, or on the eclipse listed in its place (greatest eclipse can
         be minutes from the moon's instant). Anything else starts with an
         event within two minutes of it, or stands on its own. */
      const moonQuestion = q.id === "fullmoon" || q.id === "newmoon";
      const at = moonQuestion ? w.start + 36 * 3600 : w.start;
      const same = moonQuestion
        ? items.find((i) => (i.kind === "moon" || i.kind === "eclipse") && Math.abs(i.time - at) < 86_400)
        : items.find((i) => Math.abs(i.time - at) <= 120);
      if (same) {
        same.questions.push(q.id);
        continue;
      }
      items.push({ time: w.start, kind: "condition", text: conditionText(q.id, w.sign), questions: [q.id], body: conditionBody(q.id) });
    }
  }

  const order = new Map(QUESTIONS.map((q, i) => [q.id, i]));
  return items
    .sort((a, b) => a.time - b.time)
    .slice(0, max)
    .map((i) => ({ ...i, questions: [...new Set(i.questions)].sort((a, b) => order.get(a)! - order.get(b)!) }));
}

/** The body a condition is about: its planet, the Moon for hers, Venus for
    Venus and Mars. Storms and flares are never coming up. */
function conditionBody(id: QuestionId): SkyBody | null {
  if (id === "fullmoon" || id === "newmoon") return "Moon";
  if (id === "venusmars") return "Venus";
  return conditionFor(id)?.body ?? null;
}

/** A condition that starts on its own: the Moon's signs, Venus and Mars in harmony. */
function conditionText(id: QuestionId, sign: string | undefined): string {
  if (id === "moonstrong") return `The Moon enters ${sign}`;
  if (id === "venusmars") return "Venus and Mars come into harmony";
  return capital(QUESTIONS.find((q) => q.id === id)!.shortName);
}
