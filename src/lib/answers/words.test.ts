import { describe, expect, it } from "vitest";
import { answerWords, benjaminiHochberg, likelihoodFor } from "./words";

/* Spec 6.3's whole p vectors and the words it gives for them, as literals.
   The architect checked each against the rule before the brief was written. */

const words = (ps: number[]) => answerWords(ps).words;

describe("the answer word, from whole p vectors (spec 6.3)", () => {
  const rest = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

  it("m 10, p 0.004 first: a Yes", () => {
    expect(words([0.004, ...rest])[0]).toBe("Yes");
  });

  it("m 10, p 0.03 first: a Maybe, since 0.03 is over 0.01", () => {
    expect(words([0.03, ...rest])[0]).toBe("Maybe");
  });

  it("m 10, four at 0.03: all four Yes (k is 4, and 0.03 is under 0.04)", () => {
    expect(words([0.03, 0.03, 0.03, 0.03, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]).slice(0, 4)).toEqual([
      "Yes",
      "Yes",
      "Yes",
      "Yes",
    ]);
  });

  it("m 1, p 0.08: a Maybe (passes the correction, fails p under 0.05)", () => {
    expect(words([0.08])).toEqual(["Maybe"]);
  });

  it("m 2, p 0.03 and 0.08: Yes, then Maybe", () => {
    expect(words([0.03, 0.08])).toEqual(["Yes", "Maybe"]);
  });

  it("m 10, p 0.086 to 0.99: Maybe, Not clearly, No, and No for the rest", () => {
    expect(words([0.086, 0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99])).toEqual([
      "Maybe",
      "Not clearly",
      "No",
      "No",
      "No",
      "No",
      "No",
      "No",
      "No",
      "No",
    ]);
  });

  it("passes a p exactly at 0.10 x k / m: the rule is 'at most' (6.3)", () => {
    // m 10, four at 0.04: k is 4 because 0.04 <= 0.10 x 4 / 10, so all four pass.
    expect(words([0.04, 0.04, 0.04, 0.04, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]).slice(0, 4)).toEqual([
      "Yes",
      "Yes",
      "Yes",
      "Yes",
    ]);
  });

  it("draws each word's line where the spec does", () => {
    // Alone (m 1), so the correction passes anything under 0.10.
    expect(words([0.0499])).toEqual(["Yes"]);
    expect(words([0.05])).toEqual(["Maybe"]);
    expect(words([0.0999])).toEqual(["Maybe"]);
    expect(words([0.1])).toEqual(["Not clearly"]);
    expect(words([0.3499])).toEqual(["Not clearly"]);
    expect(words([0.35])).toEqual(["No"]);
  });

  it("leaves untested questions out of m, and gives them no word", () => {
    const r = answerWords([0.004, null, 0.2, null]);
    expect(r.m).toBe(2);
    expect(r.words).toEqual(["Yes", null, "Not clearly", null]);
  });
});

describe("Benjamini-Hochberg's adjusted p", () => {
  it("is the smallest m x p(j) / j over j >= i, capped at 1", () => {
    // m 4: 0.01 -> min(0.04, 0.06, 0.0533, 0.08) = 0.04; 0.03 -> 0.06 then
    // min with 0.0533 = 0.0533; 0.04 -> 0.0533; 0.08 -> 0.08.
    const { adjusted, passed } = benjaminiHochberg([0.04, 0.01, 0.08, 0.03]);
    expect(adjusted.map((x) => Math.round(x * 10000) / 10000)).toEqual([0.0533, 0.04, 0.08, 0.0533]);
    expect(passed).toEqual([true, true, true, true]);
    expect(benjaminiHochberg([0.9, 0.95]).adjusted).toEqual([0.95, 0.95]);
    expect(benjaminiHochberg([2]).adjusted).toEqual([1]);
  });
});

describe("the likelihood phrase follows p alone (9.1)", () => {
  it("has four bands", () => {
    expect(likelihoodFor(0.009)).toBe("Very unlikely to be chance.");
    expect(likelihoodFor(0.01)).toBe("Unlikely to be chance.");
    expect(likelihoodFor(0.049)).toBe("Unlikely to be chance.");
    expect(likelihoodFor(0.05)).toBe("Could be chance.");
    expect(likelihoodFor(0.349)).toBe("Could be chance.");
    expect(likelihoodFor(0.35)).toBe("Could easily be chance.");
  });
});
