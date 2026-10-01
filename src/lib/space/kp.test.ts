import { describe, expect, it } from "vitest";
import { kpCells, kpLabel, stormGrade } from "./kp";

/* NOAA's thirds and grades (spec 7.3), as literals: DONKI's 5.67 is "Kp 6-"
   and a G2, not "Kp 5.67" or a G1. */
describe("Kp as NOAA writes it", () => {
  it("names each third", () => {
    expect(kpLabel(4.67)).toBe("Kp 5-");
    expect(kpLabel(5)).toBe("Kp 5");
    expect(kpLabel(5.33)).toBe("Kp 5+");
    expect(kpLabel(5.67)).toBe("Kp 6-");
    expect(kpLabel(6)).toBe("Kp 6");
    expect(kpLabel(6.33)).toBe("Kp 6+");
    expect(kpLabel(8.67)).toBe("Kp 9-");
    expect(kpLabel(9)).toBe("Kp 9");
    // DONKI's thirds come as 5.666... as well as 5.67.
    expect(kpLabel(17 / 3)).toBe("Kp 6-");
    expect(kpLabel(19 / 3)).toBe("Kp 6+");
  });

  it("grades storms G1 to G5, with 9- still a G4", () => {
    const grades = [4.33, 4.67, 5, 5.33, 5.67, 6, 6.33, 6.67, 7, 7.33, 7.67, 8, 8.33, 8.67, 9].map((kp) => [
      kpLabel(kp),
      stormGrade(kp),
    ]);
    expect(grades).toEqual([
      ["Kp 4+", null],
      ["Kp 5-", "G1"],
      ["Kp 5", "G1"],
      ["Kp 5+", "G1"],
      ["Kp 6-", "G2"],
      ["Kp 6", "G2"],
      ["Kp 6+", "G2"],
      ["Kp 7-", "G3"],
      ["Kp 7", "G3"],
      ["Kp 7+", "G3"],
      ["Kp 8-", "G4"],
      ["Kp 8", "G4"],
      ["Kp 8+", "G4"],
      ["Kp 9-", "G4"],
      ["Kp 9", "G5"],
    ]);
  });

  it("lights as many meter cells as the number: 6- lights six", () => {
    expect([4.67, 5.67, 6, 6.33, 8.67, 9].map(kpCells)).toEqual([5, 6, 6, 6, 9, 9]);
  });
});
