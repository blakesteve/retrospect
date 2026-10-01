import { describe, expect, it } from "vitest";
import type { AnswerRecord, QuestionRecord } from "./engine";
import { answersPayload, computingPayload, formatP } from "./payload";
import { QUESTIONS, type QuestionId } from "./questions";

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
    version: 1,
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
    expect(maybe.phrases.wordLine).toBe("Maybe. While the Moon was strong, you listened 5% less, which could be chance.");
    expect(maybe.phrases.tonightLine).toBe("Maybe: 5% less listening, which could be chance.");

    const notClearly = phrasesOf(record("venusmars", { status: "tested", index: 1.11, p: 0.2, iterations: 2000 }, rest9), "venusmars");
    expect(notClearly.phrases.wordLine).toBe(
      "Not clearly. While Venus and Mars got along, an 11% bigger share of your plays came after midnight, which could be chance.",
    );

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
});

describe("Tonight's heads-up (8.4)", () => {
  it("names the next station within a week, and what the listener has lived through", () => {
    // History from 1 Jan 2025: one Venus retrograde so far (Mar 1 to Apr 12, 2025).
    const p = answersPayload(record("venusrx", { status: "too-few-events", events: 1 }), "ready", NOW);
    expect(p.headsUp).toEqual({ id: "venusrx", line: "Venus turns retrograde Saturday. You've lived through one; see what it did." });
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
