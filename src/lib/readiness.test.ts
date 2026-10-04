import { describe, expect, it } from "vitest";
import { pendingHabitsSentence, type PendingHabit } from "./readiness";

/* What a young history's habits row is told instead of an error screen.
   Plain English, a real date, never a promise of a date that has already
   passed, and never a promise of an answer: only of when plays start counting. */

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

/** Words a casual reader shouldn't need to know. */
const JARGON = /\b(p ?[<=]|p-value|index|significan|statistic|permutation|null|sample|threshold|warm-?up)\b/i;

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
