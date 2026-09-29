import { describe, expect, it } from "vitest";
import { countEvents, evidenceStatus, permutationP } from "./confidence";
import { permutationTest, type TaggedScrobble } from "./nostalgia";
import { volumePermutationTest } from "./metrics";
import { mulberry32 } from "./rng";

/* The scramble test's p-value, and the floors below which there's no verdict.
   Requirements are pinned as literals, not as the formulas that make them. */

const DAY = 86400;

describe("the p-value never claims more than the shuffles support", () => {
  it("is never 0: with 2,000 shuffles and no matches it is 1 in 2,001", () => {
    expect(permutationP(0, 2000)).toBe(1 / 2001);
    expect(permutationP(0, 2000)).toBeGreaterThan(0);
  });

  it("counts shuffles that find none of the tagged plays inside the windows", () => {
    /* One 10-day window at the start of a 100-day span. Ordinary plays every
       day; the only tagged plays are three, in days 50 to 52. So the real
       window holds none of them (an index of 0, the "-100%" in the finding),
       and most shuffled windows miss them too. That's what chance does here,
       so the honest answer is "could easily be chance". The old test dropped
       every shuffle that also found none, and printed p<0.001. */
    const start = 0;
    const end = 100 * DAY;
    const tagged: TaggedScrobble[] = [];
    for (let d = 0; d < 100; d++) {
      for (let h = 0; h < 10; h++) tagged.push({ uts: d * DAY + h * 3600, nostalgic: false });
    }
    for (const d of [50, 51, 52]) tagged.push({ uts: d * DAY + 12 * 3600, nostalgic: true });
    tagged.sort((a, b) => a.uts - b.uts);
    const bounds: [number, number][] = [[0, 10 * DAY]];

    const test = permutationTest(tagged, bounds, start, end, 0, 500, mulberry32(1));
    // Requirement: most shuffles also find none, so p is large.
    expect(test.p).toBeGreaterThan(0.5);
    expect(test.matches).toBeGreaterThan(250);
    // And the shuffles that found none are counted, not dropped, and drawn in
    // the skeptic's pile at 0 rather than left out of it.
    expect(test.iterations).toBe(500);
    expect(test.samples).toContain(0);
  });

  it("gives the rate measure the same floor", () => {
    // A huge planted boost no shuffle can match: p is 1 in 301, not 0.
    const uts: number[] = [];
    for (let d = 0; d < 200; d++) {
      const plays = d >= 100 && d < 110 ? 200 : 5;
      // Spread across the whole day, so only a near-exact shuffle could line
      // a window up with all ten boosted days.
      for (let i = 0; i < plays; i++) uts.push(d * DAY + Math.floor((i * DAY) / plays));
    }
    const bounds: [number, number][] = [[100 * DAY, 110 * DAY - 1]];
    const observed = (2000 / 10) / (950 / 190);
    const test = volumePermutationTest(uts, bounds, 0, 200 * DAY - 1, observed, 300, mulberry32(3));
    expect(test.matches).toBe(0);
    expect(test.p).toBe(1 / 301);
  });
});

describe("the rate measure counts shuffles with no plays in the window", () => {
  it("reads listening that only happened in one burst as chance", () => {
    /* Nearly all the listening is one three-day burst, and the real window
       sits on it. Most shuffled windows land on days with no plays at all:
       an index of 0, a total swing the other way. Those used to be dropped,
       leaving only the few shuffles near the burst, and p came out tiny. */
    const uts: number[] = [];
    for (let d = 0; d < 100; d++) {
      if (d >= 50 && d < 53) for (let i = 0; i < 100; i++) uts.push(d * DAY + i * 600);
      else if (d % 10 === 0) uts.push(d * DAY + 3600);
    }
    const bounds: [number, number][] = [[50 * DAY, 53 * DAY - 1]];
    const inRate = 300 / 3;
    const outRate = 10 / 97;
    const test = volumePermutationTest(uts, bounds, 0, 100 * DAY - 1, inRate / outRate, 500, mulberry32(5));
    expect(test.p).toBeGreaterThan(0.5);
    expect(test.iterations).toBe(500);
  });
});

describe("evidence floors", () => {
  const ok = { index: 1.4, p: 0.01 };

  it("needs 500 plays inside the windows", () => {
    expect(evidenceStatus(ok.index, ok.p, { retroN: 499, events: 50 })).toBe("too-few-plays");
    expect(evidenceStatus(ok.index, ok.p, { retroN: 500, events: 50 })).toBe("tested");
  });

  it("needs six separate events, however many plays", () => {
    // Six is where every event agreeing can first beat 5% by chance: 2/2^6.
    expect(evidenceStatus(ok.index, ok.p, { retroN: 100_000, events: 3 })).toBe("too-few-events");
    expect(evidenceStatus(ok.index, ok.p, { retroN: 100_000, events: 5 })).toBe("too-few-events");
    expect(evidenceStatus(ok.index, ok.p, { retroN: 100_000, events: 6 })).toBe("tested");
  });

  it("calls a trial with plays but no ratio 'no-comparison', not unremarkable", () => {
    expect(evidenceStatus(1.2, NaN, { retroN: 900, events: 9 })).toBe("no-comparison");
    expect(evidenceStatus(NaN, NaN, { retroN: 900, events: 9 })).toBe("no-comparison");
  });

  it("calls no plays inside the windows yet a wait for history, not a failure", () => {
    // Venus hasn't turned retrograde since a three-month history began.
    expect(evidenceStatus(NaN, NaN, { retroN: 0, events: 0 })).toBe("too-few-plays");
  });
});

describe("countEvents", () => {
  const bounds: [number, number][] = [
    [10, 20],
    [30, 40],
    [50, 60],
    [70, 80],
  ];

  it("counts windows in the span that hold some of the trial's plays", () => {
    // Plays in the first and third windows only; the fourth is past the span.
    expect(countEvents(bounds, 0, 75, [15, 55, 65])).toBe(2);
  });

  it("counts a play on a window's edge as inside it", () => {
    expect(countEvents(bounds, 0, 100, [20, 30])).toBe(2);
  });

  it("counts every window in the span for the rate measure, played in or not", () => {
    expect(countEvents(bounds, 0, 75, [15], true)).toBe(4);
    expect(countEvents(bounds, 25, 65, [], true)).toBe(2);
  });
});
