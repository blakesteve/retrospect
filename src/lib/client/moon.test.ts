import { describe, expect, it } from "vitest";
import { moonLit, phaseName } from "./moon";

describe("the Moon from its phase angle (8.9)", () => {
  it("names the phase", () => {
    expect(phaseName(0)).toBe("New moon");
    expect(phaseName(11.9)).toBe("New moon");
    expect(phaseName(12)).toBe("Waxing crescent");
    expect(phaseName(90)).toBe("First quarter");
    expect(phaseName(180)).toBe("Full moon");
    expect(phaseName(270)).toBe("Last quarter");
    expect(phaseName(300)).toBe("Waning crescent");
    expect(phaseName(350)).toBe("New moon");
    expect(phaseName(-10)).toBe("New moon");
    expect(phaseName(370)).toBe("New moon");
  });

  it("lights the right side waxing and the left waning, as the big drawing always has", () => {
    expect(moonLit(180, 10, 8)).toBe("full");
    expect(moonLit(0, 10, 8)).toBe("none");
    expect(moonLit(90, 22, 20)).toBe("M22 2A20 20 0 0 1 22 42A0.00 20 0 0 0 22 2Z");
    expect(moonLit(270, 22, 20)).toBe("M22 2A20 20 0 0 0 22 42A0.00 20 0 0 0 22 2Z");
    expect(moonLit(45, 22, 20)).toBe("M22 2A20 20 0 0 1 22 42A14.14 20 0 0 0 22 2Z");
    expect(moonLit(135, 22, 20)).toBe("M22 2A20 20 0 0 1 22 42A14.14 20 0 0 1 22 2Z");
    expect(moonLit(315, 10, 8)).toBe("M10 2A8 8 0 0 0 10 18A5.66 8 0 0 1 10 2Z");
  });
});
