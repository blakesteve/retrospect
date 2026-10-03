import { describe, expect, it } from "vitest";
import { likelihoodFor } from "@/lib/answers/words";
import { FLUKE_CAPTION, FLUKE_LABELS, flukeFill } from "./fluke";

/* Spec 8.9: one notch for "Could easily be chance", two for "Could be
   chance", three for "Unlikely to be chance", four for "Very unlikely to be
   chance". Read through the server's own phrases, so a reworded phrase
   can't leave the meter empty without this failing. */

describe("the fluke meter fills from the left up to its phrase", () => {
  it("fills one to four notches, weakest evidence first", () => {
    expect(flukeFill(likelihoodFor(0.5))).toBe(1);
    expect(flukeFill(likelihoodFor(0.2))).toBe(2);
    expect(flukeFill(likelihoodFor(0.02))).toBe(3);
    expect(flukeFill(likelihoodFor(0.005))).toBe(4);
  });
  it("fills nothing for a phrase it doesn't know", () => {
    expect(flukeFill("Maybe.")).toBe(0);
  });
  it("labels its notches weakest first, left to right, each with what it's about", () => {
    expect(FLUKE_LABELS).toEqual(["Could easily be chance", "Could be chance", "Unlikely to be chance", "Very unlikely to be chance"]);
    // Each label is its phrase whole, so the lit label reads the phrase the answer gave (8.7.3 item 3).
    expect(FLUKE_LABELS.map((l) => `${l}.`)).toEqual([likelihoodFor(0.5), likelihoodFor(0.2), likelihoodFor(0.02), likelihoodFor(0.005)]);
  });
  it("says what it answers before its notches do", () => {
    expect(FLUKE_CAPTION).toBe("Could it be chance? The fuller the bar, the less it looks like chance.");
  });
});
