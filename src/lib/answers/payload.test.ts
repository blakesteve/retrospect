import { describe, expect, it } from "vitest";
import { ANSWERS_VERSION, type AnswerRecord, type QuestionRecord } from "./engine";
import { answersPayload, computingPayload, formatP, type QuestionPayload } from "./payload";
import { QUESTIONS, questionById, type QuestionId } from "./questions";

/* The sentences are spec 9.2's, written out as literals. Most of the spec's
   examples use Central time and real sky dates (Venus retrograde Mar 1 to Apr
   12, 2025 is Mar 2 to Apr 13 in UTC), so the records here are built in
   America/Chicago and the sentences can be checked word for word. */

const at = (iso: string) => Date.parse(iso) / 1000;
const YEAR = 365.25 * 86_400;

function question(id: QuestionId, over: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id,
    status: "too-few-plays",
    notChecked: null,
    index: null,
    p: null,
    matches: 0,
    iterations: 0,
    rangeC: null,
    inPlays: 100,
    events: 3,
    spanStart: at("2023-01-01T00:00:00Z"),
    spanEnd: at("2026-01-01T00:00:00Z"),
    warmupReadyFrom: null,
    merged: [],
    earlyReads: [],
    typicalSingleSwing: null,
    nullSamples: [],
    pairings: [],
    ...over,
  };
}

/** A record where `target` has the given fields, and the other sky questions
    are tested with the rest of a p vector (so m and the words are spec 6.3's). */
function record(target: QuestionId, over: Partial<QuestionRecord>, others: number[] = []): AnswerRecord {
  let k = 0;
  return {
    version: ANSWERS_VERSION,
    zone: "America/Chicago",
    stamp: "1|2|3",
    nasaStamp: null,
    computedAt: 0,
    plays: 1,
    historyStart: at("2025-01-01T00:00:00Z"),
    historyEnd: at("2026-09-29T00:00:00Z"),
    incomplete: false,
    questions: QUESTIONS.map((q) => {
      if (q.id === target) return question(q.id, over);
      if (q.nasa) return question(q.id, { status: null, notChecked: "nasa" });
      const p = others[k++];
      return p === undefined
        ? question(q.id)
        : question(q.id, { status: "tested", p, index: 1.01, iterations: 2000, matches: 1, rangeC: 0.5, events: 9 });
    }),
  };
}

const NOW = Date.parse("2026-09-30T17:00:00Z"); // a Wednesday afternoon in Chicago
const rest9 = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const phrasesOf = (rec: AnswerRecord, id: QuestionId, now = NOW) =>
  answersPayload(rec, "ready", now).questions.find((q) => q.id === id)!;

/** A tested question whose range runs from `lo` to `hi` (fractions). */
const withRange = (lo: number, hi: number) => {
  const L = (Math.log(1 + lo) + Math.log(1 + hi)) / 2;
  const c = (Math.log(1 + hi) - Math.log(1 + lo)) / 2;
  return { index: Math.exp(L), rangeC: c };
};

describe("the word line and Tonight's line (9.2)", () => {
  it("Yes, around full moons", () => {
    const q = phrasesOf(record("fullmoon", { status: "tested", index: 1.23, p: 0.004, iterations: 2000 }, rest9), "fullmoon");
    expect(q.word).toBe("Yes");
    expect(q.phrases.wordLine).toBe(
      "Yes. Around full moons, a 23% bigger share of your plays came after midnight. Very unlikely to be chance, and it holds up after allowing for asking 10 questions at once.",
    );
    expect(q.phrases.tonightLine).toBe("Yes: a 23% bigger after-midnight share, even allowing for 10 questions.");
  });

  it("Maybe, under 0.05 but not after the correction", () => {
    const q = phrasesOf(record("fullmoon", { status: "tested", index: 1.18, p: 0.03, iterations: 2000 }, rest9), "fullmoon");
    expect(q.word).toBe("Maybe");
    expect(q.phrases.wordLine).toBe(
      "Maybe. Around full moons, an 18% bigger share of your plays came after midnight. On its own that's unlikely to be chance, but after allowing for asking 10 questions at once, it could be.",
    );
    expect(q.phrases.tonightLine).toBe(
      "Maybe: an 18% bigger after-midnight share, unlikely on its own but not after allowing for 10 questions.",
    );
  });

  it("Maybe, Not clearly and No", () => {
    const maybe = phrasesOf(record("moonstrong", { status: "tested", index: 0.95, p: 0.07, iterations: 2000 }, rest9), "moonstrong");
    // Spec 9.2's own examples, since questions 5 and 6 changed measures (1 Oct 2026).
    expect(maybe.phrases.wordLine).toBe(
      "Maybe. While the Moon was strong, a 5% smaller share of your plays were old favorites, which could be chance.",
    );
    expect(maybe.phrases.tonightLine).toBe("Maybe: a 5% smaller share of old favorites, which could be chance.");

    const notClearly = phrasesOf(record("venusmars", { status: "tested", index: 1.11, p: 0.2, iterations: 2000 }, rest9), "venusmars");
    expect(notClearly.phrases.wordLine).toBe("Not clearly. While Venus and Mars got along, you listened 11% more, which could be chance.");

    const no = phrasesOf(record("mercury", { status: "tested", index: 0.99, p: 0.6, iterations: 2000 }, rest9), "mercury");
    expect(no.phrases.wordLine).toBe(
      "No. While Mercury was retrograde, a 1% smaller share of your plays were old favorites, which could easily be chance.",
    );
    const barely = phrasesOf(record("mercury", { status: "tested", index: 0.997, p: 0.6, iterations: 2000 }, rest9), "mercury");
    expect(barely.phrases.wordLine).toBe(
      "No. While Mercury was retrograde, your share of old favorites barely moved: less than 1% either way, which could easily be chance.",
    );
    const more = phrasesOf(record("marsrx", { status: "tested", index: 1.01, p: 0.6, iterations: 2000 }, rest9), "marsrx");
    expect(more.phrases.tonightLine).toBe("No: 1% more listening, which could easily be chance.");
    const less = phrasesOf(record("venusdet", { status: "tested", index: 0.92, p: 0.2, iterations: 2000 }, rest9), "venusdet");
    expect(less.phrases.tonightLine).toBe("Not clearly: 8% less listening, which could be chance.");
  });
});

describe("the range (6.4, 9.2)", () => {
  const range = (id: QuestionId, lo: number, hi: number, p: number) =>
    phrasesOf(record(id, { status: "tested", p, iterations: 2000, ...withRange(lo, hi) }, rest9), id).phrases.range;

  it("includes zero, roughly even: the larger end, rounded up", () => {
    expect(range("mercury", -0.055, 0.052, 0.6)).toBe("If Mercury retrograde moves you at all, it's likely by less than 6% either way.");
  });

  it("includes zero, lopsided", () => {
    expect(range("fullmoon", -0.13, 0.06, 0.4)).toBe(
      "If a full moon moves you at all, it's likely somewhere between a 13% smaller and a 6% bigger share.",
    );
    expect(range("marsrx", -0.12, 0.04, 0.4)).toBe(
      "If Mars retrograde moves you at all, it's likely somewhere between 12% less and 4% more.",
    );
  });

  it("excludes zero beside a Yes, and beside a Maybe that failed the correction", () => {
    expect(range("fullmoon", 0.02, 0.42, 0.004)).toBe("The real change is likely between a 2% and a 42% bigger share.");
    expect(range("fullmoon", 0.02, 0.42, 0.03)).toBe(
      "On its own, the change looks like somewhere between a 2% and a 42% bigger share.",
    );
  });

  it("shows none when c is infinite", () => {
    const q = phrasesOf(record("fullmoon", { status: "tested", index: 1.1, p: 0.4, rangeC: null, iterations: 2000 }, rest9), "fullmoon");
    expect(q.phrases.range).toBe("There's too little listening under this sky to say how big a change could be.");
    expect(q.range).toBeNull();
  });
});

describe("too early, by status (9.2)", () => {
  it("too few events: the count, and when the next one begins", () => {
    const q = phrasesOf(record("venusrx", { status: "too-few-events", events: 1 }), "venusrx");
    expect(q.phrases.tooEarly).toBe(
      "Too early. 1 of the 6 retrogrades a verdict needs. One retrograde can't show a pattern. The next one begins Saturday.",
    );
    expect(q.phrases.tonightLine).toBe("Too early: 1 of the 6 retrogrades a verdict needs.");
    // From 1 Jan 2027 the next Venus retrograde (May 10, 2028) is over a year away.
    const later = phrasesOf(record("venusrx", { status: "too-few-events", events: 1 }), "venusrx", Date.parse("2027-01-01T18:00:00Z"));
    expect(later.phrases.tooEarly).toBe(
      "Too early. 1 of the 6 retrogrades a verdict needs. One retrograde can't show a pattern. The next one is expected around May 2028.",
    );
  });

  it("too few plays, warming up, and nothing to compare", () => {
    expect(phrasesOf(record("storms", { status: "too-few-plays", inPlays: 244 }), "storms").phrases.tooEarly).toBe(
      "Too early. 244 of the 500 plays a verdict needs on storm nights. How soon depends on how much you listen and how often storms come.",
    );
    expect(
      phrasesOf(record("mercury", { status: "warming-up", warmupReadyFrom: at("2027-05-20T12:00:00Z") }), "mercury").phrases.tooEarly,
    ).toBe("Too early. Old favorites start counting in May 2027, a year after your history starts.");
    expect(phrasesOf(record("storms", { status: "no-comparison" }), "storms").phrases.tooEarly).toBe(
      "Too early. There's nothing to compare yet: this needs some of your after-midnight plays both on storm nights and the rest of the time.",
    );
  });

  it("not checked", () => {
    const q = phrasesOf(record("venusdet", { status: null, notChecked: "error" }), "venusdet");
    expect(q.word).toBe("Not checked");
    expect(q.phrases.wordLine).toBe("Not checked: something went wrong on our side.");
  });
});

describe("the question sheet's other lines (8.7.3)", () => {
  const tested = (over: Partial<QuestionRecord>) => ({ status: "tested" as const, iterations: 2000, rangeC: 0.3, ...over });

  it("what happened", () => {
    const q = phrasesOf(
      record("venusdet", tested({ index: 1.01, p: 0.6, events: 7, spanStart: 0, spanEnd: Math.round(3 * YEAR) }), rest9),
      "venusdet",
    );
    expect(q.phrases.whatHappened).toBe(
      "While Venus was in detriment, you listened 1% more than usual, across 7 stretches in your three years.",
    );
  });

  it("how often a swing this big turns up, and the p-value note", () => {
    const q = phrasesOf(record("fullmoon", tested({ index: 1.05, p: 0.25, matches: 499 }), rest9), "fullmoon");
    expect(q.phrases.frequency).toBe("Shuffle the sky and a swing this big, up or down, turns up about 3 times in 10.");
    expect(q.phrases.pValueNote).toBe(
      "p = 0.25: the share of 2,000 shuffled skies (plus the real one) that matched or beat this swing. Under 0.05 is the usual bar for 'unlikely to be chance'.",
    );
    expect(q.phrases.correctionNote).toBe(
      // Every m x p / j from 0.25 up is at least 0.95 (the last, 10 x 0.95 / 10).
      "Retrospect allows for asking 10 questions at once with a false-discovery correction (Benjamini-Hochberg at 10%). A Yes needs this question's adjusted p at most 0.10 and its own p under 0.05. Adjusted p here: 0.95.",
    );
  });

  it("names a merged event once, with what the planet did between", () => {
    const q = phrasesOf(
      record(
        "venusdet",
        tested({
          index: 1.01,
          p: 0.6,
          merged: [
            {
              start: at("2025-02-04T07:58:19Z"),
              end: at("2025-06-06T04:42:08Z"),
              windows: [
                { start: at("2025-02-04T07:58:19Z"), end: at("2025-03-27T08:39:14Z"), sign: "Aries" },
                { start: at("2025-04-30T17:15:01Z"), end: at("2025-06-06T04:42:08Z"), sign: "Aries" },
              ],
            },
          ],
        }),
        rest9,
      ),
      "venusdet",
    );
    expect(q.eventsNote).toBe(
      "Venus in Aries Feb 4 to Jun 5, 2025 counts once: she backed into Pisces Mar 27 during her retrograde and returned Apr 30.",
    );
  });

  it("the warm-up line", () => {
    const q = phrasesOf(record("mercury", tested({ index: 1.01, p: 0.6 }), rest9), "mercury");
    expect(q.phrases.warmup).toBe("Counted from your second year: it takes a year to know your old favorites.");
  });
});

describe("early reads (6.5, 9.2)", () => {
  it("one row per event, and how much one stretch swings on its own", () => {
    const q = phrasesOf(
      record("venusrx", {
        status: "too-few-events",
        events: 1,
        typicalSingleSwing: 0.2,
        earlyReads: [
          { start: at("2025-03-02T00:32:42Z"), end: at("2025-04-13T01:02:56Z"), swing: -0.14, inProgress: false, firstYear: false, path: null },
          { start: at("2025-03-02T00:32:42Z"), end: at("2025-04-13T01:02:56Z"), swing: -0.14, inProgress: true, firstYear: false, path: null },
          { start: at("2025-03-02T00:32:42Z"), end: at("2025-04-13T01:02:56Z"), swing: null, inProgress: false, firstYear: true, path: null },
        ],
      }),
      "venusrx",
    );
    expect(q.phrases.earlyReadRows).toEqual([
      "Mar 1 to Apr 12, 2025: a 14% smaller share of old favorites.",
      "Mar 1 to Apr 12, 2025: a 14% smaller share of old favorites (in progress).",
      "Mar 1 to Apr 12, 2025: in your first year, before old favorites count.",
    ]);
    expect(q.phrases.typicalSwing).toBe("One ordinary stretch this long usually moves less than about 20% either way.");
  });

  // Architect, 1 Oct 2026: two or more first-year events for a question with
  // a warm-up (1, 3, 5 and 11) share one line; one keeps its own row (above).
  const read = (start: string, end: string, firstYear: boolean, swing: number | null = null) => ({
    start: at(start),
    end: at(end),
    swing,
    inProgress: false,
    firstYear,
    path: null,
  });

  it("puts two or more first-year events on one line", () => {
    const moon = phrasesOf(
      record("moonstrong", {
        status: "too-few-events",
        events: 1,
        earlyReads: [
          read("2025-01-07T18:00:00Z", "2025-01-09T18:00:00Z", true),
          read("2025-01-21T18:00:00Z", "2025-01-23T18:00:00Z", true),
          read("2025-02-03T18:00:00Z", "2025-02-05T18:00:00Z", true),
          read("2026-02-01T18:00:00Z", "2026-02-03T18:00:00Z", false, 0.1),
        ],
      }),
      "moonstrong",
    );
    expect(moon.phrases.earlyReadRows).toEqual([
      "Three visits in your first year, Jan 7 to Feb 5, 2025, came before old favorites count.",
      "Feb 1 to Feb 3, 2026: a 10% bigger share of old favorites.",
    ]);
    // Mercury turned retrograde Apr 1 and Aug 5, 2024, direct Apr 25 and Aug 28.
    const mercury = phrasesOf(
      record("mercury", {
        status: "too-few-events",
        events: 0,
        earlyReads: [
          read("2024-04-01T22:14:00Z", "2024-04-25T12:54:00Z", true),
          read("2024-08-05T04:56:00Z", "2024-08-28T21:14:00Z", true),
        ],
      }),
      "mercury",
    );
    expect(mercury.phrases.earlyReadRows).toEqual([
      "Two retrogrades in your first year, Apr 1 to Aug 28, 2024, came before old favorites count.",
    ]);
  });

  it("writes ten or more as numerals, and a first year that crosses New Year in full", () => {
    // A strong Moon about twice a month, from Jun 3, 2025 to May 28, 2026.
    const reads = Array.from({ length: 12 }, (_, k) => {
      const start = at("2025-06-03T18:00:00Z") + k * 30 * 86_400;
      return { start, end: start + 2 * 86_400, swing: null, inProgress: false, firstYear: true, path: null };
    });
    reads[11] = { ...reads[11], start: at("2026-05-26T18:00:00Z"), end: at("2026-05-28T18:00:00Z") };
    const q = phrasesOf(record("moonstrong", { status: "too-few-events", events: 0, earlyReads: reads }), "moonstrong");
    expect(q.phrases.earlyReadRows).toEqual(["12 visits in your first year, Jun 3, 2025 to May 28, 2026, came before old favorites count."]);
  });

  it("collapses first listens' first-year rows too (6.5, corrected 1 Oct)", () => {
    const q = phrasesOf(
      record("newmoon", {
        status: "too-few-events",
        events: 0,
        earlyReads: [
          read("2025-01-29T18:00:00Z", "2025-01-30T18:00:00Z", true),
          read("2025-02-27T18:00:00Z", "2025-02-28T18:00:00Z", true),
        ],
      }),
      "newmoon",
    );
    expect(q.phrases.earlyReadRows).toEqual(["Two new moons in your first year, Jan 29 to Feb 28, 2025, came before first listens count."]);
  });
});

describe("a question stored under another measure (architect, 1 Oct 2026)", () => {
  // Version 1 stored no measures. Its question 5 measured how much you listen
  // (the old report's intensity), and its question 6 after-midnight plays.
  const tested5 = {
    status: "tested" as const,
    p: 0.004,
    index: 1.23,
    iterations: 2000,
    matches: 7,
    rangeC: 0.05,
    events: 9,
    inPlays: 400,
    warmupReadyFrom: at("2026-01-01T00:00:00Z"),
    nullSamples: [0.1, -0.2],
    pairings: ["song-a"],
  };
  const current = record("moonstrong", tested5, rest9);
  const v1: AnswerRecord = {
    ...current,
    version: 1,
    questions: current.questions.map((q) =>
      q.id !== "venusmars"
        ? q
        : {
            ...q,
            status: "too-few-events" as const,
            events: 2,
            inPlays: 50,
            matches: 3,
            iterations: 2000,
            nullSamples: [0.3],
            typicalSingleSwing: 0.2,
            merged: [
              {
                start: at("2025-01-23T00:00:00Z"),
                end: at("2025-05-29T00:00:00Z"),
                windows: [
                  { start: at("2025-01-23T00:00:00Z"), end: at("2025-03-01T00:00:00Z"), aspect: 120 as const },
                  { start: at("2025-04-01T00:00:00Z"), end: at("2025-05-29T00:00:00Z"), aspect: 120 as const },
                ],
              },
            ],
            earlyReads: [{ start: at("2025-06-01T18:00:00Z"), end: at("2025-06-20T18:00:00Z"), swing: 0.3, inProgress: false, firstYear: false, path: null }],
          },
    ),
  };
  const CHECKING = "Checking this question against your sky\u2026";
  const find = (payload: ReturnType<typeof answersPayload>, id: QuestionId) => payload.questions.find((q) => q.id === id)!;

  it("serves it as checking on its own, with none of its stored numbers or sentences", () => {
    const payload = answersPayload(v1, "ready", NOW);
    expect(payload).toMatchObject({ status: "updating", done: 10, total: 12 });
    expect(payload.tally.Checking).toBe(2);
    for (const id of ["moonstrong", "venusmars"] as const) {
      const q = find(payload, id);
      // Everything but who it is and what the sky alone decides.
      const rest: Partial<QuestionPayload> = { ...q };
      for (const k of ["id", "number", "question", "story", "shortName", "nextStart", "pairings"] as const) delete rest[k];
      expect(rest, id).toEqual({
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
        nullSamples: [],
        phrases: {
          wordLine: CHECKING,
          tonightLine: CHECKING,
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
          headsUp: null,
        },
      });
      // What depends only on the sky stays.
      expect(q.nextStart, id).toBe(find(answersPayload(current, "ready", NOW), id).nextStart);
      expect(q.pairings, id).toEqual(id === "moonstrong" ? ["song-a"] : []);
    }
  });

  it("serves the other 10 exactly as stored, their correction included", () => {
    const payload = answersPayload(v1, "ready", NOW);
    // The same record, read as if nothing were checking: what was stored.
    const stored = answersPayload({ ...v1, version: ANSWERS_VERSION }, "ready", NOW);
    // Nine were tested when it was stored, question 5 among them (6 was too
    // few events), and all nine stay in the correction.
    expect(payload.m).toBe(9);
    for (const q of QUESTIONS.filter((x) => x.id !== "moonstrong" && x.id !== "venusmars")) {
      expect(find(payload, q.id), q.id).toEqual(find(stored, q.id));
    }
    expect(find(payload, "fullmoon").phrases.wordLine).toBe(
      "Not clearly. Around full moons, a 1% bigger share of your plays came after midnight, which could be chance.",
    );
    expect(find(payload, "fullmoon").phrases.correctionNote).toContain("asking 9 questions at once");
  });

  it("keeps the heads-up, which comes from the sky alone", () => {
    // Venus and Mars come into sextile Sept 10, 2025.
    const now = Date.parse("2025-09-04T17:00:00Z");
    const stored = answersPayload(current, "ready", now).headsUp;
    expect(stored?.id).toBe("venusmars");
    expect(answersPayload(v1, "ready", now).headsUp).toEqual(stored);
  });

  it("words that heads-up with today's warm-up, not the stored measure's", () => {
    // Mercury stations retrograde in mid-July 2025. This history starts Jan
    // 1, 2025, so the one before (Mar 15) fell in its first year, when old
    // favorites don't count yet. Stored under a measure with no warm-up.
    const moved = record("mercury", { measure: "listening", warmupReadyFrom: null, status: "tested", p: 0.5, index: 1.01, iterations: 2000, rangeC: 0.2 });
    const line = answersPayload(moved, "ready", Date.parse("2025-07-13T17:00:00Z")).headsUp?.line;
    expect(line).toMatch(/^Mercury turns retrograde \w+\. You've lived through one, in your first year, before old favorites count\.$/);
  });

  it("reads each question's own stored measure, whatever the version", () => {
    expect(answersPayload(current, "ready", NOW)).toMatchObject({ status: "ready", done: 12 });
    expect(answersPayload(current, "ready", NOW).questions.every((q) => !q.updating)).toBe(true);
    const moved = {
      ...current,
      questions: current.questions.map((q) => ({ ...q, measure: q.id === "moonstrong" ? ("listening" as const) : questionById(q.id).measure })),
    };
    const payload = answersPayload(moved, "ready", NOW);
    expect(payload.questions.filter((q) => q.updating).map((q) => q.id)).toEqual(["moonstrong"]);
    expect(payload.status).toBe("updating");
  });
});

describe("Tonight's heads-up (8.4)", () => {
  it("names the next station within a week, and what the listener has lived through", () => {
    // History from 1 Jan 2025: one Venus retrograde so far (Mar 1 to Apr 12, 2025).
    const p = answersPayload(record("venusrx", { status: "too-few-events", events: 1 }), "ready", NOW);
    // Never "see what it did": that says Venus did something to the listener (9.6).
    expect(p.headsUp).toEqual({ id: "venusrx", line: "Venus turns retrograde Saturday. You've lived through one; see how your listening went." });
  });

  it("is quiet when nothing starts within a week", () => {
    // 15 Jul 2026: Mercury turned retrograde Jun 29; next is Venus into Libra, Aug 6.
    expect(answersPayload(record("venusrx", { status: "too-few-events", events: 1 }), "ready", Date.parse("2026-07-15T12:00:00Z")).headsUp).toBeNull();
  });
});

describe("p for people", () => {
  it("truncates, so no p reads as past a bar it hasn't crossed", () => {
    expect(formatP(0.25)).toBe("0.25");
    expect(formatP(0.0499)).toBe("0.049");
    expect(formatP(0.0995)).toBe("0.099");
    expect(formatP(0.000499)).toBe("0.0004");
    expect(formatP(1)).toBe("1");
  });
});

describe("fixes from review", () => {
  const tested = (over: Partial<QuestionRecord>) => ({ status: "tested" as const, iterations: 2000, ...over });
  const range = (id: QuestionId, lo: number, hi: number, p: number, others = rest9) =>
    phrasesOf(record(id, { status: "tested", p, iterations: 2000, ...withRange(lo, hi) }, others), id).phrases.range;

  it("names the next event, not a window that continues the one under way", () => {
    // 1 Apr 2025: Venus is in Aries and comes back on Apr 30 after backing out,
    // the same stretch. The next one begins when she enters Scorpio, Nov 6.
    const april = Date.parse("2025-04-01T17:00:00Z");
    const q = phrasesOf(record("venusdet", { status: "too-few-events", events: 2 }), "venusdet", april);
    expect(q.phrases.tooEarly).toBe(
      "Too early. 2 of the 6 stretches a verdict needs. Two stretches can't show a pattern yet. The next one begins Nov 6.",
    );
    // Nor is the return a heads-up.
    expect(phrasesOf(record("venusdet", { status: "too-few-events", events: 2 }), "venusdet", Date.parse("2025-04-25T17:00:00Z")).phrases.headsUp).toBeNull();
  });

  it("words a range end that rounds to nothing", () => {
    expect(range("fullmoon", -0.13, 0.003, 0.07)).toBe(
      "If a full moon moves you at all, it's likely somewhere between a 13% smaller share and no change.",
    );
    expect(range("fullmoon", 0.003, 0.15, 0.004)).toBe("The real change is likely between a barely bigger and a 15% bigger share.");
    expect(range("marsrx", -0.15, -0.003, 0.004)).toBe("The real change is likely between barely less and 15% less.");
  });

  it("shows p rounded down and adjusted p rounded up, without float slips", () => {
    expect(formatP(0.29)).toBe("0.29");
    expect(formatP(0.57)).toBe("0.57");
    expect(formatP(0.105, "up")).toBe("0.11");
    expect(formatP(0.1, "up")).toBe("0.10");
    // m 10, the top p 0.0105: adjusted 0.105, past "at most 0.10", so a Maybe,
    // and the note mustn't print 0.10.
    const q = phrasesOf(record("fullmoon", tested({ index: 1.2, p: 0.0105 }), rest9), "fullmoon");
    expect(q.word).toBe("Maybe");
    expect(q.phrases.correctionNote).toMatch(/Adjusted p here: 0\.11\.$/);
  });

  it("drops the allowance when only one question was tested", () => {
    const q = phrasesOf(record("fullmoon", tested({ index: 1.23, p: 0.004 })), "fullmoon");
    expect(q.phrases.wordLine).toBe(
      "Yes. Around full moons, a 23% bigger share of your plays came after midnight. Very unlikely to be chance.",
    );
    expect(q.phrases.tonightLine).toBe("Yes: a 23% bigger after-midnight share.");
  });

  it("says what happened to a share without 'than usual'", () => {
    const q = phrasesOf(
      record("fullmoon", tested({ index: 1.23, p: 0.6, events: 120, spanStart: 0, spanEnd: Math.round(10 * YEAR) }), rest9),
      "fullmoon",
    );
    expect(q.phrases.whatHappened).toBe(
      "Around full moons, a 23% bigger share of your plays came after midnight, across 120 full moons in your 10 years.",
    );
  });

  it("writes big swings with thousands separators", () => {
    const q = phrasesOf(record("fullmoon", tested({ index: 13.34, p: 0.6 }), rest9), "fullmoon");
    expect(q.phrases.tonightLine).toBe("No: a 1,234% bigger after-midnight share, which could easily be chance.");
  });

  it("rounds the typical swing up, never down", () => {
    const line = (x: number) =>
      phrasesOf(record("venusrx", { status: "too-few-events", events: 1, typicalSingleSwing: x }), "venusrx").phrases.typicalSwing;
    expect(line(0.124)).toBe("One ordinary stretch this long usually moves less than about 15% either way.");
    expect(line(0.044)).toBe("One ordinary stretch this long usually moves less than about 5% either way.");
  });

  it("shows no swing or p for a question that wasn't tested, and matches records by id", () => {
    const rec = record("venusrx", { status: "too-few-events", events: 1, index: 1.3, p: 0.2 }, rest9);
    const forward = answersPayload(rec, "ready", NOW);
    expect(forward.questions.find((q) => q.id === "venusrx")).toMatchObject({ pct: null, p: null });
    const reversed = answersPayload({ ...rec, questions: [...rec.questions].reverse() }, "ready", NOW);
    expect(reversed.questions).toEqual(forward.questions);
  });
});

describe("the reveal's last card (8.3)", () => {
  const reveal = (rec: AnswerRecord) => answersPayload(rec, "ready", NOW).reveal;
  const tested = (p: number) => ({ status: "tested" as const, p, index: 1.1, iterations: 2000, rangeC: 0.2, events: 9 });

  it("leads with the Yes count, then the maybes, then No", () => {
    expect(reveal(record("fullmoon", tested(0.004), rest9)).line).toBe("One yes. Here's exactly how, and how sure.");
    expect(reveal(record("fullmoon", tested(0.04), rest9)).line).toBe("Mostly no. Here's exactly how, and the one maybe.");
    expect(reveal(record("fullmoon", tested(0.07), [0.06, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.96, 0.97])).line).toBe(
      "Mostly no. Here's exactly how, and the two maybes.",
    );
    expect(reveal(record("fullmoon", tested(0.5), rest9)).line).toBe("No, as far as we can tell. Here's exactly how much.");
  });

  it("says when most are too early, and what the first tested one already says", () => {
    // Questions 1 and 2 tested; 3 to 12 too early or not checked.
    expect(reveal(record("fullmoon", tested(0.5), [0.6])).line).toBe("Too early for most. Here's what Mercury retrograde already says.");
  });

  it("names the first to arrive, or says plays are what's missing, when nothing is tested", () => {
    const warming = record("mercury", { status: "warming-up", warmupReadyFrom: at("2027-01-15T12:00:00Z") });
    expect(reveal(warming).line).toBe("Too early for all 12. The first to arrive: Mercury retrograde, around January 2027.");
    expect(reveal(record("mercury", {})).line).toBe("Too early for all 12. They arrive as more of your listening falls under each sky.");
  });

  it("puts Yes first when there's a Yes and a Maybe", () => {
    expect(reveal(record("fullmoon", tested(0.004), [0.06, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.96, 0.97])).line).toBe("One yes. Here's exactly how, and how sure.");
  });

  it("calls six of 12 too early not yet most, and seven most", () => {
    // Tested: 1 to 6. Too early: 9 to 12. Not checked: 7 and 8. So 4 too early.
    expect(reveal(record("fullmoon", tested(0.5), [0.6, 0.6, 0.6, 0.6, 0.6])).line).toBe("No, as far as we can tell. Here's exactly how much.");
    // Two tested, 7 to 8 not checked, eight too early: more than half.
    const most = record("fullmoon", tested(0.5), [0.6]);
    expect(reveal(most).line).toMatch(/^Too early for most\./);
    // Exactly six too early (half), four tested and two not checked: not "most".
    const six = { ...most, questions: most.questions.map((q) => (q.id === "newmoon" || q.id === "venushome" ? { ...q, status: "tested" as const, p: 0.6, index: 1.01, iterations: 2000, rangeC: 0.2, events: 9 } : q)) };
    expect(answersPayload(six, "ready", NOW).tally["Too early"]).toBe(6);
    expect(reveal(six).line).toBe("No, as far as we can tell. Here's exactly how much.");
  });

  it("agrees with a plural subject", () => {
    // Solar storms tested first: questions 1 to 6 too early.
    const storms = record("storms", { ...tested(0.5), notChecked: null });
    expect(reveal(storms).line).toBe("Too early for most. Here's what solar storms already say.");
  });

  it("names the earliest of several to arrive, counting the next event as well as a warm-up", () => {
    const two = record("mercury", { status: "warming-up", warmupReadyFrom: at("2027-06-15T12:00:00Z") });
    const both = { ...two, questions: two.questions.map((q) => (q.id === "venusrx" ? { ...q, status: "warming-up" as const, warmupReadyFrom: at("2027-01-15T12:00:00Z") } : q)) };
    expect(reveal(both).line).toBe("Too early for all 12. The first to arrive: Venus retrograde, around January 2027.");
    // A question short of events arrives at its next event: Venus turns
    // retrograde Oct 3, 2026 (Central), before either warm-up ends.
    const events = { ...both, questions: both.questions.map((q) => (q.id === "marsrx" ? q : q.id === "venusrx" ? { ...q, status: "too-few-events" as const, warmupReadyFrom: null, events: 2 } : q)) };
    expect(reveal(events).line).toBe("Too early for all 12. The first to arrive: Venus retrograde, around October 2026.");
  });

  it("counts the questions not checked yet", () => {
    // record() leaves NASA's two not checked.
    expect(reveal(record("fullmoon", tested(0.5), rest9)).notChecked).toBe("Two not checked yet");
    const all = record("fullmoon", tested(0.5), rest9);
    const checked = { ...all, questions: all.questions.map((q) => (q.notChecked ? { ...q, notChecked: null, status: "too-few-plays" as const } : q)) };
    expect(reveal(checked).notChecked).toBeNull();
  });
});

describe("while the history is still being read", () => {
  it("says the questions are on their way (8.4)", () => {
    expect(computingPayload()).toMatchObject({
      status: "computing",
      done: 0,
      total: 12,
      questions: [],
      line: "Checking 12 questions against your sky\u2026 0 of 12",
    });
  });
});
