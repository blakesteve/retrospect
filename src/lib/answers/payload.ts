import { MIN_EVENTS, MIN_RETRO_N, type VerdictStatus } from "@/lib/analysis/confidence";
import { dignityPhrase, harmonyAt, isRetrograde, longitude, signOf, type Sign, type SkyBody } from "@/lib/sky/sky";
import { startsWhen } from "@/lib/listener/when";
import { historySpan } from "@/lib/listener/words";
import { kpLabel } from "@/lib/space/kp";
import { zoneClock } from "@/lib/zone";
import { conditionFor } from "./conditions";
import {
  ANSWERS_VERSION,
  measuresToday,
  type AnswerRecord,
  type EarlyRead,
  type MergedEvent,
  type NotChecked,
  type PairingFact,
  type QuestionRecord,
} from "./engine";
import { QUESTIONS, questionById, type Measure, type Question, type QuestionId } from "./questions";
import { answerWords, likelihoodFor, type AnswerWord } from "./words";

/**
 * The answers endpoint's payload (spec 7.4): the stored numbers, the words
 * (6.3) worked out from them, and every sentence the client shows (9.1, 9.2,
 * 8.4, 8.7.3), so no client code works out a sentence of its own. Built on every
 * request from the stored record, so the sentences that depend on the moment
 * ("The next one begins Saturday", the heads-up) are always current.
 */

export interface QuestionPhrases {
  wordLine: string;
  tonightLine: string;
  /** The swing alone, as compare shows it under each word (8.8): "A 23%
      bigger after-midnight share", "5% less listening". Null untested. */
  swing: string | null;
  likelihood: string | null;
  /** How likely chance is, with the correction's say when it decides the
      word (`chanceLine`): what a share card puts under its word. Null
      untested. */
  chance: string | null;
  frequency: string | null;
  range: string | null;
  tooEarly: string | null;
  whatHappened: string | null;
  warmup: string | null;
  pValueNote: string | null;
  correctionNote: string | null;
  earlyReadRows: string[];
  typicalSwing: string | null;
  /** This question's heads-up (8.4), when its condition starts within a
      week: the sky ("Venus turns retrograde tomorrow") and the line under
      it. Tonight shows one, the payload's own `headsUp`. */
  headsUp: { skyLine: string; line: string } | null;
}

/** A song first played under this question's sky, with the chip naming the
    condition at that first play (8.7.3): "Venus in Aries · in her
    detriment", "Full moon", "Kp 7 storm night". */
export interface PairingPayload {
  songId: string;
  conditionText: string;
}

export interface QuestionPayload {
  id: QuestionId;
  number: number;
  question: string;
  story: string;
  shortName: string;
  /** Spec 9.2's subject, for "Question 1, on Mercury retrograde": "Mercury
      retrograde", "a full moon". */
  subject: string;
  status: VerdictStatus | null;
  notChecked: NotChecked | null;
  /** Stored under another measure, and being recomputed: no numbers, and
      left out of the correction until it's back. */
  updating: boolean;
  word: AnswerWord;
  /** The swing, in percent (23 is 23% more). */
  pct: number | null;
  p: number | null;
  pAdjusted: number | null;
  matches: number;
  iterations: number;
  /** Spec 6.4, in percent, or null when no range can be shown. */
  range: [number, number] | null;
  events: number;
  eventsNote: string | null;
  inPlays: number;
  warmupReadyFrom: number | null;
  earlyReads: EarlyRead[];
  typicalSingleSwing: number | null;
  /** Unix seconds of the condition's next start, or null (questions 7 and 8). */
  nextStart: number | null;
  /** Songs first played while the condition held (7.4), in the songs row's
      order, each with its chip's words. */
  pairings: PairingPayload[];
  nullSamples: number[];
  phrases: QuestionPhrases;
}

export interface AnswersPayload {
  status: "ready" | "updating";
  done: number;
  total: number;
  stamp: string;
  nasaStamp: string | null;
  version: number;
  /** How many questions were tested, which the correction allows for. */
  m: number;
  tally: Record<AnswerWord, number>;
  questions: QuestionPayload[];
  /** Tonight's one heads-up (8.4), or null: the question, its sky relative
      to the listener's date ("Venus turns retrograde tomorrow"), and the
      line under it. */
  headsUp: { id: QuestionId; skyLine: string; line: string } | null;
  /** The reveal's last card (8.3): its line, and "{n} not checked yet" when
      any are. */
  reveal: { line: string; notChecked: string | null };
}

const DAY = 86_400;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const count = (n: number) => n.toLocaleString("en-US");
/** One to nine in words, then numerals. */
const spelled = (n: number) => (n >= 0 && n < 10 ? SMALL[n] : count(n));
/** "an 8%", "an 11%", "a 23%". */
const article = (n: number) => {
  const s = String(n);
  return s.startsWith("8") || n === 11 || n === 18 ? "an" : "a";
};
const pctOf = (fraction: number) => Math.round(Math.abs(fraction) * 100);

/**
 * p for people, never past a bar it hasn't crossed: 0.25, 0.049, 0.0004. A p
 * is shown rounded down, since its bar is "under 0.05" (0.0499 reads 0.049,
 * not 0.050). An adjusted p is shown rounded up, since its bar is "at most
 * 0.10" (0.105 reads 0.11, not 0.10). The small allowance absorbs float error,
 * so 0.29 stays 0.29.
 */
export function formatP(p: number, round: "down" | "up" = "down"): string {
  if (p >= 1) return "1";
  const digits = p >= 0.1 ? 2 : p >= 0.001 ? 3 : 4;
  const f = 10 ** digits;
  const scaled = round === "down" ? Math.floor(p * f + 1e-9) : Math.ceil(p * f - 1e-9);
  return scaled >= f ? "1" : (scaled / f).toFixed(digits);
}

/* ---- Dates in the listener's zone ---------------------------------------- */

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function localDate(zone: string, uts: number): LocalDate {
  const local = zoneClock(zone, uts).localSeconds(uts);
  const d = new Date(local * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
  };
}

const shortDate = (d: LocalDate, withYear: boolean) =>
  `${MONTHS_SHORT[d.month]} ${d.day}${withYear ? `, ${d.year}` : ""}`;

/** "Mar 1 to Apr 12, 2025", or "Dec 20, 2024 to Jan 9, 2025". */
function dateRange(zone: string, a: number, b: number): string {
  const s = localDate(zone, a);
  const e = localDate(zone, b);
  return s.year === e.year
    ? `${shortDate(s, false)} to ${shortDate(e, true)}`
    : `${shortDate(s, true)} to ${shortDate(e, true)}`;
}

const monthYear = (zone: string, uts: number) => {
  const d = localDate(zone, uts);
  return `${MONTHS_LONG[d.month]} ${d.year}`;
};

/* ---- The measures' words (9.2) -------------------------------------------- */

/** What a tagged play is, for "some of your {noun}". */
const TAG_NOUN: Record<Measure, string> = {
  aftermidnight: "after-midnight plays",
  oldfavorites: "old favorites",
  firstlistens: "first listens",
  listening: "plays",
};

/** Under half a percent either way reads "barely moved" (9.2). */
const barely = (swing: number) => Math.abs(swing) < 0.005;

/** The measure in its own words (6.5, 9.2), for what moves or swings. */
const MEASURE_WORDS: Record<Measure, { now: string; then: string }> = {
  oldfavorites: { now: "your share of old favorites", then: "your share of old favorites" },
  aftermidnight: { now: "your after-midnight share", then: "your after-midnight share" },
  firstlistens: { now: "your share of first listens", then: "your share of first listens" },
  listening: { now: "how much you listen", then: "how much you listened" },
};

/** "a 23% bigger share of your plays came after midnight", "you listened 5% more". */
function swingLong(measure: Measure, swing: number): string {
  if (barely(swing)) return `${MEASURE_WORDS[measure].then} barely moved: less than 1% either way`;
  const n = pctOf(swing);
  const up = swing > 0;
  switch (measure) {
    case "aftermidnight":
      return `${article(n)} ${count(n)}% ${up ? "bigger" : "smaller"} share of your plays came after midnight`;
    case "oldfavorites":
      return `${article(n)} ${count(n)}% ${up ? "bigger" : "smaller"} share of your plays were old favorites`;
    case "firstlistens":
      return `${article(n)} ${count(n)}% ${up ? "bigger" : "smaller"} share of your plays were first listens`;
    case "listening":
      return `you listened ${count(n)}% ${up ? "more" : "less"}`;
  }
}

/** "a 23% bigger after-midnight share", "5% less listening". */
function swingShort(measure: Measure, swing: number): string {
  if (barely(swing)) {
    return measure === "listening"
      ? "listening that barely moved"
      : measure === "aftermidnight"
        ? "an after-midnight share that barely moved"
        : `a share of ${TAG_NOUN[measure]} that barely moved`;
  }
  const n = pctOf(swing);
  const dir = swing > 0 ? "bigger" : "smaller";
  switch (measure) {
    case "aftermidnight":
      return `${article(n)} ${count(n)}% ${dir} after-midnight share`;
    case "oldfavorites":
      return `${article(n)} ${count(n)}% ${dir} share of old favorites`;
    case "firstlistens":
      return `${article(n)} ${count(n)}% ${dir} share of first listens`;
    case "listening":
      return `${count(n)}% ${swing > 0 ? "more" : "less"} listening`;
  }
}

const questionsAtOnce = (m: number) => `${m} question${m === 1 ? "" : "s"}`;

/* ---- Sentences per question ------------------------------------------------ */

function wordLine(q: Question, word: AnswerWord, swing: number, p: number, m: number): string {
  const When = capital(q.when);
  const long = swingLong(q.measure, swing);
  switch (word) {
    case "Yes":
      // With one question tested there's nothing to allow for.
      return m === 1
        ? `Yes. ${When}, ${long}. ${likelihoodFor(p)}`
        : `Yes. ${When}, ${long}. ${likelihoodFor(p).replace(/\.$/, "")}, ` +
            `and it holds up after allowing for asking ${questionsAtOnce(m)} at once.`;
    case "Maybe":
      return p < 0.05
        ? `Maybe. ${When}, ${long}. On its own that's ${p < 0.01 ? "very unlikely" : "unlikely"} to be chance, ` +
            `but after allowing for asking ${questionsAtOnce(m)} at once, it could be.`
        : `Maybe. ${When}, ${long}, which could be chance.`;
    case "Not clearly":
      return `Not clearly. ${When}, ${long}, which could be chance.`;
    default:
      return `No. ${When}, ${long}, which could easily be chance.`;
  }
}

/**
 * Tonight's line (9.2, changed 2 Oct 2026): the row's pill shows the word, so
 * the line leaves it out and says when the swing was measured, the word
 * line's first sentence without its leading word, then the likelihood.
 */
function tonightLine(q: Question, word: AnswerWord, swing: number, p: number, m: number): string {
  const lead = `${capital(q.when)}, ${swingLong(q.measure, swing)}`;
  const chance = likelihoodFor(p).replace(/\.$/, "");
  switch (word) {
    case "Yes":
      // With one question tested there's nothing to allow for.
      return m === 1
        ? `${lead}: ${chance.charAt(0).toLowerCase()}${chance.slice(1)}.`
        : `${lead}: ${chance.charAt(0).toLowerCase()}${chance.slice(1)}, even allowing for ${questionsAtOnce(m)}.`;
    case "Maybe":
      return p < 0.05
        ? `${lead}: ${p < 0.01 ? "very unlikely" : "unlikely"} to be chance on its own, but not after allowing for ${questionsAtOnce(m)}.`
        : `${lead}, which could be chance.`;
    case "Not clearly":
      return `${lead}, which could be chance.`;
    default:
      return `${lead}, which could easily be chance.`;
  }
}

/**
 * How likely chance is, as one sentence that stands alone (8.7.5): the
 * likelihood, plus the correction when it's why the word is Yes or why it
 * isn't. A share card travels without the sheet that would explain a Maybe
 * over "Unlikely to be chance."
 */
export function chanceLine(word: AnswerWord, p: number, m: number): string {
  const chance = likelihoodFor(p);
  if (word === "Yes" && m > 1) return `${chance.replace(/\.$/, "")}, even allowing for ${questionsAtOnce(m)}.`;
  if (word === "Maybe" && p < 0.05) {
    return `${p < 0.01 ? "Very unlikely" : "Unlikely"} to be chance on its own, but not after allowing for ${questionsAtOnce(m)}.`;
  }
  return chance;
}

/**
 * "Shuffle the sky and a swing this big, up or down, turns up about 3 times
 * in 10." (8.7.3). The spec gives one example; the bands are ours: tens down
 * to 0.1, hundreds to 0.01, thousands below, and "never" when no shuffle did.
 */
function frequency(p: number, matches: number, iterations: number): string {
  const lead = "Shuffle the sky and a swing this big, up or down,";
  if (matches === 0) return `${lead} never turned up in ${count(iterations)} tries.`;
  if (p >= 0.95) return `${lead} turns up nearly every time.`;
  const [n, of] = p >= 0.1 ? [Math.round(p * 10), "10"] : p >= 0.01 ? [Math.round(p * 100), "100"] : [Math.round(p * 1000), "1,000"];
  const k = Math.max(1, n);
  return `${lead} turns up about ${k} time${k === 1 ? "" : "s"} in ${of}.`;
}

function rangeSentence(
  q: Question,
  word: AnswerWord,
  index: number,
  c: number | null,
): { line: string; range: [number, number] | null } {
  const none = { line: "There's too little listening under this sky to say how big a change could be.", range: null };
  if (c === null || index <= 0) return none;
  const L = Math.log(index);
  const lo = Math.exp(L - c) - 1;
  const hi = Math.exp(L + c) - 1;
  const range: [number, number] = [lo * 100, hi * 100];
  const rate = q.measure === "listening";
  const moves = `If ${q.subject} ${q.plural ? "move" : "moves"} you at all`;
  // Spec 6.4: it excludes zero exactly when |L| > c, which is when p < 0.05.
  if (Math.abs(L) <= c) {
    const a = pctOf(lo);
    const b = pctOf(hi);
    const big = Math.max(Math.abs(lo), Math.abs(hi));
    const small = Math.min(Math.abs(lo), Math.abs(hi));
    if (small > 0 && big <= 1.5 * small) {
      return { line: `${moves}, it's likely by less than ${count(Math.ceil(big * 100))}% either way.`, range };
    }
    let between: string;
    if (rate) {
      between = `${a === 0 ? "no change" : `${count(a)}% less`} and ${b === 0 ? "no change" : `${count(b)}% more`}`;
    } else if (a > 0 && b > 0) {
      between = `${article(a)} ${count(a)}% smaller and ${article(b)} ${count(b)}% bigger share`;
    } else {
      // An end that rounds to nothing: "between a 13% smaller share and no change".
      const low = a === 0 ? "no change" : `${article(a)} ${count(a)}% smaller share`;
      const high = b === 0 ? "no change" : `${article(b)} ${count(b)}% bigger share`;
      between = `${low} and ${high}`;
    }
    return { line: `${moves}, it's likely somewhere between ${between}.`, range };
  }
  /* It excludes zero. An end under half a percent reads "barely", never "0%",
     which would read as including zero beside a Yes (6.4). */
  const up = L > 0;
  const [near, far] = up ? [pctOf(lo), pctOf(hi)] : [pctOf(hi), pctOf(lo)];
  const more = up ? "more" : "less";
  const bigger = up ? "bigger" : "smaller";
  let span: string;
  if (far === 0) span = rate ? `barely ${more}` : `${up ? "a barely bigger" : "a barely smaller"} share`;
  else if (near === 0) {
    span = rate
      ? `between barely ${more} and ${count(far)}% ${more}`
      : `between a barely ${bigger} and ${article(far)} ${count(far)}% ${bigger} share`;
  } else {
    span = rate
      ? `between ${count(near)}% and ${count(far)}% ${more}`
      : `between ${article(near)} ${count(near)}% and ${article(far)} ${count(far)}% ${bigger} share`;
  }
  return word === "Yes"
    ? { line: `The real change is likely ${span}.`, range }
    : { line: `On its own, the change looks like somewhere ${span}.`, range };
}

const NOT_CHECKED: Record<NotChecked, string> = {
  nasa: "Not checked yet: NASA's log didn't load.",
  error: "Not checked: something went wrong on our side.",
};

const WARMUP_NOUN: Partial<Record<Measure, string>> = {
  oldfavorites: "old favorites",
  firstlistens: "first listens",
};

/** When the condition's next event starts after `now` (6.5), from the sky
    data. A window that only continues an event (Venus coming back into Aries
    after backing out during her retrograde) isn't a start. */
function nextStartOf(id: QuestionId, nowUts: number): { start: number; window: number } | null {
  const c = conditionFor(id);
  if (!c) return null;
  const i = c.windows.findIndex(
    (w, k) => w.start > nowUts && (k === 0 || c.windows[k - 1].event !== w.event),
  );
  return i === -1 ? null : { start: c.windows[i].start, window: i };
}

function tooEarly(q: Question, rec: QuestionRecord, zone: string, nowUts: number, next: number | null): string {
  switch (rec.status) {
    case "too-few-events": {
      const n = rec.events;
      let s = `Too early. ${count(n)} of the ${MIN_EVENTS} ${q.eventNoun.many} a verdict needs.`;
      // An early read's last line already says one can't show a pattern (9.2, 2 Oct 2026).
      if (n === 1 && rec.typicalSingleSwing === null) s += ` One ${q.eventNoun.one} can't show a pattern.`;
      else if (n > 1) s += ` ${capital(spelled(n))} ${q.eventNoun.many} can't show a pattern yet.`;
      if (q.nasa) {
        s += ` ${q.id === "flares" ? "Flares" : "Storms"} come when the Sun sends them, so the next one can't be predicted far ahead.`;
      } else if (next !== null) {
        const when = startsWhen(zone, nowUts, next);
        s += when ? ` The next one begins ${when}.` : ` The next one is expected around ${monthYear(zone, next)}.`;
      }
      return s;
    }
    case "too-few-plays":
      return (
        `Too early. ${count(rec.inPlays)} of the ${count(MIN_RETRO_N)} plays a verdict needs ${q.when}. ` +
        `How soon depends on how much you listen and how often ${q.howOften}.`
      );
    case "warming-up": {
      const noun = WARMUP_NOUN[q.measure] ?? TAG_NOUN[q.measure];
      return rec.warmupReadyFrom
        ? `Too early. ${capital(noun)} start counting in ${monthYear(zone, rec.warmupReadyFrom)}, a year after your history starts.`
        : `Too early. ${capital(noun)} start counting a year after your history starts.`;
    }
    case "no-comparison":
      return (
        `Too early. There's nothing to compare yet: this needs some of your ${TAG_NOUN[q.measure]} ` +
        `both ${q.when} and the rest of the time.`
      );
    default:
      return "";
  }
}

/** Tonight's line for a question that's too early (9.2): the question
    sheet's first sentence without "Too early.". */
function tooEarlyShort(q: Question, rec: QuestionRecord, zone: string): string {
  switch (rec.status) {
    case "too-few-events":
      return `${count(rec.events)} of the ${MIN_EVENTS} ${q.eventNoun.many} a verdict needs.`;
    case "too-few-plays":
      return `${count(rec.inPlays)} of the ${count(MIN_RETRO_N)} plays a verdict needs ${q.when}.`;
    case "warming-up": {
      const noun = capital(WARMUP_NOUN[q.measure] ?? TAG_NOUN[q.measure]);
      return rec.warmupReadyFrom
        ? `${noun} start counting in ${monthYear(zone, rec.warmupReadyFrom)}.`
        : `${noun} start counting a year after your history starts.`;
    }
    default:
      return "Nothing to compare yet.";
  }
}

/** Tonight's line for a question that couldn't be checked (6.6). */
const NOT_CHECKED_SHORT: Record<NotChecked, string> = {
  nasa: "NASA's log didn't load.",
  error: "Something went wrong on our side.",
};

/** "in your three years", "in your 20 years", "in your 18 months": whole
    years from 2, months under, always rounded down (`historySpan`). */
function spanWords(start: number, end: number): string {
  const { months, years } = historySpan(start, end);
  if (months >= 24) return `in your ${spelled(years)} years`;
  if (months < 1) return "in your few weeks";
  return `in your ${spelled(months)} month${months === 1 ? "" : "s"}`;
}

/** "What happened" (8.7.3, changed 2 Oct 2026): only the count, since the
    word line above it already says the swing. */
function whatHappened(q: Question, rec: QuestionRecord): string {
  const noun = rec.events === 1 ? q.eventNoun.one : q.eventNoun.many;
  return `Counted across ${count(rec.events)} ${noun} ${spanWords(rec.spanStart, rec.spanEnd)}.`;
}

const PRONOUN: Partial<Record<SkyBody, { she: string; her: string }>> = {
  Venus: { she: "she", her: "her" },
  Mars: { she: "he", her: "his" },
  Mercury: { she: "it", her: "its" },
};

/**
 * "Venus in Aries Feb 4 to Jun 5, 2025 counts once: she backed into Pisces
 * Mar 27 during her retrograde and returned Apr 30." (8.7.3). One sentence per
 * merged event, newest first, at most three.
 */
function eventsNote(q: Question, merged: MergedEvent[], zone: string): string | null {
  // Storm and flare nights merge by being consecutive, which the event noun
  // ("stretches of storm nights") already says.
  if (merged.length === 0 || q.nasa) return null;
  const c = conditionFor(q.id);
  const sentences = [...merged]
    .reverse()
    .slice(0, 3)
    .map((e) => {
      const when = dateRange(zone, e.start, e.end);
      if (c?.kind === "aspect") {
        const name = e.windows[0].aspect === 120 ? "trine" : "sextile";
        return `The ${name} between Venus and Mars, ${when}, counts once: they drifted out of it and back in.`;
      }
      const body = c?.body ?? "Venus";
      const p = PRONOUN[body] ?? { she: "it", her: "its" };
      const signs = [...new Set(e.windows.map((w) => w.sign))].join(" and ");
      const gaps = e.windows.slice(1).map((w, i) => {
        const left = e.windows[i].end;
        const outside = signOf(longitude(body, new Date((left + 3600) * 1000)));
        const back = shortDate(localDate(zone, w.start), false);
        const away = shortDate(localDate(zone, left), false);
        return isRetrograde(body, new Date(left * 1000))
          ? `${p.she} backed into ${outside} ${away} during ${p.her} retrograde and returned ${back}`
          : `${p.she} moved on into ${outside} ${away}, then backed in again ${back} during ${p.her} retrograde`;
      });
      return `${body} in ${signs} ${when} counts once: ${gaps.join(", and ")}.`;
    });
  const more = merged.length - 3;
  if (more > 0) sentences.push(`${capital(spelled(more))} more count${more === 1 ? "s" : ""} once the same way.`);
  return sentences.join(" ");
}

function earlyReadRow(q: Question, r: EarlyRead, zone: string): string {
  const when = dateRange(zone, r.start, r.end);
  if (r.firstYear) return `${when}: in your first year, before ${WARMUP_NOUN[q.measure] ?? TAG_NOUN[q.measure]} count.`;
  const what = r.swing === null ? "no plays to compare" : swingShort(q.measure, r.swing);
  return `${when}: ${what}${r.inProgress ? " (in progress)" : ""}.`;
}

/** The early reads' rows (6.5). For every question with a warm-up (1, 3, 5
    and 11), two or more first-year events share one line: the Moon is strong
    about twice a month, and a history just past a year would list over 25.
    One keeps its own row. */
function earlyReadRows(q: Question, reads: EarlyRead[], zone: string): string[] {
  const firstYear = reads.filter((r) => r.firstYear);
  if (firstYear.length < 2) return reads.map((r) => earlyReadRow(q, r, zone));
  const n = firstYear.length;
  const when = dateRange(zone, firstYear[0].start, firstYear[n - 1].end);
  const noun = WARMUP_NOUN[q.measure] ?? TAG_NOUN[q.measure];
  const line = `${capital(spelled(n))} ${q.eventNoun.many} in your first year, ${when}, came before ${noun} count.`;
  return [line, ...reads.filter((r) => !r.firstYear).map((r) => earlyReadRow(q, r, zone))];
}

/** A question stored under another measure, while it's recomputed. */
const CHECKING = "Checking this question against your sky\u2026";

/** How much one stretch swings on its own (6.5, changed 2 Oct 2026), the
    measure in its own words and the question's event noun: "At an ordinary
    time, a stretch this long usually swings your share of old favorites by
    up to about 20% either way, so one retrograde can't show a pattern."
    "about 20%": whole percents under 10, then in fives, rounded up so the
    line never understates what chance does on its own. */
function typicalSwing(q: Question, fraction: number): string {
  const pct = fraction * 100;
  const n = pct < 10 ? Math.max(1, Math.ceil(pct - 1e-9)) : Math.ceil(pct / 5 - 1e-9) * 5;
  return (
    `At an ordinary time, a stretch this long usually swings ${MEASURE_WORDS[q.measure].now} by up to about ${count(n)}% ` +
    `either way, so one ${q.eventNoun.one} can't show a pattern.`
  );
}

const STATIONS: QuestionId[] = ["mercury", "venusrx", "marsrx"];
const SIGN_CHANGES: QuestionId[] = ["venushome", "marswater", "venusdet"];
const ASPECTS: QuestionId[] = ["venusmars"];

/**
 * A question's heads-up (8.4): its condition's next start within a week, the
 * sky relative to the listener's date ("Venus turns retrograde Saturday"),
 * then the line under it: Tonight's line when the question is tested ("While
 * Venus was retrograde, …"); otherwise what the listener has lived through,
 * "You've lived through one. See how your listening went.", "It'll be your
 * first.", or, when the only one fell before the measure counts, "You've
 * lived through one, in your first year, before old favorites count." Never
 * "see what it did": that says Venus did something to the listener (9.6).
 */
function headsUp(
  q: Question,
  rec: QuestionRecord,
  record: AnswerRecord,
  zone: string,
  nowUts: number,
  testedLine: string | null,
): { skyLine: string; line: string } | null {
  if (![...STATIONS, ...SIGN_CHANGES, ...ASPECTS].includes(q.id)) return null;
  const next = nextStartOf(q.id, nowUts);
  const c = conditionFor(q.id);
  if (!next || !c || next.start - nowUts > 7 * DAY) return null;
  const when = startsWhen(zone, nowUts, next.start);
  const w = c.windows[next.window];
  const opening: Record<string, string> = {
    mercury: "Mercury turns retrograde",
    venusrx: "Venus turns retrograde",
    marsrx: "Mars turns retrograde",
    venushome: `Venus comes home to ${w.sign}`,
    marswater: `Mars enters ${w.sign}, a water sign,`,
    venusdet: `Venus enters ${w.sign}, her detriment,`,
    venusmars: `Venus and Mars come into ${w.aspect === 120 ? "trine" : "sextile"}`,
  };
  const skyLine = `${opening[q.id]} ${when}`;
  if (testedLine) return { skyLine, line: testedLine };
  // The events lived through so far, the first year included.
  const lived = new Set(
    c.windows.filter((x) => x.end >= record.historyStart && x.start <= Math.min(record.historyEnd, nowUts)).map((x) => x.event),
  );
  const n = lived.size;
  const firstYearOnly =
    rec.warmupReadyFrom !== null &&
    n === 1 &&
    c.windows.filter((x) => lived.has(x.event)).every((x) => x.end < rec.warmupReadyFrom!);
  const line =
    n === 0
      ? "It'll be your first."
      : firstYearOnly
        ? `You've lived through one, in your first year, before ${WARMUP_NOUN[q.measure]} count.`
        : `You've lived through ${spelled(n)}. See how your listening went.`;
  return { skyLine, line };
}

/* ---- Pairings (8.7.3) ------------------------------------------------------ */

const RETROGRADE_OF: Partial<Record<QuestionId, SkyBody>> = { mercury: "Mercury", venusrx: "Venus", marsrx: "Mars" };
const SIGN_BODY: Partial<Record<QuestionId, SkyBody>> = { venushome: "Venus", venusdet: "Venus", moonstrong: "Moon", marswater: "Mars" };

/**
 * The chip on a pairing's card (8.7.3, 7.4): this question's condition at
 * that song's first play, in 9.3's words. "Venus in Aries · in her
 * detriment", "Moon in Taurus · exalted", "Full moon", "Mercury retrograde",
 * "Venus and Mars in trine", "Kp 7 storm night", "X5.8 flare night". Mars in
 * a water sign says the element it tests: "Mars in Pisces · a water sign".
 * The sign and the aspect are the window's own, the one that put the song
 * here.
 */
function conditionText(id: QuestionId, f: PairingFact): string {
  const rx = RETROGRADE_OF[id];
  if (rx) return `${rx} retrograde`;
  if (id === "fullmoon") return "Full moon";
  if (id === "newmoon") return "New moon";
  if (id === "storms") return f.kp === undefined ? "Storm night" : `${kpLabel(f.kp)} storm night`;
  if (id === "flares") return f.flare ? `${f.flare} flare night` : "X-flare night";
  const w = conditionFor(id)?.windows.find((x) => f.at >= x.start && f.at <= x.end);
  const date = new Date(f.at * 1000);
  if (id === "venusmars") {
    const aspect = w?.aspect ?? harmonyAt(date)?.aspect ?? 60;
    return `Venus and Mars in ${aspect === 120 ? "trine" : "sextile"}`;
  }
  const body = SIGN_BODY[id]!;
  const sign: Sign = w?.sign ?? signOf(longitude(body, date));
  return `${body} in ${sign} · ${id === "marswater" ? "a water sign" : dignityPhrase(body, sign)}`;
}

/** A record before format 4 kept bare song ids, with no first-play time to
    word a chip from: those wait for the recompute its format asks for. */
function pairingsOf(id: QuestionId, stored: QuestionRecord["pairings"] | undefined): PairingPayload[] {
  return (stored ?? []).flatMap((p) => (typeof p === "string" ? [] : [{ songId: p.songId, conditionText: conditionText(id, p) }]));
}

const emptyRecord: QuestionRecord = {
  id: "mercury",
  status: null,
  notChecked: null,
  index: null,
  p: null,
  matches: 0,
  iterations: 0,
  rangeC: null,
  inPlays: 0,
  events: 0,
  spanStart: 0,
  spanEnd: 0,
  warmupReadyFrom: null,
  merged: [],
  earlyReads: [],
  typicalSingleSwing: null,
  nullSamples: [],
  pairings: [],
};

export interface ComputingPayload {
  status: "computing";
  done: number;
  total: number;
  stamp: null;
  nasaStamp: null;
  version: number;
  m: 0;
  tally: null;
  questions: [];
  headsUp: null;
  /** Tonight's line while the answers are on their way (8.4). */
  line: string;
}

/** While the history is still being read: nothing is computed yet. */
export function computingPayload(): ComputingPayload {
  return {
    status: "computing",
    done: 0,
    total: QUESTIONS.length,
    stamp: null,
    nasaStamp: null,
    version: ANSWERS_VERSION,
    m: 0,
    tally: null,
    questions: [],
    headsUp: null,
    line: `Checking ${QUESTIONS.length} questions against your sky\u2026 0 of ${QUESTIONS.length}`,
  };
}

/**
 * The reveal's last card (8.3), the first line that applies: nothing tested
 * yet, more than half too early, any Yes, any Maybe, otherwise No. "The first
 * to arrive" is the earliest warm-up end or next event among the questions
 * held back only by events or the warm-up; plays have no date to promise.
 * Nothing tested with some still checking or not checked says what's true,
 * by count, never "Too early for all 12" (architect, 2 Oct 2026); the line
 * counts those, so the card's "{n} not checked yet" is left off.
 */
function revealLines(
  questions: QuestionPayload[],
  tally: Record<AnswerWord, number>,
  zone: string,
  nowUts: number,
): AnswersPayload["reveal"] {
  const notChecked = tally["Not checked"] > 0 ? `${capital(spelled(tally["Not checked"]))} not checked yet` : null;
  const tested = questions.filter((q) => q.status === "tested" && !q.updating);
  let line: string;
  const pending = tally.Checking + tally["Not checked"];
  if (tested.length === 0 && pending > 0) {
    const early = tally["Too early"];
    const parts = [
      ...(early > 0 ? [`${spelled(early)} ${early === 1 ? "needs" : "need"} more history`] : []),
      `${spelled(pending)} ${pending === 1 ? "is" : "are"} still being checked`,
    ];
    return { line: `No answers yet: ${parts.join(", ")}.`, notChecked: null };
  }
  if (tested.length === 0) {
    const arriving = questions
      .map((q) => ({
        q,
        at: q.status === "warming-up" ? q.warmupReadyFrom : q.status === "too-few-events" ? q.nextStart : null,
      }))
      .filter((x): x is { q: QuestionPayload; at: number } => x.at !== null && x.at > nowUts)
      .sort((a, b) => a.at - b.at)[0];
    line = arriving
      ? `Too early for all 12. The first to arrive: Question ${arriving.q.number}: ${arriving.q.shortName}, around ${monthYear(zone, arriving.at)}.`
      : "Too early for all 12. They arrive as more of your listening falls under each sky.";
  } else if (tally["Too early"] > questions.length / 2) {
    const first = questionById(tested[0].id);
    line = `Too early for most. Here's what ${first.subject} already ${first.plural ? "say" : "says"}.`;
  } else if (tally.Yes > 0) {
    line = `${capital(spelled(tally.Yes))} yes. Here's exactly how, and how sure.`;
  } else if (tally.Maybe > 0) {
    line = `Mostly no. Here's exactly how, and the ${tally.Maybe === 1 ? "one maybe" : `${spelled(tally.Maybe)} maybes`}.`;
  } else {
    line = "No, as far as we can tell. Here's exactly how much.";
  }
  return { line, notChecked };
}

/** A question whose stored numbers measured something else: none of them
    are shown, and no sentence is built from them. What depends only on the
    sky stays: the next start, the songs first played under it, and the
    heads-up, with today's warm-up in place of the stored one. */
function checking(q: Question, rec: QuestionRecord, record: AnswerRecord, nowUts: number): QuestionPayload {
  const warmupReadyFrom = q.warmupDays > 0 ? record.historyStart + q.warmupDays * DAY : null;
  return {
    id: q.id,
    number: q.number,
    question: q.question,
    story: q.story,
    shortName: q.shortName,
    subject: q.subject,
    status: null,
    notChecked: null,
    updating: true,
    word: "Checking",
    pct: null,
    p: null,
    pAdjusted: null,
    matches: 0,
    iterations: 0,
    range: null,
    events: 0,
    eventsNote: null,
    inPlays: 0,
    warmupReadyFrom: null,
    earlyReads: [],
    typicalSingleSwing: null,
    nextStart: q.nasa ? null : (nextStartOf(q.id, nowUts)?.start ?? null),
    pairings: pairingsOf(q.id, rec.pairings),
    nullSamples: [],
    phrases: {
      wordLine: CHECKING,
      tonightLine: CHECKING,
      swing: null,
      chance: null,
      likelihood: null,
      frequency: null,
      range: null,
      tooEarly: null,
      whatHappened: null,
      warmup: null,
      pValueNote: null,
      correctionNote: null,
      earlyReadRows: [],
      typicalSwing: null,
      headsUp: headsUp(q, { ...rec, warmupReadyFrom }, record, record.zone, nowUts, null),
    },
  };
}

/**
 * The payload for a stored record. `status` is "updating" when the record is
 * being refreshed in the background (6.6), and always when a question is
 * checking: `done` leaves those out.
 */
export function answersPayload(
  record: AnswerRecord,
  status: "ready" | "updating",
  now = Date.now(),
): AnswersPayload {
  const nowUts = Math.floor(now / 1000);
  const zone = record.zone;
  // By id, not position, so a reordered or older record can't mislabel one.
  const byId = new Map(record.questions.map((r) => [r.id, r]));
  const recs = QUESTIONS.map((q) => byId.get(q.id) ?? { ...emptyRecord, id: q.id, notChecked: "error" as const });
  /* A question stored under another measure (an older version's) answers a
     different question: it's served as checking on its own until it's
     recomputed, and the rest serve exactly as stored (architect, 1 Oct 2026).
     So the correction still counts its stored test: leaving it out would
     re-correct the others with a smaller m, and could turn a Maybe into a Yes
     that no data supports. */
  const stale = recs.map((r) => !measuresToday(record, r));
  const { m, words, pAdjusted } = answerWords(recs.map((r) => (r.status === "tested" ? r.p : null)));

  const questions = QUESTIONS.map((q, i): QuestionPayload => {
    const rec = recs[i];
    if (stale[i]) return checking(q, rec, record, nowUts);
    const tested = rec.status === "tested";
    const word: AnswerWord = rec.notChecked ? "Not checked" : tested ? words[i]! : "Too early";
    const swing = rec.index === null ? 0 : rec.index - 1;
    const next = q.nasa ? null : (nextStartOf(q.id, nowUts)?.start ?? null);
    const range = tested && rec.index !== null ? rangeSentence(q, word, rec.index, rec.rangeC) : null;
    const early = rec.status === "too-few-events";
    const tonight = rec.notChecked
      ? NOT_CHECKED_SHORT[rec.notChecked]
      : tested
        ? tonightLine(q, word, swing, rec.p!, m)
        : tooEarlyShort(q, rec, zone);
    const phrases: QuestionPhrases = {
      wordLine: rec.notChecked
        ? NOT_CHECKED[rec.notChecked]
        : tested
          ? wordLine(q, word, swing, rec.p!, m)
          : tooEarly(q, rec, zone, nowUts, next),
      tonightLine: tonight,
      swing: tested ? capital(swingShort(q.measure, swing)) : null,
      chance: tested ? chanceLine(word, rec.p!, m) : null,
      likelihood: tested ? likelihoodFor(rec.p!) : null,
      frequency: tested ? frequency(rec.p!, rec.matches, rec.iterations) : null,
      range: range?.line ?? null,
      tooEarly: !rec.notChecked && !tested ? tooEarly(q, rec, zone, nowUts, next) : null,
      whatHappened: tested ? whatHappened(q, rec) : null,
      warmup:
        tested && q.warmupDays > 0
          ? q.measure === "oldfavorites"
            ? "Counted from your second year: it takes a year to know your old favorites."
            : "Counted from your second year: in your first year, almost everything is a first listen."
          : null,
      pValueNote: tested
        ? `p = ${formatP(rec.p!)}: the share of ${count(rec.iterations)} shuffled skies (plus the real one) ` +
          `that matched or beat this swing. Under 0.05 is the usual bar for 'unlikely to be chance'.`
        : null,
      correctionNote: !tested
        ? null
        : m === 1
          ? "Retrospect allows for asking several questions at once with a false-discovery correction " +
            "(Benjamini-Hochberg at 10%). Only this one could be tested so far, so the correction changes nothing yet."
          : `Retrospect allows for asking ${questionsAtOnce(m)} at once with a false-discovery correction ` +
            `(Benjamini-Hochberg at 10%). A Yes needs this question's adjusted p at most 0.10 and its own p ` +
            `under 0.05. Adjusted p here: ${formatP(pAdjusted[i]!, "up")}.`,
      earlyReadRows: early ? earlyReadRows(q, rec.earlyReads, zone) : [],
      typicalSwing: early && rec.typicalSingleSwing !== null ? typicalSwing(q, rec.typicalSingleSwing) : null,
      headsUp: rec.notChecked ? null : headsUp(q, rec, record, zone, nowUts, tested ? tonight : null),
    };
    return {
      id: q.id,
      number: q.number,
      question: q.question,
      story: q.story,
      shortName: q.shortName,
      subject: q.subject,
      status: rec.status,
      notChecked: rec.notChecked,
      updating: false,
      word,
      // The swing and p of a test that ran; an untested question has neither to show.
      pct: tested && rec.index !== null ? Math.round(swing * 1000) / 10 : null,
      p: tested ? rec.p : null,
      pAdjusted: tested ? pAdjusted[i] : null,
      matches: rec.matches,
      iterations: rec.iterations,
      range: range?.range ?? null,
      events: rec.events,
      eventsNote: tested || early ? eventsNote(q, rec.merged, zone) : null,
      inPlays: rec.inPlays,
      warmupReadyFrom: rec.warmupReadyFrom,
      earlyReads: early ? rec.earlyReads : [],
      typicalSingleSwing: early ? rec.typicalSingleSwing : null,
      nextStart: next,
      pairings: pairingsOf(q.id, rec.pairings),
      nullSamples: rec.nullSamples,
      phrases,
    };
  });

  const tally = { Yes: 0, Maybe: 0, "Not clearly": 0, No: 0, "Too early": 0, "Not checked": 0, Checking: 0 } as Record<
    AnswerWord,
    number
  >;
  for (const q of questions) tally[q.word]++;

  // One heads-up for Tonight (8.4): stations first, then sign changes, then
  // aspects, the soonest within each.
  let top: AnswersPayload["headsUp"] = null;
  for (const group of [STATIONS, SIGN_CHANGES, ASPECTS]) {
    const candidates = questions
      .filter((q) => group.includes(q.id) && q.phrases.headsUp && q.nextStart !== null)
      .sort((a, b) => a.nextStart! - b.nextStart!);
    if (candidates.length) {
      top = { id: candidates[0].id, ...candidates[0].phrases.headsUp! };
      break;
    }
  }

  return {
    reveal: revealLines(questions, tally, zone, nowUts),
    status: tally.Checking > 0 ? "updating" : status,
    done: questions.length - tally.Checking,
    total: questions.length,
    stamp: record.stamp,
    nasaStamp: record.nasaStamp,
    version: record.version,
    m,
    tally,
    questions,
    headsUp: top,
  };
}
