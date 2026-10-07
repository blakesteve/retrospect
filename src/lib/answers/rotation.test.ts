import { describe, expect, it } from "vitest";
import { computeIndex, permutationTest, type TaggedScrobble } from "@/lib/analysis/nostalgia";
import { volumeIndex, volumePermutationTest } from "@/lib/analysis/metrics";
import type { WindowBounds } from "@/lib/ephemeris/retrogrades";
import { isNoiseArtist } from "@/lib/noise";
import { conditionFor } from "./conditions";
import { runQuestion, seamCircle, tagMeasures, typicalSwingOf } from "./engine";
import { QUESTIONS, questionById } from "./questions";
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
  // Ending two days after Mercury's July 2026 retrograde: the next is 91 days
  // off, so a circle that stops short of a period past the history shows.
  { name: "2019 to 25 July 2026", plays: synthHistory(12_000, 23, 2019).filter((s) => s.uts < Date.UTC(2026, 6, 25) / 1000) },
];

describe("rotating the windows gives the per-play counts exactly", () => {
  /* Each question against today's per-play test (6.1), or for a question on
     whole periods (6.1a), the same per-play test run rotation by rotation on
     that rotation's own circle: whole periods, as many as fit in the span,
     plus its seam, and a period more when that falls inside the span. So a
     question can't change rules unnoticed: Venus retrograde on a seam would
     stop matching 6.1's reference. */
  const DAY = 86_400;
  for (const { name, plays: raw } of histories) {
    const plays = raw.filter((s) => !isNoiseArtist(s.artist));
    const measures = tagMeasures(plays, "America/Chicago");
    const history = { first: plays[0].uts, last: plays[plays.length - 1].uts };
    const draws = Array.from({ length: DRAWS }, (_, i) => ((i * 0.6180339887) % 1 + 0.0001 * i) % 1);
    const seams = Array.from({ length: DRAWS }, (_, i) => ((i * 0.7548776662) % 1 + 0.00003 * i) % 1);

    for (const q of QUESTIONS.filter((x) => !x.nasa)) {
      it(`${name}: question ${q.number}, ${q.id}`, () => {
        const condition = conditionFor(q.id)!;
        const m = measures[q.measure];
        const bounds: WindowBounds[] = condition.windows.map((w) => [w.start, w.end]);
        const rec = runQuestion(q, condition, m, history, draws, seams);
        // The reference needs a test to compare: these histories clear the floors.
        expect(["tested", "too-few-events"], rec.status ?? "null").toContain(rec.status);

        const inSpan = m.times.flatMap((t, i) => (t >= m.spanStart && t <= m.spanEnd ? [i] : []));
        const L = m.spanEnd - m.spanStart;
        const ref = (() => {
          if (!m.tags) {
            const times = inSpan.map((i) => m.times[i]);
            const obs = volumeIndex(times, bounds, m.spanStart, m.spanEnd);
            return { index: obs.index, ...volumePermutationTest(times, bounds, m.spanStart, m.spanEnd, obs.index, DRAWS, replay(draws)) };
          }
          const tagged: TaggedScrobble[] = inSpan.map((i) => ({ uts: m.times[i], nostalgic: m.tags![i] }));
          const obs = computeIndex(tagged, bounds);
          if (!q.period) return { index: obs.index, ...permutationTest(tagged, bounds, m.spanStart, m.spanEnd, obs.index, DRAWS, replay(draws)) };
          let matches = 0;
          let iterations = 0;
          const samples: number[] = [];
          // A period in whole seconds, as the plays are.
          const P = Math.round(q.period * DAY);
          draws.forEach((u, i) => {
            let LC = Math.floor(L / P) * P + Math.floor(seams[i] * P);
            if (LC <= L) LC += P;
            const one = permutationTest(tagged, bounds, m.spanStart, m.spanStart + LC, obs.index, 1, replay([u]));
            matches += one.matches;
            iterations += one.iterations;
            samples.push(...one.samples);
          });
          return { index: obs.index, matches, iterations, p: (matches + 1) / (iterations + 1), samples };
        })();

        expect(rec.index).toBe(ref.index);
        expect(rec.matches).toBe(ref.matches);
        expect(rec.iterations).toBe(ref.iterations);
        expect(rec.p).toBe(ref.p);
        // Rotation by rotation, not just in total: every swing, as stored (four figures).
        expect(rec.nullSamples).toEqual(ref.samples.map((x) => Number(x.toPrecision(4))));
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
    const q = QUESTIONS.find((x) => x.measure === "aftermidnight" && !x.period)!;
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

describe("which rule each question turns by (6.1, 6.1a)", () => {
  it("turns Mercury retrograde and the Moon's three questions on whole periods, and nothing else", () => {
    // The synodic month, the tropical month and Mercury's synodic period, in days (6.1a).
    expect(Object.fromEntries(QUESTIONS.filter((q) => q.period).map((q) => [q.id, q.period]))).toEqual({
      mercury: 115.8775,
      fullmoon: 29.530589,
      newmoon: 29.530589,
      moonstrong: 27.321582,
    });
    // Venus retrograde stays on the span's own length (6.1a).
    expect(questionById("venusrx").period).toBeUndefined();
  });

  it("gives whole periods only to questions with a share measure", () => {
    const plays = histories[1].plays.filter((s) => !isNoiseArtist(s.artist));
    const measures = tagMeasures(plays, "America/Chicago");
    // A share tags each play; a rate has no tags.
    for (const q of QUESTIONS.filter((x) => x.period)) expect(measures[q.measure].tags, q.id).not.toBeNull();
  });

  it("gives each rotation a circle of whole periods plus its seam, never shorter than the span", () => {
    const DAY = 86_400;
    // A 30-day period and a 100-day span: three periods fit, 90 days.
    expect(seamCircle(100 * DAY, 30, 0.5)).toBe(105 * DAY); // 90 + 15, past the span
    expect(seamCircle(100 * DAY, 30, 0.2)).toBe(126 * DAY); // 90 + 6 is inside it, so a period more
    expect(seamCircle(100 * DAY, 30, 0)).toBe(120 * DAY);
    expect(seamCircle(100 * DAY, 30, 0.99)).toBe(119 * DAY + 60_480); // 90 + 29.7
    // Each period in whole seconds: Mercury's 115.8775 days, the synodic month, the tropical month.
    expect(seamCircle(0, 115.8775, 0)).toBe(10_011_816);
    expect(seamCircle(0, 29.530589, 0)).toBe(2_551_443);
    expect(seamCircle(0, 27.321582, 0)).toBe(2_360_585);
  });

  it("refuses a rate measure on whole periods, which would count the stretch past the history as no listening", () => {
    const DAY = 86_400;
    const S = 1_600_000_000;
    const E = S + 400 * DAY;
    // Enough plays inside the windows to clear the floors and reach the rotations.
    const times = Array.from({ length: 10_000 }, (_, i) => S + i * 3_400);
    const windows = Array.from({ length: 20 }, (_, k) => ({ start: S + k * 30 * DAY, end: S + k * 30 * DAY + 3 * DAY, event: k }));
    const q = { ...questionById("fullmoon"), period: 30 };
    const seams = Array.from({ length: DRAWS }, (_, i) => (i * 0.37) % 1);
    const draws = Array.from({ length: DRAWS }, (_, i) => (i * 0.61) % 1);
    const rate = () =>
      runQuestion(q, { kind: "sign", windows, eventCount: 20 }, { times, tags: null, spanStart: S, spanEnd: E }, { first: S, last: E }, draws, seams);
    expect(rate).toThrow(/rate/);
  });

  it("needs a seam for every rotation of a question on whole periods", () => {
    const plays = histories[1].plays.filter((s) => !isNoiseArtist(s.artist));
    const m = tagMeasures(plays, "America/Chicago").aftermidnight;
    const q = questionById("fullmoon");
    const draws = Array.from({ length: DRAWS }, (_, i) => (i * 0.61) % 1);
    const history = { first: plays[0].uts, last: plays.at(-1)!.uts };
    expect(() => runQuestion(q, conditionFor("fullmoon")!, m, history, draws)).toThrow(/seam/);
    // One short: its rotation would drop out of p unnoticed.
    const seams = draws.slice(0, DRAWS - 1);
    expect(() => runQuestion(q, conditionFor("fullmoon")!, m, history, draws, seams)).toThrow(/seam/);
  });
});

describe("a question on whole periods below the event floor", () => {
  /* Too few full moons (6.5), so the early reads run. Each rotation by hand:
     every play moved around that rotation's own circle, counted in each
     window it lands in. A stretch's own count stops at the history's end, as
     its row does; the count of everything inside a window runs on past it,
     through the sky's own windows. */
  const DAY = 86_400;
  const q = questionById("fullmoon");
  const condition = conditionFor("fullmoon")!;
  const draws = Array.from({ length: DRAWS }, (_, i) => ((i * 0.6180339887) % 1 + 0.0001 * i) % 1);
  const seams = Array.from({ length: DRAWS }, (_, i) => ((i * 0.7548776662) % 1 + 0.00003 * i) % 1);

  /** Plays every `step` seconds from `S` until `until`, some tagged, and their record. */
  function run(S: number, until: number, step: number) {
    const times = Array.from({ length: Math.floor((until - S - 300) / step) + 1 }, (_, i) => S + 300 + i * step);
    const tags = times.map((_, i) => i % 3 === 0 || i % 7 === 0);
    const E = times.at(-1)!;
    const rec = runQuestion(q, condition, { times, tags, spanStart: S, spanEnd: E }, { first: S, last: E }, draws, seams);
    return { times, tags, S, E, rec };
  }

  function byHand({ times, tags, S, E }: { times: number[]; tags: boolean[]; S: number; E: number }) {
    const L = E - S;
    const P = Math.round(q.period! * DAY);
    const inSpan = condition.windows.filter((w) => w.end >= S && w.start <= E);
    const counted = new Set(inSpan.filter((w) => times.some((t) => t >= w.start && t <= w.end)).map((w) => w.event));
    const finished = [...counted].filter((e) => inSpan.every((w) => w.event !== e || w.end <= E));
    const pooled = new Set(finished.length > 0 ? finished : counted);
    const lattice = condition.windows.filter((w) => w.end >= S && w.start < S + L + P);
    const totalTag = tags.filter(Boolean).length;
    const swings: number[] = [];
    draws.forEach((u, r) => {
      let LC = Math.floor(L / P) * P + Math.floor(seams[r] * P);
      if (LC <= L) LC += P;
      const o = Math.floor(u * LC);
      const at = times.map((t) => (t - S + o) % LC);
      const inside = (lo: number, hi: number) => {
        let n = 0;
        let tg = 0;
        at.forEach((y, i) => {
          if (y < lo || y > hi) return;
          n++;
          if (tags[i]) tg++;
        });
        return [n, tg];
      };
      let allN = 0;
      let allTag = 0;
      const perEvent = new Map<number, [number, number]>();
      for (const w of lattice) {
        const lo = Math.max(Math.ceil(w.start) - S, 0);
        const hi = Math.min(Math.floor(w.end) - S, LC - 1);
        if (lo > hi) continue;
        const [n, tg] = inside(lo, hi);
        allN += n;
        allTag += tg;
        // Its own stretch: the part inside the history, which ends at L.
        if (!pooled.has(w.event) || lo > L) continue;
        const [ownN, ownTag] = inside(lo, Math.min(hi, L));
        const acc = perEvent.get(w.event) ?? [0, 0];
        perEvent.set(w.event, [acc[0] + ownN, acc[1] + ownTag]);
      }
      const restN = times.length - allN;
      const restTag = totalTag - allTag;
      for (const [n, tg] of perEvent.values()) {
        if (n === 0 || restN === 0 || restTag === 0) continue;
        swings.push(tg / n / (restTag / restN) - 1);
      }
    });
    return swings;
  }

  it("reads one stretch on its own on the same circles, exactly as a per-play count does", () => {
    // 140 days from 1 Jan 2026, a play every 10 minutes: four or five full moons.
    const S = Date.UTC(2026, 0, 1) / 1000;
    const h = run(S, S + 140 * DAY, 600);
    expect(h.rec.status).toBe("too-few-events");
    const swings = byHand(h);
    expect(swings.length).toBeGreaterThan(DRAWS);
    // Stored to four figures, as every shuffled number is.
    expect(h.rec.typicalSingleSwing).toBe(Number(typicalSwingOf(swings)!.toPrecision(4)));
  });

  it("stops a stretch still going at the history's end there, as its row does", () => {
    /* 10 Jan to 2 Feb 2026: the only full moon is 1 Feb's, whose window runs
       31 Jan to 3 Feb, so the history ends a day and a half into it and the
       only stretch to read is the one still going. A play every 2 minutes
       puts enough of them inside it to read (6.5). */
    const h = run(Date.UTC(2026, 0, 10) / 1000, Date.UTC(2026, 1, 2) / 1000, 120);
    expect(h.rec.status).toBe("too-few-events");
    expect(h.rec.earlyReads.map((r) => r.inProgress)).toEqual([true]);
    const swings = byHand(h);
    expect(swings.length).toBeGreaterThan(DRAWS / 2);
    expect(h.rec.typicalSingleSwing).toBe(Number(typicalSwingOf(swings)!.toPrecision(4)));
  });
});
