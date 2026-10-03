import { describe, expect, it } from "vitest";
import { FIRST_DATES } from "@/lib/space/sources";
import {
  COVERAGE,
  GENRE_FACTS,
  collapse,
  dockLines,
  doorName,
  monthShort,
  monthTitle,
  monthWeeks,
  monthsNewestFirst,
  pickMonth,
  playsLevel,
  stepNight,
  stepPast,
  type DoorFacts,
} from "./nights";

describe("Every night's months (8.5 item 3)", () => {
  it("runs newest first, from tonight's month back to the history's first", () => {
    const months = monthsNewestFirst("2023-09", "2026-10");
    expect(months).toHaveLength(38);
    expect(months.slice(0, 3)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(months.slice(-3)).toEqual(["2023-11", "2023-10", "2023-09"]);
    expect(months.slice(months.indexOf("2024-02"), months.indexOf("2024-02") + 3)).toEqual(["2024-02", "2024-01", "2023-12"]);
    expect(monthsNewestFirst("2026-10", "2026-10")).toEqual(["2026-10"]);
  });

  it("names a month in full, and short for the year strip", () => {
    expect(monthTitle("2024-05")).toBe("May 2024");
    expect(monthTitle("2023-09")).toBe("September 2023");
    expect(monthShort("2023-09")).toBe("Sept 2023");
    expect(monthShort("2026-10")).toBe("Oct 2026");
  });

  it("lays a month out in weeks of 7, Sunday first", () => {
    // May 1, 2024 was a Wednesday.
    const may = monthWeeks("2024-05");
    expect(may).toHaveLength(5);
    expect(may[0]).toEqual([null, null, null, "2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04"]);
    expect(may[4]).toEqual(["2024-05-26", "2024-05-27", "2024-05-28", "2024-05-29", "2024-05-30", "2024-05-31", null]);
    // Feb 1, 2026 is a Sunday: four rows exactly. Mar 2025 starts on a Saturday: six.
    expect(monthWeeks("2026-02")).toHaveLength(4);
    expect(monthWeeks("2025-03")).toHaveLength(6);
    expect(monthWeeks("2025-03")[0]).toEqual([null, null, null, null, null, null, "2025-03-01"]);
  });
});

describe("the doors by keyboard (11)", () => {
  const FIRST = "2023-09-28";
  const TONIGHT = "2026-10-03";
  const step = (date: string, key: string) => stepNight(date, key, FIRST, TONIGHT);

  it("moves in time: a night, a week, a month, the week's ends", () => {
    // May 10, 2024 was a Friday.
    expect(step("2024-05-10", "ArrowRight")).toBe("2024-05-11");
    expect(step("2024-05-10", "ArrowLeft")).toBe("2024-05-09");
    expect(step("2024-05-10", "ArrowDown")).toBe("2024-05-17");
    expect(step("2024-05-10", "ArrowUp")).toBe("2024-05-03");
    expect(step("2024-05-10", "PageDown")).toBe("2024-06-10");
    expect(step("2024-05-10", "PageUp")).toBe("2024-04-10");
    expect(step("2024-05-10", "Home")).toBe("2024-05-05");
    expect(step("2024-05-10", "End")).toBe("2024-05-11");
  });

  it("crosses months and years, and keeps a month's last day", () => {
    expect(step("2024-05-31", "ArrowRight")).toBe("2024-06-01");
    expect(step("2025-01-02", "ArrowUp")).toBe("2024-12-26");
    expect(step("2024-01-31", "PageDown")).toBe("2024-02-29");
    expect(step("2024-03-31", "PageUp")).toBe("2024-02-29");
  });

  it("stops at the history's first night and at tonight", () => {
    expect(step("2023-09-30", "ArrowUp")).toBe("2023-09-28");
    expect(step("2023-09-28", "ArrowLeft")).toBe("2023-09-28");
    expect(step("2026-10-03", "ArrowRight")).toBe("2026-10-03");
    expect(step("2026-09-20", "PageDown")).toBe("2026-10-03");
  });

  it("passes nights that can't be doors, keeping the day on Page keys", () => {
    // February to November 2023... folded: a filter lit nothing there.
    const folded = (d: string) => ["2024-02", "2024-01", "2023-12", "2023-11"].includes(d.slice(0, 7));
    const past = (date: string, key: string) => stepPast(date, key, FIRST, TONIGHT, folded);
    expect(past("2024-03-30", "PageUp")).toBe("2023-10-30");
    expect(past("2023-10-30", "PageDown")).toBe("2024-03-30");
    expect(past("2024-03-31", "PageUp")).toBe("2023-10-31");
    expect(past("2024-03-01", "ArrowLeft")).toBe("2023-10-31");
    expect(past("2024-03-03", "ArrowUp")).toBe("2023-10-29");
    expect(past("2023-10-31", "ArrowRight")).toBe("2024-03-01");
    // Nothing that way can be a door: null, and focus stays.
    const tail = (d: string) => d > "2024-04-30";
    expect(stepPast("2024-04-30", "PageDown", FIRST, TONIGHT, tail)).toBeNull();
    expect(stepPast("2024-04-30", "ArrowRight", FIRST, TONIGHT, tail)).toBeNull();
    const head = (d: string) => d < "2023-10-01";
    expect(stepPast("2023-10-01", "ArrowLeft", FIRST, TONIGHT, head)).toBeNull();
    expect(stepPast("2023-10-15", "PageUp", FIRST, TONIGHT, head)).toBeNull();
    // Nothing folded: the plain step.
    expect(stepPast("2024-05-10", "PageUp", FIRST, TONIGHT, () => false)).toBe("2024-04-10");
    expect(stepPast("2024-05-10", "Enter", FIRST, TONIGHT, () => false)).toBeNull();
  });

  it("ignores every other key", () => {
    expect(step("2024-05-10", "Enter")).toBeNull();
    expect(step("2024-05-10", "Tab")).toBeNull();
    expect(step("2024-05-10", "a")).toBeNull();
  });
});

describe("a door's fill (8.5 item 4)", () => {
  it("brightens with plays against the weekday's usual", () => {
    expect(playsLevel(0, 46)).toBe(0);
    expect(playsLevel(22, 46)).toBe(1);
    expect(playsLevel(23, 46)).toBe(2);
    expect(playsLevel(45, 46)).toBe(2);
    expect(playsLevel(46, 46)).toBe(3);
    expect(playsLevel(68, 46)).toBe(3);
    expect(playsLevel(69, 46)).toBe(4);
    expect(playsLevel(5, null)).toBe(2);
  });
});

describe("a door's name (11)", () => {
  const may10: DoorFacts = {
    date: "2024-05-10",
    plays: 39,
    usual: 46,
    tonight: false,
    moon: "Waxing crescent",
    eclipse: null,
    kp: "Kp 9",
    flare: "X5.8",
    asteroid: false,
    firstHeard: [{ track: "Good Luck, Babe!", artist: "Chappell Roan" }],
    wild: null,
    lit: false,
  };

  it("reads spec 11's example word for word", () => {
    expect(doorName(may10)).toBe(
      "Friday, May 10, 2024. 39 plays, 7 fewer than a usual Friday. Waxing crescent Moon. Solar storm, Kp 9. X5.8 flare. First heard Good Luck, Babe! by Chappell Roan.",
    );
  });

  it("says what the glow and a filter's light show", () => {
    expect(doorName({ ...may10, wild: "The strongest geomagnetic storm in about 20 years", lit: true })).toBe(
      "Friday, May 10, 2024. 39 plays, 7 fewer than a usual Friday. Waxing crescent Moon. Solar storm, Kp 9. X5.8 flare. First heard Good Luck, Babe! by Chappell Roan. A wild night: The strongest geomagnetic storm in about 20 years. Lit by the filter.",
    );
  });

  it("says no listening, and tonight's so far", () => {
    const quiet = { ...may10, date: "2024-05-11", plays: 0, kp: null, flare: null, firstHeard: [], moon: "Full moon" };
    expect(doorName(quiet)).toBe("Saturday, May 11, 2024. No listening. Full moon.");
    expect(doorName({ ...quiet, date: "2026-10-03", tonight: true, moon: "Last quarter" })).toBe(
      "Tonight, Saturday, Oct 3, 2026. No listening yet. Last quarter Moon.",
    );
    expect(doorName({ ...quiet, date: "2026-10-03", tonight: true, moon: "Last quarter", plays: 12, usual: 46 })).toBe(
      "Tonight, Saturday, Oct 3, 2026. 12 plays so far, 34 fewer than a usual Saturday. Last quarter Moon.",
    );
  });

  it("names no Moon for tonight before its night is known", () => {
    expect(doorName({ ...may10, date: "2026-10-03", tonight: true, plays: 0, moon: null, kp: null, flare: null, firstHeard: [] })).toBe(
      "Tonight, Saturday, Oct 3, 2026. No listening yet.",
    );
  });

  it("names an eclipse in place of the Moon, more plays, a usual night, and an asteroid", () => {
    expect(doorName({ ...may10, date: "2024-04-08", plays: 61, usual: 44, eclipse: "total solar", kp: null, flare: null, firstHeard: [] })).toBe(
      "Monday, Apr 8, 2024. 61 plays, 17 more than a usual Monday. Total solar eclipse.",
    );
    expect(doorName({ ...may10, plays: 46, kp: null, flare: null, firstHeard: [], asteroid: true })).toBe(
      "Friday, May 10, 2024. 46 plays, as many as a usual Friday. Waxing crescent Moon. An asteroid passed closer than the Moon.",
    );
    expect(doorName({ ...may10, plays: 1, usual: null, kp: null, flare: null, firstHeard: [] })).toBe("Friday, May 10, 2024. 1 play. Waxing crescent Moon.");
  });
});

describe("the filter dock's words (8.5 item 5, 9.2)", () => {
  const q7 = { number: 7, subject: "solar storms", word: "Yes", events: 55 };

  it("reads 8.5's example for storm nights", () => {
    expect(dockLines("storm", null, 92, q7, 63)).toEqual({
      count: "92",
      what: "storm nights you listened on",
      noun: "These make 55 stretches of storm nights for the question · NASA logged 63 solar storms in this time",
      question: "Coincidence or pattern? Question 7, on solar storms, has the answer.",
      facts: null,
    });
  });

  it("asks for more nights when the question is Too early, and says when it isn't checked", () => {
    expect(dockLines("storm", null, 92, { ...q7, word: "Too early" }, 63).question).toBe(
      "Coincidence or pattern? Question 7, on solar storms, needs more nights to say.",
    );
    expect(dockLines("storm", null, 92, { ...q7, word: "Not checked" }, 63).question).toBe(
      "Coincidence or pattern? Question 7, on solar storms, isn't checked yet.",
    );
  });

  it("counts one in the singular, and leaves out a NASA count it doesn't have", () => {
    const one = dockLines("xflare", null, 1, { number: 8, subject: "big solar flares", word: "No", events: 1 }, 1);
    expect(one.what).toBe("X-flare night you listened on");
    expect(one.noun).toBe("These make 1 stretch of X-flare nights for the question · NASA logged 1 X-class flare in this time");
    expect(dockLines("storm", null, 92, q7, null).noun).toBe("These make 55 stretches of storm nights for the question");
    expect(dockLines("storm", null, 92, q7, 0).noun).toBe("These make 55 stretches of storm nights for the question");
    expect(dockLines("storm", null, 1_204, q7, 63).count).toBe("1,204");
  });

  it("links no question for the filters no question tests", () => {
    for (const f of ["eclipse", "marshome", "asteroid", "fireball", "firstplay", "wild"] as const) {
      const d = dockLines(f, null, 4, null, null);
      expect(d.question, f).toBeNull();
      expect(d.noun, f).toBeNull();
    }
    expect(dockLines("eclipse", null, 4, null, null).what).toBe("eclipse nights you listened on");
    expect(dockLines("fullmoon", null, 30, { number: 2, subject: "a full moon", word: "No", events: 30 }, null)).toMatchObject({
      what: "full moons you listened under",
      noun: null,
      question: "Coincidence or pattern? Question 2, on a full moon, has the answer.",
    });
  });

  it("says genres aren't tested, and drops the stretches, once a genre is on", () => {
    expect(GENRE_FACTS).toBe(
      "Facts, not proof. Retrospect doesn't test genres against the sky: with a dozen genres and a dozen skies, chance alone would hand you several 'patterns'.",
    );
    expect(dockLines(null, "shoegaze", 41, null, null)).toEqual({
      count: "41",
      what: "nights with at least 3 shoegaze plays",
      noun: null,
      question: null,
      facts: GENRE_FACTS,
    });
    const both = dockLines("storm", "shoegaze", 5, q7, 63);
    expect(both.what).toBe("storm nights with at least 3 shoegaze plays");
    expect(both.noun).toBeNull();
    expect(both.question).toBe("Coincidence or pattern? Question 7, on solar storms, has the answer.");
    expect(both.facts).toBe(GENRE_FACTS);
    expect(dockLines("storm", "shoegaze", 1, q7, 63).what).toBe("storm night with at least 3 shoegaze plays");
  });
});

describe("NASA's coverage (7.3)", () => {
  it("starts where the server's sources say, in the year its line names", () => {
    expect(COVERAGE.storm).toEqual({ from: FIRST_DATES["donki-gst"].slice(0, 7), line: "NASA's storm log starts in 2010." });
    expect(COVERAGE.xflare).toEqual({ from: FIRST_DATES["donki-flr"].slice(0, 7), line: "NASA's flare log starts in 2010." });
    expect(COVERAGE.fireball).toEqual({ from: FIRST_DATES["jpl-fireball"].slice(0, 7), line: "NASA's fireball log starts in 1988." });
    for (const c of Object.values(COVERAGE)) expect(c!.line).toContain(c!.from.slice(0, 4));
  });
});

describe("months a filter folds (8.5 states)", () => {
  const months = ["2010-06", "2010-05", "2010-04", "2010-03", "2010-02", "2010-01"];

  it("says nothing for a dark month, and NASA's start once", () => {
    const lit = (m: string) => (m === "2010-05" ? 0 : 3);
    expect(Object.fromEntries(collapse(months, "storm", lit))).toEqual({
      "2010-05": "nothing",
      "2010-03": "coverage",
      "2010-02": "hidden",
      "2010-01": "hidden",
    });
  });

  it("folds nothing while a month's count isn't known, and has no start for the sky's own filters", () => {
    expect(collapse(months, "storm", () => undefined).get("2010-06")).toBeUndefined();
    expect(Object.fromEntries(collapse(months, "fullmoon", (m) => (m === "2010-01" ? 0 : 1)))).toEqual({ "2010-01": "nothing" });
    expect(Object.fromEntries(collapse(months, null, (m) => (m === "2010-02" ? 0 : 1)))).toEqual({ "2010-02": "nothing" });
  });
});

describe("a random lit door (8.5 item 5)", () => {
  it("picks a month by its share of the lit nights", () => {
    const counts = { "2024-09": 2, "2024-03": 0, "2024-05": 6 };
    expect(pickMonth(counts, 0)).toBe("2024-05");
    expect(pickMonth(counts, 0.74)).toBe("2024-05");
    expect(pickMonth(counts, 0.76)).toBe("2024-09");
    expect(pickMonth(counts, 0.999)).toBe("2024-09");
    expect(pickMonth({ "2024-03": 0 }, 0.5)).toBeNull();
    expect(pickMonth({}, 0.5)).toBeNull();
  });
});
