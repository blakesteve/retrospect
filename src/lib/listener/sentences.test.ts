import { describe, expect, it } from "vitest";
import { BODIES, type SkyAt, type SkyBody, type Sign } from "@/lib/sky/sky";
import { kickerDate, lengthWords, longNightDate, skyLine, strangestLine, wildCardLine, wildLine } from "./sentences";

const at = (iso: string) => Date.parse(iso) / 1000;
function sky(signs: Partial<Record<SkyBody, Sign>>, conditions: SkyAt["conditions"] = []): SkyAt {
  return {
    at: "",
    bodies: BODIES.map((body) => ({
      body,
      longitude: 0,
      sign: signs[body] ?? "Gemini",
      degree: 0,
      minute: 0,
      dignity: "neutral",
      dignityPhrase: "",
      retrograde: false,
    })),
    moon: { phaseAngle: 0, illumination: 0, sign: signs.Moon ?? "Gemini" },
    aspects: [],
    conditions,
  };
}

describe("the reveal's sentences (spec 8.3)", () => {
  it("says how long the history is", () => {
    expect(lengthWords(at("2023-09-28T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("Three years");
    expect(lengthWords(at("2026-04-01T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("Five months");
    expect(lengthWords(at("2014-01-01T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("Twelve years");
    expect(lengthWords(at("2026-08-15T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("A few weeks");
    expect(lengthWords(at("2024-10-15T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("Twenty-three months");
    expect(lengthWords(at("2002-03-01T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("Twenty-four years");
    // Never rounded up (architect, 2 Oct 2026): ten years and nine months is ten years.
    expect(lengthWords(at("2016-01-01T00:00:00Z"), at("2026-09-30T00:00:00Z"))).toBe("Ten years");
    expect(lengthWords(at("2024-10-15T12:00:00Z"), at("2026-10-15T11:59:00Z"))).toBe("Twenty-three months");
  });

  it("writes the wildest night's line as the spec does", () => {
    // 8.3, changed 2 Oct 2026: "that night", and the song with its artist.
    expect(wildLine("The strongest geomagnetic storm in about 20 years", 39, "Friday", 46, "Good Luck, Babe! by Chappell Roan")).toBe(
      "The strongest geomagnetic storm in about 20 years. You played 39 songs that night (a usual Friday is 46) and first heard Good Luck, Babe! by Chappell Roan.",
    );
    expect(wildLine("A G4 storm, Kp 8+", 1, "Tuesday", null, null)).toBe("A G4 storm, Kp 8+. You played 1 song that night.");
    // A title that is a whole sentence already, and a song that ends one.
    expect(wildLine("A blood moon.", 2, "Friday", 3, "Help!")).toBe("A blood moon. You played 2 songs that night (a usual Friday is 3) and first heard Help!");
  });

  it("dates the wildest night in full, for the card's eyebrow (8.3)", () => {
    // Night 19,853 is May 10, 2024, a Friday; 20,724 is Sept 28, 2026, a Monday.
    expect(longNightDate(19_853)).toBe("Friday, May 10, 2024");
    expect(longNightDate(20_724)).toBe("Monday, Sept 28, 2026");
  });

  it("names Venus, Mars and the Moon in 9.3's words", () => {
    expect(skyLine(sky({ Venus: "Scorpio", Mars: "Cancer" }, ["newmoon"]))).toBe(
      "Venus was in her detriment, Mars in his fall, and the Moon was new.",
    );
    expect(skyLine(sky({ Moon: "Taurus" }))).toBe("The Moon was exalted.");
    expect(skyLine(sky({ Venus: "Libra", Mars: "Aries" }))).toBe("Venus was at home and Mars at home.");
    expect(skyLine(sky({}))).toBeNull();
  });

  it("doesn't say a chip twice when the sky line already does", () => {
    const pair = { kind: "pair" as const, bodies: [{ body: "Venus" as const, dignity: "home" as const }, { body: "Mars" as const, dignity: "home" as const }] };
    expect(strangestLine("7:18 a.m. CDT", "Oct 3, 2024", "with Venus and Mars both at home", sky({ Venus: "Taurus", Mars: "Aries" }), pair)).toBe(
      "First played at 7:18 a.m. CDT, Oct 3, 2024. Venus was at home and Mars at home.",
    );
    const moon = { kind: "moon" as const, phase: "new" as const };
    expect(strangestLine("7:18 a.m. CDT", "Oct 3, 2024", "in a new moon window", sky({}, ["newmoon"]), moon)).toBe(
      "First played at 7:18 a.m. CDT, Oct 3, 2024. The Moon was new.",
    );
    // Mercury at home isn't in the sky line: the chip's clause stays.
    const home = { kind: "home" as const, body: "Mercury" as const };
    expect(strangestLine("7:18 a.m. CDT", "Oct 3, 2024", "with Mercury at home", sky({ Venus: "Scorpio" }), home)).toBe(
      "First played at 7:18 a.m. CDT, Oct 3, 2024, with Mercury at home. Venus was in her detriment.",
    );
  });

  it("writes the strangest sky's line", () => {
    expect(strangestLine("7:18 a.m. CDT", "Oct 3, 2024", "the minute an X9.0 flare peaked", sky({ Venus: "Scorpio", Mars: "Cancer" }, ["newmoon"]))).toBe(
      "First played at 7:18 a.m. CDT, Oct 3, 2024, the minute an X9.0 flare peaked. Venus was in her detriment, Mars in his fall, and the Moon was new.",
    );
  });
});

describe("a wild night card's words (spec 8.4)", () => {
  it("writes the line as the spec does, in the singular, with separators, and with no usual", () => {
    expect(wildCardLine(39, "Friday", 50)).toBe("39 songs · a usual Friday is 50");
    expect(wildCardLine(1, "Tuesday", 12)).toBe("1 song · a usual Tuesday is 12");
    expect(wildCardLine(1_204, "Saturday", 1_050)).toBe("1,204 songs · a usual Saturday is 1,050");
    expect(wildCardLine(39, "Friday", null)).toBe("39 songs");
    expect(wildCardLine(1, "Friday", null)).toBe("1 song");
  });

  it("dates the card's kicker, with Sept for September", () => {
    const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
    expect(kickerDate(night("2024-05-10"))).toBe("Fri, May 10, 2024");
    expect(kickerDate(night("2024-09-22"))).toBe("Sun, Sept 22, 2024");
    expect(kickerDate(night("2025-03-13"))).toBe("Thu, Mar 13, 2025");
  });
});
