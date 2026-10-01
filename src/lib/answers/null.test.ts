import { describe, expect, it } from "vitest";
import { computeAnswers } from "./engine";
import { conditionFor } from "./conditions";
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
    expect(tested / summary.histories).toBeGreaterThan(5);
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

describe("a history with a planted effect", () => {
  it("gets a Yes for the question it was planted in", () => {
    /* A full-moon night owl: on every full moon, 40 extra plays at 12:30 a.m.
       Chicago time. The engine must find it, or the null test above could be
       passing because nothing ever gets a Yes. */
    const base = synthHistory(20_000, 909, 2016);
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
    const rec = computeAnswers("planted", planted, "America/Chicago");
    const words = answerWords(rec.questions.map((q) => (q.status === "tested" ? q.p : null))).words;
    expect(words[1]).toBe("Yes"); // question 2, full moon
  });
});
