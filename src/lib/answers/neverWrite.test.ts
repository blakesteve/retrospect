import { describe, expect, it } from "vitest";
import { nasaLogFrom, type DonkiCompact } from "@/lib/space/compact";
import { conditionFor } from "./conditions";
import { computeAnswers, type AnswerRecord, type QuestionRecord } from "./engine";
import { answersPayload, computingPayload } from "./payload";
import { QUESTIONS, type QuestionId } from "./questions";
import { synthHistory } from "./synthHistory";
import donki from "./testdata/donki-compact.json";

/* Spec 9.6, added 1 Oct 2026: no claim that the sky causes a mood, a state
   or an event in Retrospect's own voice, so none of the mechanism words; and
   no advice, so no sentence opens on an imperative outside the interface's
   own verbs. Checked over every sentence the answers payload can return, in
   every status, and over the 12 stories.

   An imperative can't be told from other words without a grammar, so the
   rule is an allow-list: every clause opens on a word in OPENERS. A new
   sentence that opens on a new word fails here until someone adds the word,
   which is the moment to ask whether it's advice. */

/** The mechanism words 9.6 names, and their forms, and "vibes". */
const MECHANISM = /\b(electromagnet\w*|energ(y|ies|etic|ize[sd]?|izing)|vibrat\w*|vibes?|frequenc(y|ies)|download\w*|activat\w*)\b/i;

/** 9.6's advice that doesn't open a sentence: "It's a good time to…". */
const ADVICE_PHRASE = /\b((a|the) (good|great|bad|better|best|perfect|right|wrong) (time|day|week|moment) (to|for)|you should|you must|you need to|you'll want to|make sure|be sure to|don't|do not)\b/i;

/** Every word a payload clause or story opens on today. None is advice; a
    number ("23% more…", "1,240 of the 500…") opens on no word. */
const OPENERS = new Set([
  // Answer words, and the likelihood and correction phrases (6.3, 9.1).
  "yes", "maybe", "no", "not", "too", "could", "unlikely", "very", "under", "only", "adjusted", "p", "retrospect",
  "less", // "…barely moved: less than 1% either way"
  // Articles, pronouns and the like.
  "a", "an", "the", "this", "it", "it'll", "there's", "they", "she", "he", "you've", "something", "nothing",
  // Where and when: "Around full moons, …", "If Mercury retrograde moves you at all, …".
  "about", "around", "from", "if", "in", "on", "when", "while", "how",
  // Counts in words (`spelled`), and month names ("Mar 1 to Apr 12, 2025: …").
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sept", "oct", "nov", "dec",
  // The sky, the measures, and the stories' adjectives.
  "venus", "mars", "mercury", "storms", "flares", "solar", "xclass", "nasa's", "full", "new", "strong", "old",
  "first", "listening", "counted", "checking", "big", "bold", "comfort", "dignified", "opposite",
  // An interface verb (9.6): "You've lived through two; see how your listening went."
  "see",
  // 8.7.3's own sentence, a thought experiment rather than advice: "Shuffle
  // the sky and a swing this big, up or down, turns up about 3 times in 10."
  "shuffle",
]);

/** What a question ("Do solar storms change how late you listen?") opens on. */
const ASKS = new Set(["do", "does", "did", "is", "are", "was", "when", "while", "what", "how", "which", "can", "could", "will"]);

/** The interface verbs 9.6 allows ("Tap any planet", "Try another username").
    One joins OPENERS when copy first opens on it. */
const INTERFACE = new Set(["tap", "try", "show", "see", "open", "replay", "use", "clear", "check", "share", "compare", "scroll"]);

/** Verbs a sentence of advice opens on, to keep out of OPENERS. */
const ADVICE = new Set([
  "let", "don't", "do", "avoid", "pause", "start", "stop", "take", "make", "wait", "consider", "remember",
  "keep", "go", "listen", "find", "embrace", "trust", "focus", "give", "allow", "release", "set", "ground",
  "meditate", "drink", "rest", "plan", "slow", "reflect", "journal", "protect", "hold", "buy", "sell",
  "invest", "spend", "save", "call", "text", "reach", "forgive", "breathe", "notice", "honor", "celebrate",
  "welcome", "accept", "prepare", "expect", "beware", "watch", "look", "seek", "choose", "decide", "begin",
  "finish", "be", "stay", "lean", "cleanse", "manifest", "charge", "align", "never", "always", "get",
  "put", "leave", "move", "turn", "write", "think", "feel", "enjoy", "ask", "skip", "treat", "sleep",
  "hug", "love", "cherish", "nurture", "heal", "work", "wear", "eat",
  ...INTERFACE,
]);

/** Every string in a payload. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** The clauses of a text: its sentences, and what follows a semicolon, a
    colon or a dash, any of which can open on an imperative ("You've lived
    through one; take it slow."). */
function clauses(text: string): string[] {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .split(/(?<=[.!?\u2026]["')]?)\s+|[;:]\s+|\s*[\u2014\u2013]\s*|\s+-\s+/)
    .map((s) => s.trim().replace(/^["'(]+/, ""))
    .filter((s) => /[a-z]/i.test(s));
}

const opener = (clause: string) => clause.split(/\s+/)[0].toLowerCase().replace(/[^a-z']/g, "");

/** Prose, as against an id, a date or a zone. */
const isProse = (text: string) => /\s/.test(text) || /[.!?\u2026]$/.test(text);

function check(texts: string[]) {
  for (const text of texts) {
    expect(text, "a mechanism word").not.toMatch(MECHANISM);
    if (!isProse(text)) continue;
    expect(text, "advice").not.toMatch(ADVICE_PHRASE);
    for (const c of clauses(text)) {
      const first = opener(c);
      const ok = c.endsWith("?") ? ASKS.has(first) : first === "" || OPENERS.has(first);
      if (!ok) expect.fail(`opens on "${first}", which isn't on the list: "${c}"`);
    }
  }
}

/** Every story's claims about people and events are the lore's (5), and
    say so, apart from two: question 3's general new-moon line and question
    4's "Venus rules pleasure", astrology's vocabulary (9.6). */
function checkStories(stories: readonly { number: number; story: string }[]) {
  for (const q of stories) {
    if (q.number === 3 || q.number === 4) continue;
    expect(q.story, `story ${q.number}`).toMatch(/\b(the lore|lore says|folklore says|said to)\b/i);
  }
}

/* ---- The payload, in every status ----------------------------------------- */

const at = (iso: string) => Date.parse(iso) / 1000;

const tested = (r: QuestionRecord, p: number, index: number, rangeC: number | null): QuestionRecord => ({
  ...r,
  status: "tested",
  notChecked: null,
  p,
  index,
  rangeC,
  iterations: 2000,
  matches: Math.max(0, Math.round(p * 2001) - 1),
});

/** A question as version 1 stored it, before questions stored a measure. */
function withoutMeasure(q: QuestionRecord): QuestionRecord {
  const r = { ...q };
  delete r.measure;
  return r;
}

/** Records that reach what a synthetic history rarely does: Yes, Maybe, the
    ranges that exclude zero, one question tested, and the rarer statuses. */
function variants(base: AnswerRecord): AnswerRecord[] {
  const each = (f: (r: QuestionRecord, i: number) => QuestionRecord) => ({ ...base, questions: base.questions.map(f) });
  // Swings and ranges: clear of zero, barely, and from barely to clear.
  const index = [1.2, 0.8, 1.003, 0.997, 1.1, 0.9];
  const narrow = [0.05, 0.05, 0.001, 0.001, 0.0955, 0.0955];
  // Every word below Yes, the ranges both even and lopsided.
  const ps = [0.04, 0.045, 0.06, 0.08, 0.12, 0.2, 0.3, 0.5, 0.7, 0.9, 0.95, 0.99];
  const span = base.questions[0].spanStart;
  return [
    each((r, i) => tested(r, 0.0004, index[i % 6], narrow[i % 6])),
    each((r, i) => tested(r, ps[i], i % 2 ? 1 : 1.2, i < 2 ? 0.05 : 0.3)),
    each((r, i) => (i === 0 ? tested(r, 0.001, 1.2, 0.05) : { ...r, status: "too-few-plays", notChecked: null, inPlays: 120 })),
    each((r, i) => {
      switch (QUESTIONS[i].id) {
        case "mercury":
          return { ...r, status: "no-comparison", notChecked: null };
        case "fullmoon":
          return { ...r, status: null, notChecked: "error" };
        case "newmoon":
          return { ...r, status: "warming-up", notChecked: null, warmupReadyFrom: null };
        case "venushome":
          return tested(r, 0.5, 1.02, null);
        case "moonstrong":
          return {
            ...r,
            status: "too-few-events",
            notChecked: null,
            events: 1,
            typicalSingleSwing: 0.03,
            earlyReads: [
              { start: span, end: span + 86_400, swing: null, inProgress: false, firstYear: true, path: null },
              { start: span + 40 * 86_400, end: span + 41 * 86_400, swing: null, inProgress: false, firstYear: false, path: null },
              { start: span + 80 * 86_400, end: span + 81 * 86_400, swing: 0.1, inProgress: true, firstYear: false, path: null },
            ],
          };
        case "venusmars":
          return { ...r, status: "too-few-events", notChecked: null, events: 2, earlyReads: [] };
        case "storms":
        case "flares":
          return { ...r, status: "too-few-events", notChecked: null, events: 0, earlyReads: [] };
        case "marswater":
          return tested(r, 0.99, 1.0, 0.2);
        case "venusrx":
          return {
            ...r,
            status: "too-few-events",
            notChecked: null,
            events: 1,
            earlyReads: [
              { start: span, end: span + 40 * 86_400, swing: null, inProgress: false, firstYear: true, path: null },
              { start: span + 300 * 86_400, end: span + 340 * 86_400, swing: null, inProgress: false, firstYear: true, path: null },
              { start: span + 600 * 86_400, end: span + 640 * 86_400, swing: -0.2, inProgress: false, firstYear: false, path: null },
            ],
          };
        default:
          return tested(r, 0.3, 0.95, 0.2);
      }
    }),
    // Version 1, which stored no measures: questions 5 and 6 are checking.
    { ...base, version: 1, questions: base.questions.map(withoutMeasure) },
  ];
}

/** A moment two days before each heads-up question's next event after 2020,
    so every heads-up opening is reached. */
const headsUpNows = (["mercury", "venusrx", "marsrx", "venushome", "marswater", "venusdet", "venusmars"] as QuestionId[]).map(
  (id) => (conditionFor(id)!.windows.find((w) => w.start > at("2020-06-01T00:00:00Z"))!.start - 2 * 86_400) * 1000,
);

/** Every string the payload returns for these histories, at these moments. */
function payloadStrings(): string[] {
  const nasa = nasaLogFrom(donki as unknown as DonkiCompact);
  const histories = [
    synthHistory(40_000, 11, 2006), // long: most questions tested
    synthHistory(20_000, 12, 2024), // young: early reads, too few events
    synthHistory(20_000, 13, 2026), // under a year: warming up
    synthHistory(300, 14, 2025).slice(0, 300), // tiny: too few plays
  ];
  // Days a heads-up names a station, a sign change or an aspect within the week.
  const nows = ["2026-09-28T12:00:00Z", "2025-02-25T12:00:00Z", "2024-03-28T12:00:00Z", "2024-04-02T12:00:00Z"].map((d) => Date.parse(d));
  const texts = strings(computingPayload());
  for (const [i, h] of histories.entries()) {
    for (const log of [nasa, null]) {
      const record = computeAnswers(`never-${i}`, h, "America/Chicago", nows[0], log);
      for (const rec of [record, ...(i === 0 && log ? variants(record) : [])]) {
        for (const now of [...nows, ...(i === 0 ? headsUpNows : [])]) texts.push(...strings(answersPayload(rec, "ready", now)));
      }
    }
  }
  return texts;
}

describe("never write (spec 9.6)", () => {
  const texts = payloadStrings();

  it("reaches every kind of sentence the answers payload returns", () => {
    // One marker per template in payload.ts, so a status the fixtures stop
    // reaching fails here instead of going unchecked.
    const markers = [
      /^Checking 12 questions/,
      /^Yes\. .*, and it holds up after allowing for asking \d+ questions at once\.$/,
      /^Yes\. [^]*\. (Very unlikely|Unlikely) to be chance\.$/,
      /^Yes: .*, even allowing for \d+ questions\.$/,
      /^Yes: [^,]*\.$/,
      /^Maybe\. .* On its own that's (very )?unlikely to be chance, but after allowing/,
      /^Maybe\. .*, which could be chance\.$/,
      /^Maybe: .*, unlikely on its own but not after allowing/,
      /^Maybe: .*, which could be chance\.$/,
      /^Not clearly\. /,
      /^Not clearly: /,
      /^No\. /,
      /^No: /,
      /^The real change is likely between /,
      /^The real change is likely (a )?barely /,
      /^On its own, the change looks like somewhere /,
      /^There's too little listening under this sky/,
      /, it's likely by less than \d+% either way\.$/,
      /, it's likely somewhere between /,
      /^Shuffle the sky .* never turned up in /,
      /^Shuffle the sky .* turns up nearly every time\.$/,
      /^Shuffle the sky .* turns up about \d+ times? in /,
      /^p = .*Under 0\.05 is the usual bar/,
      /^Retrospect allows for asking \d+ questions at once/,
      /Only this one could be tested so far/,
      /^Counted from your second year: it takes a year/,
      /^Counted from your second year: in your first year/,
      /, across .* in your /,
      /^Too early\. There's nothing to compare yet/,
      /^Too early: nothing to compare yet\.$/,
      /^Not checked: something went wrong on our side\.$/,
      /^Not checked yet: NASA's log didn't load\.$/,
      /^Too early\. .* start counting in /,
      /^Too early\. .* start counting a year after your history starts\.$/,
      /^Too early: .* start counting in /,
      /^Too early: .* start counting after your first year\.$/,
      /^Too early\. .* plays a verdict needs .* How soon depends/,
      /^Too early: .* plays a verdict needs\.$/,
      /One .* can't show a pattern\./,
      /can't show a pattern yet\./,
      /come when the Sun sends them/,
      /The next one begins /,
      /: in your first year, before .* count\.$/,
      /^\w+ (visits|retrogrades) in your first year, .*, came before old favorites count\.$/,
      /^Checking this question against your sky\u2026$/,
      /: no plays to compare\.$/,
      /\(in progress\)\.$/,
      /^One ordinary stretch this long/,
      /counts once: /,
      /^Mercury turns retrograde /,
      /^Venus turns retrograde /,
      /^Mars turns retrograde /,
      /^Venus comes home to /,
      /^Mars enters .*, a water sign,/,
      /^Venus enters .*, her detriment,/,
      /^Venus and Mars come into (trine|sextile) /,
      /It'll be your first\.$/,
      /You've lived through one, in your first year, before .* count\.$/,
      /You've lived through \w+; see how your listening went\.$/,
    ];
    const missing = markers.filter((m) => !texts.some((t) => m.test(t)));
    expect(missing.map(String)).toEqual([]);
  });

  it("holds for every sentence the answers payload returns", () => {
    check(texts);
  });

  it("holds for the 12 stories and questions, which keep the lore as lore", () => {
    check(QUESTIONS.flatMap((q) => [q.story, q.question]));
    checkStories(QUESTIONS);
  });

  it("keeps advice off the list of openers", () => {
    for (const w of OPENERS) if (ADVICE.has(w) && !INTERFACE.has(w)) expect.fail(`"${w}" opens advice`);
  });

  it("catches what it's for", () => {
    const bad = [
      "The full moon's energy brings things to a head.",
      "Venus is activating your chart.",
      "Let go of old loves this week.",
      "Pause new ventures until Mercury turns direct.",
      "Venus turns retrograde Saturday. Don't start anything new.",
      "Venus turns retrograde Saturday. Don\u2019t start anything new.",
      "Do something new tonight.",
      "You've lived through one; take it slow.",
      "Venus turns retrograde Saturday: pause new ventures.",
      "It'll be your first. Rest.",
      "Rest.",
      "Enjoy the quiet tonight.",
      "Try something new tonight.",
      "It's a good time to start something new.",
      "Venus turns retrograde Saturday, a good time to slow down.",
      "You've lived through two, so you should rest.",
      "Take it slow?",
      'The lore says "slow down." Take it slow.',
    ];
    for (const s of bad) expect(() => check([s]), s).toThrow();
    // The first set's story 12, which stated the lore in Retrospect's own voice.
    expect(() => checkStories([{ number: 12, story: "Mars retrograde is when drive stalls and momentum slips." }])).toThrow();
    // 9.2's own sentences pass, "see" mid-sentence included.
    expect(() =>
      check([
        "Venus turns retrograde Saturday. You've lived through one; see how your listening went.",
        "Too early: 1 of the 6 retrogrades a verdict needs.",
        "Does a full moon change how late you listen?",
      ]),
    ).not.toThrow();
  });
});
