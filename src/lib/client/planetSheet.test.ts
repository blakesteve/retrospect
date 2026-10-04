import { describe, expect, it } from "vitest";
import { aboutTheListener, planetSheetRef, planetSheetValue, SKY_FIRST_NIGHT, SKY_LAST_NIGHT } from "./planetSheet";
import { SKY_RANGE } from "@/lib/sky/windows";

/* The planet sheet's URL value (spec 8.7.4): the planet tonight, or on any
   night inside the sky data, on every view; outside it, refused (8.7). */

const TODAY = "2026-10-04";

describe("reading a planet sheet's value", () => {
  it("takes a planet alone as tonight", () => {
    expect(planetSheetValue("venus")).toEqual({ body: "venus", night: null });
    expect(planetSheetValue("moon")).toEqual({ body: "moon", night: null });
  });

  it("takes any night inside the sky data, 2002 through 2035, past or to come", () => {
    expect(planetSheetValue("venus-2024-05-10")).toEqual({ body: "venus", night: "2024-05-10" });
    expect(planetSheetValue("saturn-2002-01-01")).toEqual({ body: "saturn", night: "2002-01-01" });
    expect(planetSheetValue("mars-2035-12-31")).toEqual({ body: "mars", night: "2035-12-31" });
    expect(planetSheetValue("venus-2030-06-15")).toEqual({ body: "venus", night: "2030-06-15" });
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
    "venus-2001-12-31",
    "venus-2036-01-01",
    "venus-1999-06-15",
    "venus-2024-05-10-x",
    "-2024-05-10",
    "",
  ])("refuses %j", (v) => {
    expect(planetSheetValue(v)).toBeNull();
  });

  it("knows the sky data's ends as the server does", () => {
    // SKY_RANGE's end is exclusive: its last night is the day before.
    expect(SKY_FIRST_NIGHT).toBe(new Date(SKY_RANGE.from).toISOString().slice(0, 10));
    expect(SKY_LAST_NIGHT).toBe(new Date(SKY_RANGE.to - 1).toISOString().slice(0, 10));
  });
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

describe("lines about the listener on a planet's sheet", () => {
  const FIRST = "2023-09-28";
  it("appear tonight, and on a night from the history's first to tonight", () => {
    expect(aboutTheListener(null, FIRST, TODAY)).toBe(true);
    expect(aboutTheListener(FIRST, FIRST, TODAY)).toBe(true);
    expect(aboutTheListener("2024-05-10", FIRST, TODAY)).toBe(true);
    expect(aboutTheListener(TODAY, FIRST, TODAY)).toBe(true);
  });
  it("don't appear outside it, before the first night or after tonight", () => {
    expect(aboutTheListener("2023-09-27", FIRST, TODAY)).toBe(false);
    expect(aboutTheListener("2010-06-15", FIRST, TODAY)).toBe(false);
    expect(aboutTheListener("2026-10-05", FIRST, TODAY)).toBe(false);
  });
  it("don't appear on a dated sheet while the history's start isn't known", () => {
    expect(aboutTheListener("2024-05-10", null, TODAY)).toBe(false);
    expect(aboutTheListener(null, null, TODAY)).toBe(true);
  });
});
