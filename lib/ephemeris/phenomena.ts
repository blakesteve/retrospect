import mercuryRaw from "./mercury-retrogrades.json";
import venusRaw from "./venus-retrogrades.json";
import marsRaw from "./mars-retrogrades.json";
import moonsRaw from "./full-moons.json";
import eclipsesRaw from "./eclipses.json";
import type { RetrogradeWindow, WindowBounds } from "./retrogrades";
import type { MetricKey } from "@/lib/analysis/metrics";

export type PhenomenonKey = "mercury" | "venus" | "mars" | "fullmoon" | "eclipse";

export interface Phenomenon {
  key: PhenomenonKey;
  /** Which listening metric this phenomenon is tried on — its astrological specialty. */
  metric: MetricKey;
  glyph: string;
  /** "Mercury Retrograde" — title-case, for headings. */
  title: string;
  /** "Mercury" — the accused, for verdicts ("Mercury is innocent"). */
  subjectName: string;
  /** Grammatical number of the subject ("The eclipses ARE innocent"). */
  subjectPlural?: boolean;
  /** Mid-sentence subject for questions: "Does {qSubject} keep you up late?" */
  qSubject: string;
  /** "when Mercury is retrograde" — verdict phrasing. */
  when: string;
  /** "While Mercury was retrograde" — stat tile label. */
  tileLabel: string;
  /** "retrograde anthem" card label. */
  anthemLabel: string;
  /** Explainer-step copy: what/how often this phenomenon is. */
  explainer: string;
  /** The astrological lore hook, one line. */
  lore: string;
  windows: RetrogradeWindow[];
  bounds: WindowBounds[];
}

function toBounds(windows: RetrogradeWindow[]): WindowBounds[] {
  return windows
    .map((w): WindowBounds => [Date.parse(w.start) / 1000, Date.parse(w.end) / 1000])
    .sort((a, b) => a[0] - b[0]);
}

const mercury = mercuryRaw.windows as RetrogradeWindow[];
const venus = venusRaw.windows as RetrogradeWindow[];
const mars = marsRaw.windows as RetrogradeWindow[];
const moons = moonsRaw.windows as RetrogradeWindow[];
const eclipses = eclipsesRaw.windows as RetrogradeWindow[];

export const PHENOMENA: Record<PhenomenonKey, Phenomenon> = {
  mercury: {
    key: "mercury",
    qSubject: "Mercury retrograde",
    metric: "nostalgia",
    glyph: "☿",
    title: "Mercury Retrograde",
    subjectName: "Mercury",
    when: "when Mercury is retrograde",
    tileLabel: "While Mercury was retrograde",
    anthemLabel: "Your retrograde anthem",
    explainer:
      "Mercury looks like it moves backwards ~3 times a year for ~3 weeks. We computed the exact dates from planetary positions.",
    lore: "The famous one: communication breaks, exes text, and, allegedly, you crawl back to old comforts.",
    windows: mercury,
    bounds: toBounds(mercury),
  },
  venus: {
    key: "venus",
    qSubject: "Venus retrograde",
    metric: "oldflame",
    glyph: "♀",
    title: "Venus Retrograde",
    subjectName: "Venus",
    when: "when Venus is retrograde",
    tileLabel: "While Venus was retrograde",
    anthemLabel: "Your Venus retrograde anthem",
    explainer:
      "Venus reverses only every ~19 months, for about 6 weeks. Rarer, and astrologers take it more seriously.",
    lore: "The love one: old flames, old feelings: the music you shared with people who are gone.",
    windows: venus,
    bounds: toBounds(venus),
  },
  mars: {
    key: "mars",
    qSubject: "Mars retrograde",
    metric: "intensity",
    glyph: "♂",
    title: "Mars Retrograde",
    subjectName: "Mars",
    when: "when Mars is retrograde",
    tileLabel: "While Mars was retrograde",
    anthemLabel: "Your Mars retrograde anthem",
    explainer:
      "Mars reverses roughly every 2 years for ~2 months: long, slow stretches of the sky pushing back.",
    lore: "The drive one: stalled momentum, old frustrations. Do you retreat into familiar sound?",
    windows: mars,
    bounds: toBounds(mars),
  },
  fullmoon: {
    key: "fullmoon",
    qSubject: "a full moon",
    metric: "nightowl",
    glyph: "🌕",
    title: "Full Moon",
    subjectName: "The Moon",
    when: "under a full moon",
    tileLabel: "Under a full moon",
    anthemLabel: "Your full-moon anthem",
    explainer:
      "Thirteen-ish full moons a year. We count the ~3 days around each exact instant, computed to the minute.",
    lore: "The chaos one: sleepless nights and heightened everything; every culture has a full-moon story.",
    windows: moons,
    bounds: toBounds(moons),
  },
  eclipse: {
    key: "eclipse",
    qSubject: "an eclipse",
    metric: "discovery",
    glyph: "\u{1F318}",
    title: "Eclipses",
    subjectName: "The eclipses",
    subjectPlural: true,
    when: "around eclipses",
    tileLabel: "Around eclipses (\u00b12.5 days)",
    anthemLabel: "Your eclipse anthem",
    explainer:
      "Four-ish eclipses a year, lunar and solar. We count the ~5 days around each peak, computed from real geometry.",
    lore: "The plot-twist one: eclipses mark sudden endings and new chapters. Do you binge new music when the lights go out?",
    windows: eclipses,
    bounds: toBounds(eclipses),
  },
};

export function getPhenomenon(key: string): Phenomenon | null {
  return (PHENOMENA as Record<string, Phenomenon>)[key] ?? null;
}

export const PHENOMENON_KEYS: PhenomenonKey[] = ["mercury", "venus", "mars", "fullmoon", "eclipse"];
