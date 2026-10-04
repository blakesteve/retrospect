import { describe, expect, it } from "vitest";
import { planetSheetRef, planetSheetValue } from "./planetSheet";

/* The planet sheet's URL value (spec 8.7.4): the planet tonight, or on the
   past night the Sky view's dial stands at. */

const TODAY = "2026-10-04";

describe("reading a planet sheet's value", () => {
  it("takes a planet alone as tonight", () => {
    expect(planetSheetValue("venus", TODAY)).toEqual({ body: "venus", night: null });
    expect(planetSheetValue("moon", TODAY)).toEqual({ body: "moon", night: null });
  });
  it("takes a planet on a past night, and on tonight's date", () => {
    expect(planetSheetValue("venus-2024-05-10", TODAY)).toEqual({ body: "venus", night: "2024-05-10" });
    expect(planetSheetValue("saturn-2026-10-04", TODAY)).toEqual({ body: "saturn", night: "2026-10-04" });
  });
  it.each([
    "pluto",
    "Venus",
    "venus-",
    "venus-2024-5-10",
    "venus-2024-02-30",
    "venus-2024-13-01",
    "venus-2024-01-32",
    "venus-2024-00-10",
    "venus-2026-10-05",
    "venus-2024-05-10-x",
    "-2024-05-10",
    "",
  ])(
    "refuses %j",
    (v) => {
      expect(planetSheetValue(v, TODAY)).toBeNull();
    },
  );
});

describe("writing one", () => {
  it("names the night when the dial stands on a past one", () => {
    expect(planetSheetRef("Venus", "2024-05-10", TODAY)).toBe("venus-2024-05-10");
  });
  it("leaves it out at tonight, so the sheet says tonight", () => {
    expect(planetSheetRef("Venus", TODAY, TODAY)).toBe("venus");
    expect(planetSheetRef("Venus", null, TODAY)).toBe("venus");
  });
});
