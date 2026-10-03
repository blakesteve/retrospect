/**
 * Which rows "Tonight, for you" shows, and in what order (spec 8.4 item 3).
 * Every line is the server's; this only picks and orders them. `src/lib/client`
 * holds pure modules the browser imports: no data, no sky math.
 */
import type { QuestionId } from "@/lib/answers/questions";

/** Rarest first (8.4): retrogrades, then Venus and Mars, then storms and
    flares, then the Moon. */
export const RARITY: readonly QuestionId[] = [
  "mercury",
  "venusrx",
  "marsrx",
  "venushome",
  "venusmars",
  "marswater",
  "venusdet",
  "storms",
  "flares",
  "fullmoon",
  "newmoon",
  "moonstrong",
];

/** The bodies a question is about, for the row's glyph and the wheel's
    highlight (8.11 item 2): a storm or flare row highlights the Sun, the
    Venus-and-Mars row both planets, a moon row the Moon. */
export const QUESTION_BODIES: Record<QuestionId, readonly string[]> = {
  mercury: ["Mercury"],
  fullmoon: ["Moon"],
  newmoon: ["Moon"],
  moonstrong: ["Moon"],
  venushome: ["Venus"],
  venusdet: ["Venus"],
  venusrx: ["Venus"],
  venusmars: ["Venus", "Mars"],
  marswater: ["Mars"],
  marsrx: ["Mars"],
  storms: ["Sun"],
  flares: ["Sun"],
};

export interface ForYouFact {
  body: string;
  planet: string;
  kind: "station" | "sign" | "moon";
  line: string;
}

export type ForYouRow =
  | { kind: "held"; id: QuestionId; skyLine: string; bodies: readonly string[] }
  | { kind: "none"; line: string; next: { id: QuestionId; line: string } | null; bodies: readonly string[] }
  | { kind: "headsUp"; id: QuestionId; skyLine: string; line: string; bodies: readonly string[] }
  | { kind: "fact"; fact: ForYouFact; bodies: readonly string[] };

export interface ForYouInput {
  /** The questions whose sky is overhead now (`sky/now`). */
  held: readonly QuestionId[];
  skyLines: Partial<Record<QuestionId, string>>;
  noneOverhead: { line: string; next: { id: QuestionId; line: string } | null } | null;
  skyFacts: readonly ForYouFact[];
  /** `undefined` while the answers are still on their way. */
  headsUp: { id: QuestionId; skyLine: string; line: string } | null | undefined;
}

/** At most three held rows, "for you" rows fill to three with sky facts. */
export const MAX_HELD = 3;
export const FILL_TO = 3;

/**
 * The rows, top to bottom: questions overhead now (at most three, rarest
 * first), or the "none overhead" row; the heads-up; then sky facts until there
 * are three rows in all, each about a body no row above already names.
 */
export function forYouRows(input: ForYouInput): ForYouRow[] {
  const rows: ForYouRow[] = [];
  const held = RARITY.filter((id) => input.held.includes(id)).slice(0, MAX_HELD);
  for (const id of held) rows.push({ kind: "held", id, skyLine: input.skyLines[id] ?? "", bodies: QUESTION_BODIES[id] });

  const headsUp = input.headsUp ?? null;
  if (held.length === 0 && input.noneOverhead) {
    // "Next: …" is left off when the heads-up names that same start.
    const next = input.noneOverhead.next && input.noneOverhead.next.id !== headsUp?.id ? input.noneOverhead.next : null;
    rows.push({ kind: "none", line: input.noneOverhead.line, next, bodies: next ? QUESTION_BODIES[next.id] : [] });
  }
  if (headsUp) rows.push({ kind: "headsUp", ...headsUp, bodies: QUESTION_BODIES[headsUp.id] });

  const named = new Set(rows.flatMap((r) => r.bodies));
  for (const fact of input.skyFacts) {
    if (rows.length >= FILL_TO) break;
    if (named.has(fact.body)) continue;
    named.add(fact.body);
    rows.push({ kind: "fact", fact, bodies: [fact.body] });
  }
  return rows;
}

/** Whether a row above already names the Moon's sign, so the Moon's own row
    leaves it off (8.4 item 4). */
export const namesMoonSign = (rows: readonly ForYouRow[]) =>
  rows.some((r) => ((r.kind === "held" || r.kind === "headsUp") && r.id === "moonstrong") || (r.kind === "fact" && r.fact.body === "Moon" && r.fact.kind === "sign"));
