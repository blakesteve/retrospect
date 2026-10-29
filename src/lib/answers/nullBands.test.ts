import { describe, expect, it } from "vitest";
import { conditionFor } from "./conditions";
import { BANDS, FLOOR_QUESTIONS, bandHistory, floorHistory } from "./nullTrials";
import { questionById } from "./questions";
import { synthHistory, synthSpan } from "./synthHistory";

/* The young histories `npm run null-test` adds (ClickUp 86e3m6dgn): what each
   is built to be, checked without running the engine, so the suite stays
   quick. The run itself checks the engine's side: every band within 13%, and
   nothing tested below 6 events. */

const DAY = 86_400;
const END = Date.UTC(2026, 8, 30) / 1000;

describe("the null test's young histories", () => {
  it("come from the same listener as the rest: synthSpan from 1 January is synthHistory", () => {
    const start = Date.UTC(2021, 0, 1) / 1000;
    expect(synthSpan(4_000, 50_007, start, END)).toEqual(synthHistory(4_000, 50_007, 2021));
  });

  it("each run as long as its band says, and end on 30 Sept 2026", () => {
    for (let b = 0; b < BANDS.length; b++) {
      for (const k of [0, 1, 2]) {
        const { days, history } = bandHistory(b, k);
        expect(days, `${BANDS[b].id} ${k}`).toBeGreaterThanOrEqual(BANDS[b].minDays);
        expect(days, `${BANDS[b].id} ${k}`).toBeLessThan(BANDS[b].maxDays);
        expect(history.at(-1)!.uts).toBeGreaterThan(END - 3 * DAY);
        expect(history[0].uts).toBeLessThan(END - (days - 3) * DAY);
      }
    }
  });

  it("at the floor, hold exactly the events they're built for, counted from the question's own windows", () => {
    // The windows the span overlaps; the engine also needs a play in each,
    // so it can count one or two fewer, never more (the run checks that).
    for (const id of FLOOR_QUESTIONS) {
      const windows = conditionFor(id)!.windows;
      for (const target of [6, 5]) {
        for (const k of [0, 1, 2, 3, 4]) {
          const { history } = floorHistory(id, target, k);
          // The test span: after the warm-up, to the last play (6.1).
          const S = history[0].uts + questionById(id).warmupDays * DAY;
          const E = history.at(-1)!.uts;
          const events = new Set(windows.filter((w) => w.end >= S && w.start <= E).map((w) => w.event));
          expect(events.size, `${id}, built for ${target}, #${k}`).toBe(target);
        }
      }
    }
  });
});
