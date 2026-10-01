import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BODIES,
  DIGNITY_TABLE,
  aspectBetween,
  degreeInSign,
  dignitiesOf,
  dignityPhrase,
  haloDignity,
  harmonyAt,
  longitude,
  offFrom,
  separation,
  signOf,
  skyAt,
  type Dignity,
  type Sign,
  type SkyBody,
} from "./sky";

/* The sky module's rules, pinned as literals from spec 7.2 and 9.3. */

describe("the dignity table", () => {
  // Spec 7.2, cell by cell. A test that read DIGNITY_TABLE would pass at any table.
  const SPEC: Record<SkyBody, Record<Dignity, Sign[]>> = {
    Sun: { home: ["Leo"], exalted: ["Aries"], detriment: ["Aquarius"], fall: ["Libra"] },
    Moon: { home: ["Cancer"], exalted: ["Taurus"], detriment: ["Capricorn"], fall: ["Scorpio"] },
    Mercury: { home: ["Gemini", "Virgo"], exalted: ["Virgo"], detriment: ["Sagittarius", "Pisces"], fall: ["Pisces"] },
    Venus: { home: ["Taurus", "Libra"], exalted: ["Pisces"], detriment: ["Aries", "Scorpio"], fall: ["Virgo"] },
    Mars: { home: ["Aries", "Scorpio"], exalted: ["Capricorn"], detriment: ["Libra", "Taurus"], fall: ["Cancer"] },
    Jupiter: { home: ["Sagittarius", "Pisces"], exalted: ["Cancer"], detriment: ["Gemini", "Virgo"], fall: ["Capricorn"] },
    Saturn: { home: ["Capricorn", "Aquarius"], exalted: ["Libra"], detriment: ["Cancer", "Leo"], fall: ["Aries"] },
  };

  it("is exactly the spec's", () => {
    for (const body of BODIES) {
      for (const d of ["home", "exalted", "detriment", "fall"] as Dignity[]) {
        expect([...DIGNITY_TABLE[body][d]].sort(), `${body} ${d}`).toEqual([...SPEC[body][d]].sort());
      }
    }
  });

  it("shows home over exalted, and fall over detriment, in the halo", () => {
    expect(dignitiesOf("Mercury", "Virgo")).toEqual(["home", "exalted"]);
    expect(haloDignity("Mercury", "Virgo")).toBe("home");
    expect(dignitiesOf("Mercury", "Pisces")).toEqual(["detriment", "fall"]);
    expect(haloDignity("Mercury", "Pisces")).toBe("fall");
    expect(haloDignity("Mercury", "Libra")).toBe("neutral");
  });

  it("words each standing as spec 9.3 does", () => {
    expect(dignityPhrase("Venus", "Scorpio")).toBe("in her detriment");
    expect(dignityPhrase("Moon", "Taurus")).toBe("exalted");
    expect(dignityPhrase("Moon", "Cancer")).toBe("at home");
    expect(dignityPhrase("Mars", "Cancer")).toBe("in his fall");
    expect(dignityPhrase("Mercury", "Pisces")).toBe("in its detriment and fall");
    expect(dignityPhrase("Mercury", "Virgo")).toBe("at home and exalted");
    expect(dignityPhrase("Mercury", "Libra")).toBe("a neutral sign");
    expect(dignityPhrase("Saturn", "Aries")).toBe("in his fall");
  });
});

describe("words the sky never uses", () => {
  /* "Peregrine" means no dignity of any kind, triplicity and term included,
     which isn't what "a neutral sign" means (spec 7.2, 9.3). Checked in code
     only: comments may name the word to forbid it. */
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("has no 'peregrine' or 'wandering' in any string the app can show", () => {
    const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(root, d)));
    expect(files.length).toBeGreaterThan(50); // the walk found the source
    const hits = files.filter((f) => /peregrine|wandering/i.test(code(f))).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});

describe("signs and degrees", () => {
  it("puts 0 degrees at Aries and 330 at Pisces, wrapping past 360", () => {
    expect(signOf(0)).toBe("Aries");
    expect(signOf(29.9999)).toBe("Aries");
    expect(signOf(30)).toBe("Taurus");
    expect(signOf(330)).toBe("Pisces");
    expect(signOf(359.9999)).toBe("Pisces");
    expect(signOf(360.5)).toBe("Aries");
    expect(signOf(-0.5)).toBe("Pisces");
  });

  it("reads degrees and minutes within the sign", () => {
    expect(degreeInSign(40.5)).toEqual({ degree: 10, minute: 30 });
    expect(degreeInSign(59.99999)).toEqual({ degree: 29, minute: 59 });
  });
});

describe("aspects", () => {
  it("measures the separation forward along the zodiac", () => {
    expect(separation(10, 70)).toBe(60);
    expect(separation(70, 10)).toBe(300);
    expect(separation(350, 20)).toBe(30);
  });

  it("finds the major aspects within 3 degrees, either way round", () => {
    expect(aspectBetween(0, 122.9)?.name).toBe("trine");
    expect(aspectBetween(122.9, 0)?.name).toBe("trine");
    expect(aspectBetween(0, 123.1)).toBeNull();
    expect(aspectBetween(10, 190)?.name).toBe("opposition");
    expect(aspectBetween(0, 57.5)?.name).toBe("sextile");
    expect(aspectBetween(0, 45)).toBeNull();
  });

  it("measures the harmony separation as Mars minus Venus, with sides", () => {
    expect(offFrom(62, 60)).toBe(2);
    expect(offFrom(238, 240)).toBe(-2);
    expect(offFrom(1, 359)).toBe(2);
  });
});

describe("the sky at an instant", () => {
  /* 30 Sept 2026, 20:00 UTC. Signs and motion from JPL Horizons (queried 30
     Sept 2026): Sun 187.68 (Libra), Venus 218.37 (Scorpio, direct), Mars
     121.59 and Jupiter 139.56 (Leo), Saturn 11.59 (Aries, retrograde), Moon
     61.53 (Gemini). So of the ten sky conditions only Venus in detriment
     holds: no Mercury retrograde until 24 Oct, the full moon was 26 Sept, the
     new moon is 10 Oct, and Mars minus Venus is 263 degrees, near no target. */
  const at = skyAt(new Date("2026-09-30T20:00:00Z"));
  const body = (b: SkyBody) => at.bodies.find((x) => x.body === b)!;

  it("places the bodies in their signs", () => {
    expect(body("Sun").sign).toBe("Libra");
    expect(body("Venus").sign).toBe("Scorpio");
    expect(body("Jupiter").sign).toBe("Leo");
    expect(body("Saturn").sign).toBe("Aries");
  });

  it("flags retrograde from the motion, and never for the Sun or Moon", () => {
    expect(body("Saturn").retrograde).toBe(true);
    expect(body("Venus").retrograde).toBe(false); // she stations on 3 Oct 2026
    expect(body("Sun").retrograde).toBe(false);
    expect(body("Moon").retrograde).toBe(false);
  });

  it("names the conditions that hold, and only those", () => {
    expect(at.conditions).toEqual(["venusdet"]);
    expect(harmonyAt(new Date("2025-01-25T12:00:00Z"))).toMatchObject({ aspect: 120, side: "+" });
  });

  it("uses the apparent tropical frame (the March equinox is the Sun at 0 degrees)", () => {
    // USNO: March equinox 2030-03-20 13:52 UT. A minute either side straddles 0.
    expect(longitude("Sun", new Date("2030-03-20T13:50:00Z"))).toBeGreaterThan(359.99);
    expect(longitude("Sun", new Date("2030-03-20T13:54:00Z"))).toBeLessThan(0.01);
  });
});
