import { describe, expect, it } from "vitest";
import { computeIndex, permutationTest, type TaggedScrobble } from "@/lib/analysis/nostalgia";
import { volumeIndex, volumePermutationTest } from "@/lib/analysis/metrics";
import type { WindowBounds } from "@/lib/ephemeris/retrogrades";
import { isNoiseArtist } from "@/lib/report";
import { conditionFor } from "./conditions";
import { runQuestion, tagMeasures } from "./engine";
import { QUESTIONS } from "./questions";
import { synthHistory } from "./synthHistory";

/* Today's per-play rotation test is the reference (step 0): rotating the
   windows instead of the plays must give the same counts, not nearly the
   same. Both get the same draws on the same plays. 300 draws rather than
   2,000 keep the per-play side fast; the machinery is the same at any count. */

const DRAWS = 300;
const replay = (us: number[]) => {
  let i = 0;
  return () => us[i++];
};

const histories = [
  { name: "15,000 plays, 2006 to 2026", plays: synthHistory(15_000, 11, 2006) },
  { name: "12,000 plays, 2019 to 2026", plays: synthHistory(12_000, 23, 2019) },
];

describe("rotating the windows gives today's per-play counts exactly", () => {
  for (const { name, plays: raw } of histories) {
    const plays = raw.filter((s) => !isNoiseArtist(s.artist));
    const measures = tagMeasures(plays, "America/Chicago");
    const history = { first: plays[0].uts, last: plays[plays.length - 1].uts };
    const draws = Array.from({ length: DRAWS }, (_, i) => ((i * 0.6180339887) % 1 + 0.0001 * i) % 1);

    for (const q of QUESTIONS.filter((x) => !x.nasa)) {
      it(`${name}: question ${q.number}, ${q.id}`, () => {
        const condition = conditionFor(q.id)!;
        const m = measures[q.measure];
        const bounds: WindowBounds[] = condition.windows.map((w) => [w.start, w.end]);
        const rec = runQuestion(q, condition, m, history, draws);
        // The reference needs a test to compare: these histories clear the floors.
        expect(["tested", "too-few-events"], rec.status ?? "null").toContain(rec.status);

        const inSpan = m.times.flatMap((t, i) => (t >= m.spanStart && t <= m.spanEnd ? [i] : []));
        const ref = m.tags
          ? (() => {
              const tagged: TaggedScrobble[] = inSpan.map((i) => ({ uts: m.times[i], nostalgic: m.tags![i] }));
              const obs = computeIndex(tagged, bounds);
              return {
                index: obs.index,
                ...permutationTest(tagged, bounds, m.spanStart, m.spanEnd, obs.index, DRAWS, replay(draws)),
              };
            })()
          : (() => {
              const times = inSpan.map((i) => m.times[i]);
              const obs = volumeIndex(times, bounds, m.spanStart, m.spanEnd);
              return {
                index: obs.index,
                ...volumePermutationTest(times, bounds, m.spanStart, m.spanEnd, obs.index, DRAWS, replay(draws)),
              };
            })();

        expect(rec.index).toBe(ref.index);
        expect(rec.matches).toBe(ref.matches);
        expect(rec.iterations).toBe(ref.iterations);
        expect(rec.p).toBe(ref.p);
        expect(rec.iterations).toBeGreaterThan(DRAWS * 0.9); // the comparison ran on real rotations
      });
    }
  }
});

describe("where most rotations leave the windows empty", () => {
  /* Plays in two five-day clusters 50 days apart, in a 100-day span, and
     windows over the first cluster and across the span's end. Most rotations
     put the windows on days with no plays, which a share skips and a rate
     counts as a total swing; the histories above never get there. */
  const DAY = 86_400;
  const S = 1_600_000_000;
  const E = S + 100 * DAY;
  const times = [
    ...Array.from({ length: 600 }, (_, i) => S + Math.floor((i * 5 * DAY) / 600)),
    ...Array.from({ length: 600 }, (_, i) => S + 50 * DAY + Math.floor((i * 5 * DAY) / 600)),
    E,
  ];
  const tags = times.map((_, i) => i % 3 === 0);
  const condition = {
    kind: "sign" as const,
    windows: [
      { start: S, end: S + 5 * DAY, event: 0 },
      { start: E - 2 * DAY, end: E + 3 * DAY, event: 1 },
    ],
    eventCount: 2,
  };
  const bounds: WindowBounds[] = condition.windows.map((w) => [w.start, w.end]);
  const draws = Array.from({ length: DRAWS }, (_, i) => ((i * 0.7548776662) % 1 + 0.00003 * i) % 1);
  const history = { first: S, last: E };

  it("a share skips them exactly as the per-play test does", () => {
    const q = QUESTIONS.find((x) => x.measure === "aftermidnight")!;
    const rec = runQuestion(q, condition, { times, tags, spanStart: S, spanEnd: E }, history, draws);
    const tagged: TaggedScrobble[] = times.map((uts, i) => ({ uts, nostalgic: tags[i] }));
    const obs = computeIndex(tagged, bounds);
    const ref = permutationTest(tagged, bounds, S, E, obs.index, DRAWS, replay(draws));
    expect(rec.status).toBe("too-few-events");
    expect(rec.matches).toBe(ref.matches);
    expect(rec.iterations).toBe(ref.iterations);
    expect(rec.iterations).toBeLessThan(DRAWS / 2); // most rotations were skipped
  });

  it("a rate counts them exactly as the per-play test does", () => {
    const q = QUESTIONS.find((x) => x.measure === "listening")!;
    const rec = runQuestion(q, condition, { times, tags: null, spanStart: S, spanEnd: E }, history, draws);
    const obs = volumeIndex(times, bounds, S, E);
    const ref = volumePermutationTest(times, bounds, S, E, obs.index, DRAWS, replay(draws));
    expect(rec.matches).toBe(ref.matches);
    expect(rec.iterations).toBe(ref.iterations);
    expect(rec.matches).toBeGreaterThan(DRAWS / 2); // empty windows are total swings
  });
});
