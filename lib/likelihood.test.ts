import { describe, expect, it } from "vitest";
import {
  duelSideLabel,
  duelUnscoredReason,
  formatP,
  likelihood,
  pValueNote,
  readTrial,
  sweepCategory,
  trialTier,
} from "./likelihood";
import type { Report } from "./report";
import type { VerdictStatus } from "./analysis/confidence";
import { METRICS, metricVerdict, type MetricKey } from "./analysis/metrics";
import { PHENOMENA } from "./ephemeris/phenomena";

/* How a result reads. Plain-English likelihood by default, never "proves",
   and one reading shared by the reveal, the dashboard, the sweep and the duel,
   so an untested trial can't turn up anywhere as a lead or a conviction. */

/** A report with just the fields these readers look at. */
function trial(over: {
  index: number;
  p: number;
  matches?: number;
  iterations?: number;
  status: VerdictStatus;
  significant?: boolean;
  detail?: string;
}): Report {
  return {
    username: "example-listener",
    body: "venus",
    metric: "nightowl",
    index: over.index,
    p: over.p,
    matches: over.matches ?? 0,
    iterations: over.iterations ?? 2000,
    verdict: {
      headline: "The stars withhold judgment.",
      detail: over.detail ?? "Some plain detail.",
      significant: over.significant ?? false,
      status: over.status,
    },
  } as Report;
}

describe("likelihood wording", () => {
  it.each([
    [0.005, "Very unlikely to be chance."],
    [0.0099, "Very unlikely to be chance."],
    [0.01, "Unlikely to be chance."],
    [0.03, "Unlikely to be chance."],
    [0.049, "Unlikely to be chance."],
    // The app's own bar for a conviction is 0.05; the words change with it.
    [0.05, "Could be chance."],
    [0.1, "Could be chance."],
    // Where a lead ends, so a lead never reads "could easily be chance".
    [0.349, "Could be chance."],
    [0.35, "Could easily be chance."],
    [0.48, "Could easily be chance."],
  ])("p = %s reads '%s'", (p, label) => {
    expect(likelihood(p, 10, 2000).label).toBe(label);
  });

  it("puts the shuffles in plain frequencies", () => {
    expect(likelihood(1 / 2001, 0, 2000).sentence).toBe(
      "Shuffle the sky 2,000 times and a swing this big, up or down, never turns up.",
    );
    expect(likelihood(0.0055, 10, 2000).sentence).toBe(
      "Shuffle the sky and a swing this big, up or down, turns up about 1 time in 200.",
    );
    expect(likelihood(0.3, 600, 2000).sentence).toBe(
      "Shuffle the sky and a swing this big, up or down, turns up about 3 times in 10.",
    );
  });

  it("never says 'proves' and never shows a p-value", () => {
    for (const p of [0.0005, 0.02, 0.1, 0.9]) {
      const { label, sentence } = likelihood(p, Math.round(p * 2000), 2000);
      expect(`${label} ${sentence}`).not.toMatch(/prove|p ?[=<]|p-value|significan/i);
    }
  });
});

describe("the p-value, for a visitor who asked for it", () => {
  it("is never printed as '<0.001'", () => {
    expect(formatP(1 / 2001)).toBe("0.0005");
    expect(formatP(72 / 2001)).toBe("0.036");
    expect(formatP(0.27)).toBe("0.27");
  });

  it("never prints a value on the wrong side of the line its words use", () => {
    // 100 of 2,001: just under 0.05, and it must not print "0.05".
    expect(Number(formatP(100 / 2001))).toBeLessThan(0.05);
    expect(Number(formatP(20 / 2001))).toBeLessThan(0.01);
    expect(Number(formatP(0.3499))).toBeLessThan(0.35);
  });

  it("always comes with what it means", () => {
    const note = pValueNote(0.27, 2000);
    expect(note).toMatch(/^p = 0\.27: /);
    expect(note).toContain("the share of 2,000 shuffled skies");
    expect(note).toContain("0.05");
  });
});

describe("verdict details stay plain English", () => {
  const subject = {
    name: "Mercury",
    when: "when Mercury is retrograde",
    eventNoun: PHENOMENA.mercury.eventNoun,
    cadence: PHENOMENA.mercury.cadence,
  };
  const cases: [number, number, { retroN: number; events: number }][] = [
    [1.4, 0.01, { retroN: 5000, events: 20 }],
    [0.6, 0.01, { retroN: 5000, events: 20 }],
    [1.02, 0.6, { retroN: 5000, events: 20 }],
    [1.4, 0.01, { retroN: 100, events: 20 }],
    [1.4, 0.01, { retroN: 5000, events: 3 }],
    [NaN, NaN, { retroN: 0, events: 0 }],
  ];
  it.each(Object.keys(METRICS) as MetricKey[])("%s never carries a p-value in its detail", (key) => {
    for (const [index, p, evidence] of cases) {
      const v = metricVerdict(METRICS[key], index, p, evidence, subject);
      expect(v.detail).not.toMatch(/\bp ?[=<]|p-value/);
    }
  });

  it("says which plays it counted, so it can't contradict the reveal", () => {
    // The reveal counts every play in the windows; the verdict counts only
    // the ones past this measure's warm-up. It must not call those "your plays".
    const none = metricVerdict(METRICS.nostalgia, NaN, NaN, { retroN: 0, events: 0 }, subject);
    expect(none.detail).not.toMatch(/None of your plays/);
    expect(none.detail).toContain("None of the plays this measure can test");
    const few = metricVerdict(METRICS.nostalgia, 0.9, 0.5, { retroN: 78, events: 3 }, subject);
    expect(few.detail).toContain("Only 78 of the plays this measure can test");
  });

  it("says in plain English why a 3-event trial gets no verdict", () => {
    const v = metricVerdict(METRICS.nightowl, 0.56, 0.0355, { retroN: 6658, events: 3 }, subject);
    expect(v.status).toBe("too-few-events");
    expect(v.significant).toBe(false);
    // The exact sentence, pinned: it's what most visitors see for a rare sky.
    expect(v.detail).toBe(
      "Mercury goes retrograde about three times a year, so this test has only 3 Mercury " +
        "retrogrades to go on, not enough to call a pattern. Retrospect waits for 6, because " +
        "with fewer, one unusual stretch of your life can look like a pattern either way.",
    );
  });
});

describe("one reading of a trial, everywhere", () => {
  // The finding's D3: an index of 0 and p = 0 from too little to test.
  const zeroCount = trial({ index: 0, p: 0.0005, status: "too-few-events" });

  it("never makes an untested trial a lead or a conviction", () => {
    for (const status of ["too-few-plays", "too-few-events", "no-comparison", "warming-up"] as const) {
      const r = trial({ index: 0, p: 0.0005, status, significant: false });
      expect(trialTier(r)).toBe("untested");
      expect(sweepCategory(r)).not.toMatch(/conviction|lead/);
    }
    expect(readTrial(zeroCount).big).toBe("Not enough to tell.");
    expect(readTrial(zeroCount).likelihood).toBeNull();
  });

  it("still finds leads and convictions among tested trials", () => {
    expect(trialTier(trial({ index: 1.38, p: 0.27, status: "tested" }))).toBe("lead");
    expect(trialTier(trial({ index: 0.56, p: 0.01, status: "tested", significant: true }))).toBe(
      "confirmed",
    );
    expect(trialTier(trial({ index: 1.02, p: 0.6, status: "tested" }))).toBe("null");
  });

  it("never calls a lead 'could easily be chance'", () => {
    // The finding's trial: +38%, p = 0.264, a lead on the dashboard.
    for (const p of [0.1, 0.2, 0.264, 0.349]) {
      const r = trial({ index: 1.38, p, matches: Math.round(p * 2000), status: "tested" });
      expect(trialTier(r)).toBe("lead");
      expect(readTrial(r).likelihood!.label).toBe("Could be chance.");
    }
  });

  it("counts only tested trials toward the sweep's judged total", () => {
    expect(sweepCategory(trial({ index: 1.02, p: 0.6, status: "tested" }))).toBe("tested");
    expect(sweepCategory(trial({ index: 1.3, p: 0.2, status: "too-few-plays" }))).toBe("waiting");
    expect(sweepCategory(trial({ index: 0, p: 0.0005, status: "too-few-events" }))).toBe("waiting");
    expect(sweepCategory(trial({ index: NaN, p: NaN, status: "no-comparison" }))).toBe("untested");
  });

  it("labels an untested duel side as untested, not 'within chance'", () => {
    expect(duelSideLabel(zeroCount)).toBe("not enough to test");
    expect(duelSideLabel(undefined)).toBe("no result");
    expect(duelSideLabel(trial({ index: 1.02, p: 0.6, status: "tested" }))).toBe("within chance");
    expect(
      duelSideLabel(trial({ index: 1.2, p: 0.01, status: "tested", significant: true })),
    ).toBe("moved 20%, unlikely to be chance");
  });

  it("says why a duel round wasn't scored, not always 'listening'", () => {
    // 25,000 plays, but Venus only turned retrograde three times.
    expect(
      duelUnscoredReason("listener-a", trial({ index: 0.9, p: 0.5, status: "too-few-events" }), "Venus retrogrades"),
    ).toBe("listener-a's history hasn't had enough Venus retrogrades yet to call a pattern");
    expect(
      duelUnscoredReason("listener-b", trial({ index: NaN, p: NaN, status: "warming-up" }), "full moons"),
    ).toBe("there isn't enough of listener-b's listening to test yet");
  });

  it("doesn't call a flat result a 0% blip", () => {
    const flat = trial({ index: 1.001, p: 0.95, matches: 1900, status: "tested" });
    expect(readTrial(flat).sub).not.toMatch(/0% blips|0% drift/);
  });
});
