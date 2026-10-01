import { MIN_EVENTS, MIN_RETRO_N, type VerdictStatus } from "@/lib/analysis/confidence";
import { isRetrograde, longitude, signOf, type SkyBody } from "@/lib/sky/sky";
import { zoneClock } from "@/lib/zone";
import { conditionFor } from "./conditions";
import { ANSWERS_VERSION, type AnswerRecord, type EarlyRead, type MergedEvent, type NotChecked, type QuestionRecord } from "./engine";
import { QUESTIONS, type Measure, type Question, type QuestionId } from "./questions";
import { answerWords, likelihoodFor, type AnswerWord } from "./words";

/**
 * The answers endpoint's payload (spec 7.4): the stored numbers, the words
 * (6.3) worked out from them, and every sentence the client shows (9.1, 9.2,
 * 8.4, 8.7.3), so no client code needs `src/lib/likelihood.ts`. Built on every
 * request from the stored record, so the sentences that depend on the moment
 * ("The next one begins Saturday", the heads-up) are always current.
 */

export interface QuestionPhrases {
  wordLine: string;
  tonightLine: string;
  likelihood: string | null;
  frequency: string | null;
  range: string | null;
  tooEarly: string | null;
  whatHappened: string | null;
  warmup: string | null;
  pValueNote: string | null;
  correctionNote: string | null;
  earlyReadRows: string[];
  typicalSwing: string | null;
  headsUp: string | null;
}

export interface QuestionPayload {
  id: QuestionId;
  number: number;
  question: string;
  story: string;
  shortName: string;
  status: VerdictStatus | null;
  notChecked: NotChecked | null;
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
  /** Songs first played while the condition held (7.4), as song ids. */
  pairings: string[];
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
  /** Tonight's one heads-up (8.4), or null. */
  headsUp: { id: QuestionId; line: string } | null;
}

const DAY = 86_400;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
  weekday: number;
  /** Days since 1970 on the local calendar, for "today" and "tomorrow". */
  serial: number;
}

function localDate(zone: string, uts: number): LocalDate {
  const local = zoneClock(zone, uts).localSeconds(uts);
  const d = new Date(local * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    serial: Math.floor(local / DAY),
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

/** When something starts, from now: "today", "tomorrow", "Saturday" within a
    week, "Oct 24" within a year, else null (the caller says "around"). */
function startsWhen(zone: string, nowUts: number, uts: number): string | null {
  const now = localDate(zone, nowUts);
  const at = localDate(zone, uts);
  const days = at.serial - now.serial;
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return WEEKDAYS[at.weekday];
  if (uts - nowUts <= 365 * DAY) return shortDate(at, at.year !== now.year);
  return null;
}

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

/** "a 23% bigger share of your plays came after midnight", "you listened 5% more". */
function swingLong(measure: Measure, swing: number): string {
  if (barely(swing)) {
    return measure === "listening"
      ? "how much you listened barely moved: less than 1% either way"
      : `your share of ${TAG_NOUN[measure]} barely moved: less than 1% either way`;
  }
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

function tonightLine(q: Question, word: AnswerWord, swing: number, p: number, m: number): string {
  const short = swingShort(q.measure, swing);
  switch (word) {
    case "Yes":
      return m === 1 ? `Yes: ${short}.` : `Yes: ${short}, even allowing for ${questionsAtOnce(m)}.`;
    case "Maybe":
      return p < 0.05
        ? `Maybe: ${short}, unlikely on its own but not after allowing for ${questionsAtOnce(m)}.`
        : `Maybe: ${short}, which could be chance.`;
    case "Not clearly":
      return `Not clearly: ${short}, which could be chance.`;
    default:
      return `No: ${short}, which could easily be chance.`;
  }
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
      if (n === 1) s += ` One ${q.eventNoun.one} can't show a pattern.`;
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

function tooEarlyShort(q: Question, rec: QuestionRecord, zone: string): string {
  switch (rec.status) {
    case "too-few-events":
      return `Too early: ${count(rec.events)} of the ${MIN_EVENTS} ${q.eventNoun.many} a verdict needs.`;
    case "too-few-plays":
      return `Too early: ${count(rec.inPlays)} of the ${count(MIN_RETRO_N)} plays a verdict needs.`;
    case "warming-up": {
      const noun = WARMUP_NOUN[q.measure] ?? TAG_NOUN[q.measure];
      return rec.warmupReadyFrom
        ? `Too early: ${noun} start counting in ${monthYear(zone, rec.warmupReadyFrom)}.`
        : `Too early: ${noun} start counting after your first year.`;
    }
    default:
      return "Too early: nothing to compare yet.";
  }
}

/** "in your three years", "in your 20 years", "in your eight months". */
function spanWords(seconds: number): string {
  const years = seconds / (365.25 * DAY);
  if (years >= 1.5) {
    const n = Math.round(years);
    return `in your ${spelled(n)} years`;
  }
  const months = Math.max(1, Math.round(seconds / (30.44 * DAY)));
  return `in your ${spelled(months)} month${months === 1 ? "" : "s"}`;
}

function whatHappened(q: Question, rec: QuestionRecord, swing: number): string {
  const long = swingLong(q.measure, swing);
  // "You listened 1% more than usual"; a share's "bigger" already compares.
  const thanUsual = barely(swing) || q.measure !== "listening" ? "" : " than usual";
  const noun = rec.events === 1 ? q.eventNoun.one : q.eventNoun.many;
  return `${capital(q.when)}, ${long}${thanUsual}, across ${count(rec.events)} ${noun} ${spanWords(rec.spanEnd - rec.spanStart)}.`;
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

/** "about 20%": whole percents under 10, then in fives, rounded up so the
    line never understates what chance does on its own. */
function typicalSwing(fraction: number): string {
  const pct = fraction * 100;
  const n = pct < 10 ? Math.max(1, Math.ceil(pct - 1e-9)) : Math.ceil(pct / 5 - 1e-9) * 5;
  return `One ordinary stretch this long usually moves less than about ${count(n)}% either way.`;
}

const STATIONS: QuestionId[] = ["mercury", "venusrx", "marsrx"];
const SIGN_CHANGES: QuestionId[] = ["venushome", "marswater", "venusdet"];
const ASPECTS: QuestionId[] = ["venusmars"];

/** "Venus turns retrograde Saturday. You've lived through one; see how your
    listening went." Never "see what it did": that says Venus did something
    to the listener (9.6). */
function headsUp(q: Question, rec: QuestionRecord, record: AnswerRecord, zone: string, nowUts: number): string | null {
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
  // The events lived through so far, the first year included.
  const lived = new Set(
    c.windows.filter((x) => x.end >= record.historyStart && x.start <= Math.min(record.historyEnd, nowUts)).map((x) => x.event),
  );
  const n = lived.size;
  const firstYearOnly =
    rec.warmupReadyFrom !== null &&
    n === 1 &&
    c.windows.filter((x) => lived.has(x.event)).every((x) => x.end < rec.warmupReadyFrom!);
  const second =
    n === 0
      ? "It'll be your first."
      : firstYearOnly
        ? `You've lived through one, in your first year, before ${WARMUP_NOUN[q.measure]} count.`
        : `You've lived through ${spelled(n)}; see how your listening went.`;
  return `${opening[q.id]} ${when}. ${second}`;
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
 * The payload for a stored record. `status` is "updating" when the record is
 * being refreshed in the background (6.6).
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
  const { m, words, pAdjusted } = answerWords(recs.map((r) => (r.status === "tested" ? r.p : null)));

  const questions = QUESTIONS.map((q, i): QuestionPayload => {
    const rec = recs[i];
    const tested = rec.status === "tested";
    const word: AnswerWord = rec.notChecked ? "Not checked" : tested ? words[i]! : "Too early";
    const swing = rec.index === null ? 0 : rec.index - 1;
    const next = q.nasa ? null : (nextStartOf(q.id, nowUts)?.start ?? null);
    const range = tested && rec.index !== null ? rangeSentence(q, word, rec.index, rec.rangeC) : null;
    const early = rec.status === "too-few-events";
    const phrases: QuestionPhrases = {
      wordLine: rec.notChecked
        ? NOT_CHECKED[rec.notChecked]
        : tested
          ? wordLine(q, word, swing, rec.p!, m)
          : tooEarly(q, rec, zone, nowUts, next),
      tonightLine: rec.notChecked
        ? NOT_CHECKED[rec.notChecked]
        : tested
          ? tonightLine(q, word, swing, rec.p!, m)
          : tooEarlyShort(q, rec, zone),
      likelihood: tested ? likelihoodFor(rec.p!) : null,
      frequency: tested ? frequency(rec.p!, rec.matches, rec.iterations) : null,
      range: range?.line ?? null,
      tooEarly: !rec.notChecked && !tested ? tooEarly(q, rec, zone, nowUts, next) : null,
      whatHappened: tested ? whatHappened(q, rec, swing) : null,
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
      earlyReadRows: early ? rec.earlyReads.map((r) => earlyReadRow(q, r, zone)) : [],
      typicalSwing: early && rec.typicalSingleSwing !== null ? typicalSwing(rec.typicalSingleSwing) : null,
      headsUp: rec.notChecked ? null : headsUp(q, rec, record, zone, nowUts),
    };
    return {
      id: q.id,
      number: q.number,
      question: q.question,
      story: q.story,
      shortName: q.shortName,
      status: rec.status,
      notChecked: rec.notChecked,
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
      pairings: rec.pairings ?? [],
      nullSamples: rec.nullSamples,
      phrases,
    };
  });

  const tally = { Yes: 0, Maybe: 0, "Not clearly": 0, No: 0, "Too early": 0, "Not checked": 0 } as Record<AnswerWord, number>;
  for (const q of questions) tally[q.word]++;

  // One heads-up for Tonight (8.4): stations first, then sign changes, then
  // aspects, the soonest within each.
  let top: AnswersPayload["headsUp"] = null;
  for (const group of [STATIONS, SIGN_CHANGES, ASPECTS]) {
    const candidates = questions
      .filter((q) => group.includes(q.id) && q.phrases.headsUp && q.nextStart !== null)
      .sort((a, b) => a.nextStart! - b.nextStart!);
    if (candidates.length) {
      top = { id: candidates[0].id, line: candidates[0].phrases.headsUp! };
      break;
    }
  }

  return {
    status,
    done: questions.length,
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
