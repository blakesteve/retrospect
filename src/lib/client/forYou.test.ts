import { describe, expect, it } from "vitest";
import { forYouRows, namesMoonSign, type ForYouFact, type ForYouInput } from "./forYou";

/* Spec 8.4 item 3. Each expectation is written out from the spec's rules, not
   computed by the module. */

const base: ForYouInput = { held: [], skyLines: {}, noneOverhead: null, skyFacts: [], headsUp: null };
const fact = (body: string, kind: ForYouFact["kind"] = "station", line = `${body} turns`): ForYouFact => ({ body, planet: body.toLowerCase(), kind, line });
const shape = (rows: ReturnType<typeof forYouRows>) =>
  rows.map((r) => (r.kind === "fact" ? `fact:${r.fact.body}` : r.kind === "none" ? `none:${r.next?.id ?? "-"}` : `${r.kind}:${r.id}`));

describe("Tonight, for you (8.4)", () => {
  it("lists at most three questions overhead, rarest first", () => {
    const rows = forYouRows({ ...base, held: ["moonstrong", "venusdet", "mercury", "storms"], skyLines: { venusdet: "Venus is in Scorpio, in her detriment" } });
    expect(shape(rows)).toEqual(["held:mercury", "held:venusdet", "held:storms"]);
    expect(rows[1]).toMatchObject({ skyLine: "Venus is in Scorpio, in her detriment", bodies: ["Venus"] });
  });

  it("puts retrogrades first, then Venus and Mars, then storms and flares, then the Moon", () => {
    expect(shape(forYouRows({ ...base, held: ["fullmoon", "flares", "venushome", "marsrx"] }))).toEqual(["held:marsrx", "held:venushome", "held:flares"]);
  });

  it("shows the heads-up after the questions overhead, so there can be four rows", () => {
    const rows = forYouRows({
      ...base,
      held: ["venusdet", "moonstrong", "storms"],
      headsUp: { id: "venusrx", skyLine: "Venus turns retrograde tomorrow", line: "It'll be your first." },
      skyFacts: [fact("Jupiter")],
    });
    expect(shape(rows)).toEqual(["held:venusdet", "held:storms", "held:moonstrong", "headsUp:venusrx"]);
  });

  it("fills to three rows with sky facts, skipping a body a row above already names", () => {
    const rows = forYouRows({
      ...base,
      held: ["venusdet"],
      headsUp: { id: "venusrx", skyLine: "Venus turns retrograde tomorrow", line: "x" },
      skyFacts: [fact("Venus"), fact("Jupiter"), fact("Mars", "sign")],
    });
    expect(shape(rows)).toEqual(["held:venusdet", "headsUp:venusrx", "fact:Jupiter"]);
  });

  it("never shows two facts about the same body", () => {
    const rows = forYouRows({ ...base, held: ["mercury"], skyFacts: [fact("Jupiter"), fact("Jupiter", "sign"), fact("Moon", "moon")] });
    expect(shape(rows)).toEqual(["held:mercury", "fact:Jupiter", "fact:Moon"]);
  });

  it("names nothing overhead in one row, then the heads-up and a fact", () => {
    const rows = forYouRows({
      ...base,
      noneOverhead: { line: "None of the 12 questions' skies is overhead tonight.", next: { id: "fullmoon", line: "Next: a full moon begins Sunday." } },
      headsUp: { id: "mercury", skyLine: "Mercury turns retrograde Friday", line: "x" },
      skyFacts: [fact("Mercury"), fact("Saturn")],
    });
    expect(shape(rows)).toEqual(["none:fullmoon", "headsUp:mercury", "fact:Saturn"]);
  });

  it("leaves the none row's next start off when the heads-up names the same one", () => {
    const rows = forYouRows({
      ...base,
      noneOverhead: { line: "None of the 12 questions' skies is overhead tonight.", next: { id: "venusrx", line: "Next: Venus retrograde begins tomorrow." } },
      headsUp: { id: "venusrx", skyLine: "Venus turns retrograde tomorrow", line: "x" },
    });
    expect(shape(rows)).toEqual(["none:-", "headsUp:venusrx"]);
  });

  it("shows no none row while a question is overhead", () => {
    const rows = forYouRows({ ...base, held: ["fullmoon"], noneOverhead: { line: "None…", next: null } });
    expect(shape(rows)).toEqual(["held:fullmoon"]);
  });

  it("fills with facts while the answers (and so the heads-up) are still on their way", () => {
    expect(shape(forYouRows({ ...base, held: ["venusdet"], headsUp: undefined, skyFacts: [fact("Jupiter"), fact("Mars")] }))).toEqual([
      "held:venusdet",
      "fact:Jupiter",
      "fact:Mars",
    ]);
  });

  it("highlights both planets on the Venus and Mars row, and the Sun on a storm row", () => {
    const rows = forYouRows({ ...base, held: ["venusmars", "storms"] });
    expect(rows.map((r) => r.bodies)).toEqual([["Venus", "Mars"], ["Sun"]]);
  });
});

describe("the Moon's row leaves off her sign when a row above names it (8.4 item 4)", () => {
  it("does for a strong Moon overhead", () => {
    expect(namesMoonSign(forYouRows({ ...base, held: ["moonstrong"] }))).toBe(true);
  });
  it("does for her sign change as a fact", () => {
    expect(namesMoonSign(forYouRows({ ...base, held: ["mercury"], skyFacts: [fact("Moon", "sign")] }))).toBe(true);
  });
  it("doesn't for a full moon, overhead or as a fact, which names no sign", () => {
    expect(namesMoonSign(forYouRows({ ...base, held: ["fullmoon"] }))).toBe(false);
    const rows = forYouRows({ ...base, held: ["mercury"], skyFacts: [fact("Moon", "moon", "Full moon Saturday")] });
    expect(rows.map((r) => r.kind)).toEqual(["held", "fact"]);
    expect(namesMoonSign(rows)).toBe(false);
  });
});
