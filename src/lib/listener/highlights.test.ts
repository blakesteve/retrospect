import { describe, expect, it } from "vitest";
import { BODIES, type SkyAt, type SkyBody, type Sign } from "@/lib/sky/sky";
import { zoneClock } from "@/lib/zone";
import { byWildness, chipFor, chipText, pairingSentence, strangeness, wildNight, type FirstPlaySky, type NightEvents } from "./highlights";

const at = (iso: string) => Date.parse(iso) / 1000;
const night = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const chicago = zoneClock("America/Chicago", at("2017-01-01T00:00:00Z"), at("2025-12-31T00:00:00Z"));

/** A sky by hand: every body in a neutral sign unless given, nothing retrograde. */
function sky(signs: Partial<Record<SkyBody, Sign>> = {}, opts: { retrograde?: SkyBody[]; conditions?: SkyAt["conditions"] } = {}): SkyAt {
  const neutral: Record<SkyBody, Sign> = {
    Sun: "Gemini",
    Moon: "Gemini",
    Mercury: "Aries",
    Venus: "Gemini",
    Mars: "Gemini",
    Jupiter: "Aries",
    Saturn: "Gemini",
  };
  return {
    at: "",
    bodies: BODIES.map((body) => ({
      body,
      longitude: 0,
      sign: signs[body] ?? neutral[body],
      degree: 0,
      minute: 0,
      dignity: "neutral",
      dignityPhrase: "",
      retrograde: opts.retrograde?.includes(body) ?? false,
    })),
    moon: { phaseAngle: 0, illumination: 0, sign: signs.Moon ?? "Gemini" },
    aspects: [],
    conditions: opts.conditions ?? [],
  };
}
const quiet = (n: string, extra: Partial<NightEvents> = {}): NightEvents => ({
  night: night(n),
  plays: 10,
  eclipse: null,
  kp: null,
  xflares: [],
  asteroid: null,
  ...extra,
});

describe("wild nights (spec 7.5)", () => {
  it("ranks eclipses, then G5 and G4 storms, big flares and asteroids, with curated titles where there are any", () => {
    const wild = [
      quiet("2024-05-10", { kp: 9 }), // curated: the May 2024 storm
      quiet("2024-10-10", { kp: 8.67 }), // G4, log-phrased
      quiet("2015-03-17", { kp: 7.67 }), // G4, smaller
      quiet("2024-04-08", { eclipse: { kind: "total solar", time: at("2024-04-08T18:17:19Z") } }),
      quiet("2023-10-14", { eclipse: { kind: "annular solar", time: at("2023-10-14T17:59:26Z") } }),
      quiet("2024-10-03", { xflares: [[at("2024-10-03T12:18:00Z"), "X9.0"]] }),
      quiet("2024-05-14", { xflares: [[at("2024-05-14T16:51:00Z"), "X8.7"]] }),
      quiet("2024-06-29", { asteroid: { name: "2024 MK", time: at("2024-06-29T13:49:00Z"), ld: 0.77, meters: 141 } }),
    ]
      .map((e) => wildNight(e, chicago)!)
      .sort(byWildness);
    expect(wild.map((w) => [w.title, w.rank])).toEqual([
      ["A total solar eclipse across North America", 0],
      ["An annular eclipse across the US", 1],
      ["The strongest geomagnetic storm in about 20 years", 3],
      ["A G4 storm, Kp 9-", 4],
      ["A G4 storm, Kp 8-", 4],
      ["The largest flare of this solar cycle in NASA's log, as of September 2026", 5],
      ["An X8.7 flare", 5],
      ["A 150-meter asteroid, closer than the Moon", 6],
    ]);
    expect(wild[2].story).toBe("G5, the top of NOAA's scale. NOAA called it the strongest since the Halloween storms of 2003.");
    expect(wild[3].story).toBeNull();
  });

  it("isn't wild without a play, or for a smaller event", () => {
    expect(wildNight(quiet("2024-05-10", { kp: 9, plays: 0 }), chicago)).toBeNull();
    expect(wildNight(quiet("2024-05-01", { kp: 7.33 }), chicago)).toBeNull(); // G3
    expect(wildNight(quiet("2024-05-02", { xflares: [[at("2024-05-02T12:00:00Z"), "X4.9"]] }), chicago)).toBeNull();
    expect(
      wildNight(quiet("2024-05-03", { asteroid: { name: "small", time: at("2024-05-03T12:00:00Z"), ld: 0.5, meters: 40 } }), chicago),
    ).toBeNull();
    expect(wildNight(quiet("2024-05-04", { eclipse: { kind: "penumbral lunar", time: at("2024-05-04T12:00:00Z") } }), chicago)).toBeNull();
  });

  it("is headed by its higher-ranked event", () => {
    const both = wildNight(
      quiet("2024-10-03", { kp: 8, xflares: [[at("2024-10-03T12:18:00Z"), "X9.0"]] }),
      chicago,
    )!;
    expect([both.rank, both.title]).toEqual([4, "A G4 storm, Kp 8"]);
  });
});

describe("a song's chip (spec 7.5)", () => {
  const first = (uts: number, n: NightEvents, s: SkyAt = sky(), fireballs: number[] = []): FirstPlaySky => ({ uts, night: n, sky: s, fireballs });
  const t = at("2024-10-03T12:18:00Z");

  it("takes the first that applies, in the spec's order", () => {
    const n = quiet("2024-10-03");
    const cases: [FirstPlaySky, string | null][] = [
      [first(t, { ...n, eclipse: { kind: "total solar", time: t }, kp: 9 }), "Total solar eclipse"],
      [first(t, { ...n, kp: 9, xflares: [[t, "X9.0"]] }, sky()), "Solar storm, Kp 9"],
      [first(t, { ...n, xflares: [[t + 240, "X9.0"]] }, sky()), "X9.0 flare, that minute"],
      [first(t, { ...n, xflares: [[t - 3000, "X9.0"]] }, sky()), "X9.0 flare, within the hour"],
      [first(t, { ...n, xflares: [[t + 7 * 60, "X9.0"]] }, sky()), "X9.0 flare, within the hour"],
      [first(t, { ...n, xflares: [[t + 5 * 60, "X9.0"]] }, sky()), "X9.0 flare, that minute"],
      [first(t, { ...n, asteroid: { name: "2024 MK", time: t, ld: 0.77, meters: 141 } }, sky()), "140 m asteroid"],
      [first(t, n, sky({ Venus: "Taurus", Mars: "Aries" })), "Venus and Mars both at home"],
      [first(t, n, sky({ Venus: "Pisces", Moon: "Taurus" })), "Venus and the Moon both exalted"],
      [first(t, n, sky({ Venus: "Libra", Moon: "Taurus" })), "Venus at home, the Moon exalted"],
      [first(t, n, sky({ Mercury: "Gemini" })), "Mercury at home"],
      [first(t, n, sky({}, { conditions: ["fullmoon"] })), "Full moon"],
      [first(t, n, sky({}, { retrograde: ["Venus", "Mercury"] })), "Mercury retrograde"],
      [first(t, n, sky(), [t - 5 * 3600]), "Fireball, five hours earlier"],
      [first(t, n, sky(), [t + 2 * 3600]), "Fireball, two hours later"],
      [first(t, n, sky(), [t - 7 * 3600]), null],
      [first(t, { ...n, xflares: [[t - 3700, "X9.0"]] }, sky()), null], // over an hour
    ];
    for (const [f, text] of cases) {
      const chip = chipFor(f);
      expect(chip ? chipText(chip) : null).toBe(text);
    }
  });

  it("scores the strangest sky: 3, 3, 2, 2, then 1 each", () => {
    const n = quiet("2024-10-03");
    expect(strangeness(first(t, { ...n, eclipse: { kind: "total lunar", time: t } }, sky()))).toBe(3);
    expect(strangeness(first(t, { ...n, xflares: [[t + 600, "X5.0"]] }, sky()))).toBe(3);
    expect(strangeness(first(t, { ...n, xflares: [[t + 600, "X4.9"]] }, sky()))).toBe(0);
    expect(strangeness(first(t, { ...n, kp: 8 }, sky()))).toBe(2);
    expect(strangeness(first(t, { ...n, kp: 7 }, sky()))).toBe(0); // G3
    expect(strangeness(first(t, { ...n, asteroid: { name: "x", time: t, ld: 0.9, meters: null } }, sky()))).toBe(2);
    expect(strangeness(first(t, n, sky({ Venus: "Taurus", Mars: "Capricorn", Moon: "Cancer" }, { conditions: ["newmoon"] })))).toBe(4);
  });
});

describe("a pairing (spec 9.2)", () => {
  it("writes the spec's own example", () => {
    const t = at("2024-10-03T12:18:00Z");
    const f: FirstPlaySky = { uts: t, night: quiet("2024-10-03", { xflares: [[t, "X9.0"]] }), sky: sky(), fireballs: [] };
    expect(pairingSentence("Apple", "America/Chicago", f, chipFor(f), [], chicago)).toBe(
      "You first played Apple at 7:18 a.m. CDT on Oct 3, 2024, the minute an X9.0 flare peaked.",
    );
  });

  it("says during a storm only inside one of its readings, and uses a curated title", () => {
    // 10:22 p.m. CDT on May 10, 2024: inside the 21:00-00:00 UTC Kp 9 reading.
    const t = at("2024-05-11T03:22:00Z");
    const f: FirstPlaySky = { uts: t, night: quiet("2024-05-10", { kp: 9 }), sky: sky(), fireballs: [] };
    const spans: [number, number, number][] = [[at("2024-05-11T00:00:00Z"), at("2024-05-11T03:00:00Z"), 8.33], [at("2024-05-11T03:00:00Z"), at("2024-05-11T06:00:00Z"), 9]];
    expect(pairingSentence("Good Luck, Babe!", "America/Chicago", f, chipFor(f), spans, chicago)).toBe(
      "You first played Good Luck, Babe! at 10:22 p.m. CDT on May 10, 2024, during the strongest geomagnetic storm in about 20 years.",
    );
    // Earlier that evening, before the readings: on the night of it.
    const early = { ...f, uts: at("2024-05-10T21:00:00Z") };
    expect(pairingSentence("Song", "America/Chicago", early, chipFor(early), spans, chicago)).toBe(
      "You first played Song at 4:00 p.m. CDT on May 10, 2024, on the night of the strongest geomagnetic storm in about 20 years.",
    );
  });

  it("keeps Venus and Mars capitalized inside the sentence", () => {
    const t = at("2024-10-03T12:18:00Z");
    const f: FirstPlaySky = { uts: t, night: quiet("2024-10-03"), sky: sky({ Venus: "Taurus", Mars: "Aries" }), fireballs: [] };
    expect(pairingSentence("Apple", "America/Chicago", f, chipFor(f), [], chicago)).toBe(
      "You first played Apple at 7:18 a.m. CDT on Oct 3, 2024, with Venus and Mars both at home.",
    );
    const g: FirstPlaySky = { ...f, sky: sky({ Venus: "Libra", Moon: "Taurus" }) };
    expect(pairingSentence("Apple", "America/Chicago", g, chipFor(g), [], chicago)).toBe(
      "You first played Apple at 7:18 a.m. CDT on Oct 3, 2024, with Venus at home, the Moon exalted.",
    );
  });

  it("finds an X flare within the hour across the 4 a.m. line", () => {
    // First play 4:10 a.m. CDT on Oct 4 (Oct 4's night); the flare peaked
    // at 3:50 a.m., on Oct 3's night.
    const t = at("2024-10-04T09:10:00Z");
    const f: FirstPlaySky = {
      uts: t,
      night: quiet("2024-10-04"),
      sky: sky(),
      fireballs: [],
      flares: [[at("2024-10-04T08:50:00Z"), "X9.0"]],
    };
    expect(chipText(chipFor(f)!)).toBe("X9.0 flare, within the hour");
    expect(strangeness(f)).toBe(3);
  });

  it("states nothing without a chip", () => {
    const f: FirstPlaySky = { uts: at("2024-07-01T12:00:00Z"), night: quiet("2024-07-01"), sky: sky(), fireballs: [] };
    expect(chipFor(f)).toBeNull();
    expect(pairingSentence("Song", "America/Chicago", f, null, [], chicago)).toBeNull();
  });
});
