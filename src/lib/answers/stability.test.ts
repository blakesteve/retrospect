import { describe, expect, it } from "vitest";
import { computeAnswers } from "./engine";
import { nullHistory } from "./nullTrials";
import { answerWords } from "./words";

/* A word that changes because the listener played a few more days isn't an
   answer (6.1a). Two made-up histories with no sky effect, each with a
   question on whole periods sitting just past the line between Maybe and
   Not clearly (p 0.1), topped up by 1, 3 and 7 days of their own plays: the
   word must hold. On 6.1's rule, by a fraction of the span, both flipped
   (6 Oct 2026). No window of either question begins during the top-up, so
   nothing in the sky changed. */

const DAY = 86_400;
/* The match counts are snapshots, not requirements: they catch a change to the
   seams or the draws that leaves the words alone. A new analysis version
   reshuffles both and resets them. */
const CASES = [
  // The strong Moon at p 0.102 to 0.106; on 6.1's rule, 0.079, 0.085, 0.108, 0.101.
  { k: 26, id: "moonstrong", base: 1_789_237_153, matches: [205, 204, 207, 212] },
  // Mercury retrograde at p 0.110 to 0.113; on 6.1's rule, 0.062, 0.075, 0.090, 0.119.
  { k: 118, id: "mercury", base: 1_790_121_831, matches: [222, 221, 225, 219] },
] as const;

describe("a question on whole periods near a word's line, as its history grows", () => {
  for (const c of CASES) {
    it(`keeps ${c.id}'s word on null history ${c.k} through 1, 3 and 7 more days`, () => {
      const all = nullHistory(c.k, false).history;
      const got = [0, 1, 3, 7].map((d) => {
        const until = c.base + d * DAY;
        const rec = computeAnswers(
          `null-${c.k}`,
          all.filter((p) => p.uts <= until),
          "America/Chicago",
          (until + 3600) * 1000,
        );
        const i = rec.questions.findIndex((q) => q.id === c.id);
        const words = answerWords(rec.questions.map((q) => (q.status === "tested" ? q.p : null))).words;
        return { matches: rec.questions[i].matches, p: rec.questions[i].p!, word: words[i] };
      });
      expect(got.map((g) => g.word)).toEqual(["Not clearly", "Not clearly", "Not clearly", "Not clearly"]);
      expect(got.map((g) => g.matches)).toEqual(c.matches);
      // Near the line at every cut, so a flip had room to happen.
      for (const g of got) expect(Math.abs(g.p - 0.1)).toBeLessThan(0.015);
    }, 60_000);
  }
});
