import { describe, expect, it } from "vitest";
import {
  pendingHabitsSentence,
  sweepNoHitsSentence,
  warmupExplanation,
  type PendingHabit,
  type Warmup,
} from "./readiness";
import { humanDays } from "./analysis/metrics";

/* What a young history is told instead of an error screen. Plain English, a
   real date, never a promise of a date that has already passed, and never a
   promise of an answer: only of when plays start counting. */

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;
const MERCURY = "when Mercury is retrograde";

const young: Warmup = {
  reason: "young-history",
  days: 365,
  historyStartUts: utc(2026, 7, 10),
  readyFromUts: utc(2027, 7, 10),
};

/** Words a casual reader shouldn't need to know. */
const JARGON = /\b(p ?[<=]|p-value|index|significan|statistic|permutation|null|sample|threshold|warm-?up)\b/i;

describe("warmupExplanation", () => {
  it("names the month the history starts and the month plays start counting", () => {
    const text = warmupExplanation("nostalgia", young, MERCURY, Date.UTC(2026, 9, 1));
    expect(text).toContain("July 2026");
    expect(text).toContain("arrive in July 2027");
    expect(text).toContain("when you first played it more than 1 year earlier");
    expect(text).not.toMatch(JARGON);
  });

  it("never says '1.0 years'", () => {
    expect(humanDays(365)).toBe("1 year");
    expect(humanDays(370)).toBe("1 year");
    expect(humanDays(400)).toBe("1.1 years");
    expect(humanDays(548)).toBe("1.5 years");
    expect(humanDays(730)).toBe("2 years");
    expect(humanDays(90)).toBe("90 days");
  });

  it("says 'years' for a setting between one year and a year and a half", () => {
    const text = warmupExplanation("nostalgia", { ...young, days: 400 }, MERCURY, Date.UTC(2026, 9, 1));
    expect(text).toContain("more than 1.1 years earlier");
  });

  it("holds when reading by artist as well as by song", () => {
    // The level toggle changes what "it" is; the sentence mustn't say "song".
    const text = warmupExplanation("nostalgia", young, MERCURY, Date.UTC(2026, 9, 1));
    expect(text).not.toMatch(/\bsong\b/);
  });

  it("promises when counting starts, not when an answer arrives", () => {
    const text = warmupExplanation("nostalgia", young, MERCURY, Date.UTC(2026, 9, 1));
    // An answer also needs listening during the event itself, which for a
    // rare sky can take years.
    expect(text).toContain("enough of your listening when Mercury is retrograde");
    expect(text).not.toMatch(/clear answer|you'll know|ready by/i);
  });

  it("doesn't promise a date that has already passed to a history gone quiet", () => {
    const text = warmupExplanation("nostalgia", young, MERCURY, Date.UTC(2028, 0, 1));
    expect(text).not.toContain("arrive in");
    expect(text).toBe(
      "Retrospect counts a play as an old favorite when you first played it more than 1 year earlier. " +
        "Your history stops before July 2027, when plays start counting. Once Last.fm records listening after that, this can start.",
    );
  });

  it("points an early era at the month it can start", () => {
    const text = warmupExplanation(
      "oldflame",
      { reason: "era-in-warmup", days: 548, historyStartUts: utc(2020, 1, 1), readyFromUts: utc(2021, 7, 2) },
      MERCURY,
    );
    expect(text).toContain("an artist you'd played at least 10 times, after more than 1.5 years away");
    // True whether or not the era itself runs past July 2021: a gap in
    // listening can leave every play in it before plays start counting.
    expect(text).toContain("Everything you played in that stretch comes before July 2021");
    expect(text).not.toMatch(/runs past/);
  });

  it("counts Discovery's year from the history, not from the account", () => {
    const text = warmupExplanation("discovery", young, "during an eclipse season");
    expect(text).toContain("after the first year of your history");
    expect(text).not.toMatch(JARGON);
  });
});

describe("pendingHabitsSentence", () => {
  const habit = (over: Partial<PendingHabit>): PendingHabit => ({
    habit: "old-favorites",
    readyFromUts: utc(2027, 3, 1),
    countedPlays: 0,
    minPlays: 500,
    ...over,
  });

  it("is null when nothing is pending", () => {
    expect(pendingHabitsSentence([], Date.UTC(2026, 5, 1), "UTC")).toBeNull();
  });

  it("gives a future start as a month, and says counting then needs songs", () => {
    expect(pendingHabitsSentence([habit({})], Date.UTC(2026, 5, 1), "UTC")).toBe(
      "One habit needs more history before it means anything: whether you mostly replay old favorites or go looking for new music (from March 2027, once you've played about 500 songs after that).",
    );
  });

  it("gives a past start as the songs still needed", () => {
    const text = pendingHabitsSentence([habit({ countedPlays: 74 })], Date.UTC(2027, 6, 1), "UTC")!;
    expect(text).toContain("(needs about 430 more songs)");
  });

  it("names the month in the listener's zone, not UTC's", () => {
    // 3 a.m. UTC on Mar 1, 2027 is still Feb 28 in Chicago.
    const early = habit({ readyFromUts: Date.UTC(2027, 2, 1, 3) / 1000 });
    expect(pendingHabitsSentence([early], Date.UTC(2026, 5, 1), "America/Chicago")).toContain("(from February 2027,");
    expect(pendingHabitsSentence([early], Date.UTC(2026, 5, 1), "UTC")).toContain("(from March 2027,");
  });

  it("says '1 more song', never '1 more songs'", () => {
    const text = pendingHabitsSentence([habit({ countedPlays: 499 })], Date.UTC(2027, 6, 1), "UTC")!;
    expect(text).toContain("(needs 1 more song)");
  });

  it("lists several habits as one sentence", () => {
    const text = pendingHabitsSentence(
      [habit({}), habit({ habit: "first-listens" }), habit({ habit: "reunions", readyFromUts: utc(2027, 9, 1) })],
      Date.UTC(2026, 5, 1),
      "UTC",
    )!;
    expect(text).toMatch(/^A few habits need more history before they mean anything: /);
    expect(text).toContain(", and whether you go back to artists after long breaks (from September 2027,");
    expect(text).not.toMatch(JARGON);
  });
});

describe("sweepNoHitsSentence", () => {
  it("only calls the sky powerless when every trial could be judged", () => {
    expect(sweepNoHitsSentence({ judged: 25, waiting: 0, total: 25 })).toMatch(/^All 25 trials came back clean/);
  });

  it("doesn't call skipped trials clean", () => {
    const text = sweepNoHitsSentence({ judged: 6, waiting: 19, total: 25 });
    expect(text).not.toMatch(/All 25|no hold on you|clean/);
    expect(text).toBe(
      "Nothing turned up in the 6 trials Retrospect could judge. The other 19 need more of your history first, so this isn't the last word.",
    );
  });

  it("says so plainly when nothing could be judged", () => {
    expect(sweepNoHitsSentence({ judged: 0, waiting: 25, total: 25 })).toBe(
      "None of these 25 trials can be judged on your history yet. They need more of your listening first.",
    );
  });

  it("doesn't blame history length for trials that failed on an old history", () => {
    const text = sweepNoHitsSentence({ judged: 22, waiting: 0, total: 25 });
    expect(text).not.toMatch(/history first|clean/);
    expect(text).toBe(
      "Nothing turned up in the 22 trials Retrospect could judge. The other 3 couldn't be tested this time, so this isn't the last word.",
    );
  });

  it("names both reasons when there are both", () => {
    expect(sweepNoHitsSentence({ judged: 6, waiting: 16, total: 25 })).toBe(
      "Nothing turned up in the 6 trials Retrospect could judge. Of the other 19, 16 need more of your history first and 3 couldn't be tested this time, so this isn't the last word.",
    );
    expect(sweepNoHitsSentence({ judged: 0, waiting: 1, total: 25 })).toBe(
      "None of these 25 trials could be judged: 1 needs more of your history first and 24 couldn't be tested this time.",
    );
  });
});
