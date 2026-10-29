import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { computeAnswers } from "./engine";
import { conditionFor } from "./conditions";
import { QUESTIONS, type QuestionId } from "./questions";
import { NASA_FIXTURE, nullHistory, nullTrial, summarize } from "./nullTrials";
import { synthHistory } from "./synthHistory";
import { answerWords } from "./words";

/* The quick, in-suite null-data test (spec 6.3; the full one is
   `npm run null-test`, 1,000 histories at most 13%). 100 young, light
   histories with no sky effect: at most 19% may get any Yes (10% plus about
   three standard deviations at this size, architect 30 Sept). */

describe("histories with no sky effect", () => {
  const summary = summarize(Array.from({ length: 100 }, (_, k) => nullTrial(k, true)));

  it("get a Yes in at most 19 of 100", () => {
    expect(summary.histories).toBe(100);
    expect(summary.anyYesShare).toBeLessThanOrEqual(0.19);
  });

  it("would break that bound without the correction, so the bound means something", () => {
    // The same histories under "Yes when p < 0.05", the rule the 25-trial
    // sweep used. With several questions tested each, it fires far more often.
    expect(summary.anyLowPShare).toBeGreaterThan(0.19);
  });

  it("test enough questions for the correction to matter", () => {
    const tested = Object.values(summary.perQuestion).reduce((n, q) => n + q.tested, 0);
    // 4.92 since question 5 counts old favorites (1 Oct 2026), down from
    // 5.16: once its first year is dropped, 26 of these light histories have
    // under 500 plays in its windows. Same 100 histories every run.
    expect(tested / summary.histories).toBeGreaterThan(4.8);
  });

  it("reach NASA's two questions, against its real log", () => {
    // These young, light histories are too early for a verdict on 7 and 8
    // (under 500 plays on storm nights); the full run tests them.
    const { history } = nullHistory(0, true);
    const record = computeAnswers("null-0", history, "America/Chicago", Date.now(), NASA_FIXTURE);
    for (const q of record.questions.filter((x) => x.id === "storms" || x.id === "flares")) {
      expect(q.notChecked, q.id).toBeNull();
      expect(q.events, q.id).toBeGreaterThan(50);
    }
  });
});

/* Planted effects, one per seam question (6.1a; ClickUp 86e3m6dgn): the
   engine must find a real effect, or the null test above could be passing
   because nothing ever gets a Yes. Each is planted in the same made-up
   history (20,000 plays from 2016), and each has its twin: that history with
   nothing planted, where the question is tested and isn't a Yes. Each plant
   is strong, at or near the lowest p the 2,000 rotations can give, so these
   catch an engine that can't find a clear effect, not one that's lost a
   little power. */
const BASE = synthHistory(20_000, 909, 2016);
const DAY = 86_400;

/** Its words, by the spec's rule over all 12. */
function wordsOf(history: Scrobble[]) {
  const rec = computeAnswers("planted", history, "America/Chicago");
  return answerWords(rec.questions.map((q) => (q.status === "tested" ? q.p : null))).words;
}
const wordFor = (history: Scrobble[], id: QuestionId) => wordsOf(history)[QUESTIONS.findIndex((q) => q.id === id)];
/** The twin: the history with nothing planted, worked out once; its word for a question, which must be tested to count. */
let baseWords: ReturnType<typeof wordsOf> | null = null;
const twinWord = (id: QuestionId) => {
  baseWords ??= wordsOf(BASE);
  const word = baseWords[QUESTIONS.findIndex((q) => q.id === id)];
  // A tested question always has a word; an untested one has none (and would read "Too early").
  expect(word, `${id} is tested in the twin`).not.toBeNull();
  return word;
};

/** `perDay` extra plays a day through each of a question's windows after the
    first year's warm-up, at 1:00 UTC (8 p.m. CDT, 7 p.m. CST: before
    midnight, so never after-midnight plays themselves), each the song
    `pick(n)` gives for the n-th one added. */
function plant(id: QuestionId, perDay: number, pick: (n: number) => Pick<Scrobble, "artist" | "track">) {
  const first = BASE[0].uts;
  const last = BASE[BASE.length - 1].uts;
  let n = 0;
  const extra = conditionFor(id)!
    .windows.filter((w) => w.start > first + 400 * DAY && w.end < last)
    .flatMap((w) => {
      const out: Scrobble[] = [];
      for (let day = Math.floor(w.start / DAY) * DAY + DAY; day < w.end; day += DAY) {
        for (let i = 0; i < perDay; i++) {
          const uts = day + 3600 + i * 200;
          if (uts >= w.start && uts <= w.end) out.push({ uts, ...pick(n++) });
        }
      }
      return out;
    });
  return [...BASE, ...extra].sort((a, b) => a.uts - b.uts);
}

/** Songs from the history's first four months: by any window after its first year, an old favorite (6.7). */
const EARLY = [...new Map(BASE.filter((p) => p.uts < BASE[0].uts + 120 * DAY).map((p) => [`${p.artist}|${p.track}`, p])).values()]
  .slice(0, 300)
  .map(({ artist, track }) => ({ artist, track }));
const oldFavorite = (n: number) => EARLY[n % EARLY.length];
/** A song never played before: a first listen. */
const firstListen = (n: number) => ({ artist: "Artist 3", track: `Planted ${n}` });

// Two runs of the engine on 20,000 plays and more each: seconds, not milliseconds.
describe("a history with a planted effect", { timeout: 30_000 }, () => {
  it("gets a Yes for Mercury retrograde when old favorites come back during it, and its twin doesn't", () => {
    // 2 extra plays of first-year songs a day through every retrograde: old
    // favorites 7% more of the listening inside than out (index 1.074, p
    // .0005, 28 Oct 2026); 1 a day was already a Yes (p .0065).
    expect(wordFor(plant("mercury", 2, oldFavorite), "mercury")).toBe("Yes");
    expect(twinWord("mercury")).not.toBe("Yes");
  });

  it("gets a Yes for the new moon when new songs come with it, and its twin doesn't", () => {
    // 1 song never heard before on each day of a new moon: first listens 2.5
    // times their share outside (p .0005, 28 Oct 2026), first listens being
    // rare.
    expect(wordFor(plant("newmoon", 1, firstListen), "newmoon")).toBe("Yes");
    expect(twinWord("newmoon")).not.toBe("Yes");
  });

  it("gets a Yes for a strong Moon when old favorites come back with it, and its twin doesn't", () => {
    // 3 extra plays of first-year songs a day while the Moon is in Taurus or
    // Cancer: old favorites 8% more of the listening inside (index 1.083, p
    // .0005, 28 Oct 2026); 2 a day gave p .0015, still a Yes, and 1 a Maybe.
    expect(wordFor(plant("moonstrong", 3, oldFavorite), "moonstrong")).toBe("Yes");
    expect(twinWord("moonstrong")).not.toBe("Yes");
  });

  it("gets a Yes for the full moon from a night owl, and its twin doesn't", () => {
    /* A full-moon night owl: on every full moon, 40 extra plays at 12:30 a.m.
       Chicago time. */
    const base = BASE;
    const first = base[0].uts;
    const last = base[base.length - 1].uts;
    const extra = conditionFor("fullmoon")!
      .windows.filter((w) => w.start > first && w.end < last)
      .flatMap((w) => {
        const mid = Math.floor((w.start + w.end) / 2);
        const day = mid - (mid % 86_400);
        // 05:30 UTC is 12:30 a.m. CDT and 11:30 p.m. CST; use 06:30 in winter.
        const month = new Date(mid * 1000).getUTCMonth();
        const t = day + (month >= 3 && month <= 9 ? 5.5 : 6.5) * 3600;
        return Array.from({ length: 40 }, (_, i) => ({ uts: t + i * 30, artist: "Artist 7", track: `Track ${i}` }));
      });
    const planted = [...base, ...extra].sort((a, b) => a.uts - b.uts);
    expect(wordFor(planted, "fullmoon")).toBe("Yes");
    expect(twinWord("fullmoon")).not.toBe("Yes");
  });
});
