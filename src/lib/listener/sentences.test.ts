import { describe, expect, it } from "vitest";
import { BODIES, type SkyAt, type SkyBody, type Sign } from "@/lib/sky/sky";
import { lengthWords, skyLine, strangestLine, wildLine } from "./sentences";

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
  });

  it("writes the wildest night's line as the spec does", () => {
    expect(wildLine("The strongest geomagnetic storm in about 20 years", 39, "Friday", 50, "Good Luck, Babe!")).toBe(
      "The strongest geomagnetic storm in about 20 years. You played 39 songs (a usual Friday is 50) and first heard Good Luck, Babe!",
    );
    expect(wildLine("A G4 storm, Kp 8+", 1, "Tuesday", null, null)).toBe("A G4 storm, Kp 8+. You played 1 song.");
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
