import { describe, expect, it } from "vitest";
import { skyBodies } from "./skyCompute";
import { ORBITS, glyphNudges, orbitGlyph, orbitGlyphAngles, overlap, retroMark, truePlace, type OrbitGlyph } from "./orbitGlyphs";

/** 9 p.m. in Chicago on a date, as the dial samples it. */
const ninePmChicago = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  // CDT is UTC-5 from March to November, CST UTC-6.
  const cdt = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }).endsWith("CDT");
  return Date.UTC(y, m - 1, d, 21 + (cdt ? 5 : 6)) / 1000;
};
const glyphsAt = (uts: number) => skyBodies(uts).flatMap((b) => orbitGlyph(b) ?? []);
/** The worst overlap between any two planets once laid out (≤ 0: none covers another). */
const worst = (glyphs: OrbitGlyph[]) => {
  const at = orbitGlyphAngles(glyphs);
  let most = -Infinity;
  for (let i = 0; i < glyphs.length; i++)
    for (let j = i + 1; j < glyphs.length; j++) most = Math.max(most, overlap(glyphs[i], at[glyphs[i].body], glyphs[j], at[glyphs[j].body]));
  return most;
};
/** From `a` to `b` the short way round, in degrees (-180 to 180). */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
const off = (a: number, b: number) => Math.abs(turn(a, b));
/** The pairs that would meet drawn at their true places. */
const meetingPairs = (glyphs: OrbitGlyph[]) =>
  glyphs.flatMap((p, i) => glyphs.slice(i + 1).flatMap((q) => (overlap(p, p.longitude, q, q.longitude) > 0 ? [[p, q] as const] : [])));

describe("the Sky view's planet glyphs (spec 8.6, 8.9)", () => {
  it("leaves planets apart where they are", () => {
    const nudges = glyphNudges([
      { body: "Sun", longitude: 10, retrograde: false },
      { body: "Mercury", longitude: 60, retrograde: true },
      { body: "Venus", longitude: 120, retrograde: false },
      { body: "Mars", longitude: 200, retrograde: false },
    ]);
    expect(nudges).toEqual({ Sun: 0, Mercury: 0, Venus: 0, Mars: 0 });
  });

  it("fans out Mercury and Venus, both retrograde, at the Sun on 23 March 2025, in their order, none covering another", () => {
    const uts = ninePmChicago("2025-03-23");
    const bodies = skyBodies(uts);
    const lon = Object.fromEntries(bodies.map((b) => [b.body, b.longitude]));
    // A real conjunction: Venus within 2° of the Sun, Mercury within 3°,
    // both retrograde (Venus's inferior conjunction, Mercury's a day later).
    expect(off(lon.Venus, lon.Sun)).toBeLessThan(2);
    expect(off(lon.Mercury, lon.Sun)).toBeLessThan(3);
    expect(bodies.filter((b) => b.retrograde).map((b) => b.body).sort()).toEqual(["Mercury", "Venus"]);

    const glyphs = glyphsAt(uts);
    // Drawn where they are, they cover each other.
    const level = Object.fromEntries(glyphs.map((g) => [g.body, g.longitude]));
    expect(overlap(glyphs.find((g) => g.body === "Venus")!, level.Venus, glyphs.find((g) => g.body === "Sun")!, level.Sun)).toBeGreaterThan(5);
    expect(worst(glyphs)).toBeLessThanOrEqual(0);

    const at = orbitGlyphAngles(glyphs);
    // Venus, the Sun, then Mercury, as they stand, the glyphs going round the same way.
    expect([turn(lon.Sun, lon.Venus) < 0, turn(lon.Sun, lon.Mercury) > 0]).toEqual([true, true]);
    expect([turn(at.Sun, at.Venus) < 0, turn(at.Sun, at.Mercury) > 0]).toEqual([true, true]);
    for (const g of glyphs) expect(off(g.longitude, at[g.body]), g.body).toBeLessThan(20);
    // Venus's true place falls beside its glyph, so a dot marks it; the Sun's
    // glyph, 2° off, still stands over its own.
    const place = (body: string) => truePlace(glyphs.find((g) => g.body === body)!, at[body]);
    expect([place("Venus").beside, place("Sun").beside]).toEqual([true, false]);
  });

  it("counts the ℞: a planet clear of its neighbor's glyph but not of its mark stands off", () => {
    const mercury = (longitude: number) => orbitGlyph({ body: "Mercury", longitude, retrograde: true })!;
    const bare = (longitude: number): OrbitGlyph => ({ ...mercury(longitude), mark: null });
    // Venus where its orbit runs up and to the right of Mercury's, as the ℞
    // sits on screen: at 225°, a third of the way past 6 o'clock.
    const venus = orbitGlyph({ body: "Venus", longitude: 225, retrograde: false })!;
    // Where Mercury's glyph clears Venus's and its ℞ reaches furthest into it.
    const clear = Array.from({ length: 800 }, (_, k) => 185 + k * 0.1).filter((l) => overlap(bare(l), l, venus, 225) <= 0);
    const where = clear.reduce<number | undefined>((best, l) => (best === undefined || overlap(mercury(l), l, venus, 225) > overlap(mercury(best), best, venus, 225) ? l : best), undefined);
    expect(where).toBeDefined();
    expect(overlap(mercury(where!), where!, venus, 225)).toBeGreaterThan(2);
    // Without the ℞, nothing moves; with it, they stand off and clear.
    expect(glyphNudges([{ body: "Mercury", longitude: where!, retrograde: false }, { body: "Venus", longitude: 225, retrograde: false }])).toEqual({ Mercury: 0, Venus: 0 });
    const both = [mercury(where!), venus];
    expect(worst(both)).toBeLessThanOrEqual(0);
    expect(off(where!, orbitGlyphAngles(both).Mercury)).toBeGreaterThan(0.5);
    // 16 across: 12.6px on the 343px wheel at 375, where 12 was 9.4px.
    expect(retroMark("Mercury").size * (343 / 436)).toBeGreaterThanOrEqual(12);
  });

  it("covers nothing on any night of the sample's history, keeps every pair that would meet in its order, and moves no glyph past 30°", () => {
    let nights = 0;
    for (let t = Date.UTC(2023, 8, 28); t <= Date.UTC(2026, 9, 16); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const glyphs = glyphsAt(ninePmChicago(date));
      expect(worst(glyphs), date).toBeLessThanOrEqual(0);
      const at = orbitGlyphAngles(glyphs);
      for (const g of glyphs) expect(off(g.longitude, at[g.body]), `${date} ${g.body}`).toBeLessThan(30);
      for (const [p, q] of meetingPairs(glyphs)) expect(Math.sign(turn(at[p.body], at[q.body])), `${date} ${p.body} ${q.body}`).toBe(Math.sign(turn(p.longitude, q.longitude)));
      nights++;
    }
    // Every night from the sample's first, Sept 28, 2023, to Oct 16, 2026.
    expect(nights).toBe(1115);
  }, 60_000);

  it("is the same whatever order the planets come in", () => {
    const glyphs = glyphsAt(ninePmChicago("2024-04-19"));
    expect(orbitGlyphAngles([...glyphs].reverse())).toEqual(orbitGlyphAngles(glyphs));
  });

  it("clears and keeps in order any cluster of three to seven planets, retrograde or not", () => {
    let seed = 0x5eed;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let k = 0; k < 1000; k++) {
      const count = 3 + Math.floor(rand() * 5);
      const center = rand() * 360;
      const bodies = [...ORBITS].sort(() => rand() - 0.5).slice(0, count);
      const glyphs = bodies.map((body) => orbitGlyph({ body, longitude: (center + (rand() - 0.5) * 30 + 360) % 360, retrograde: body !== "Sun" && body !== "Moon" && rand() < 0.4 })!);
      expect(worst(glyphs), `cluster ${k}`).toBeLessThanOrEqual(0);
      const at = orbitGlyphAngles(glyphs);
      for (const [p, q] of meetingPairs(glyphs)) expect(Math.sign(turn(at[p.body], at[q.body])), `cluster ${k} ${p.body} ${q.body}`).toBe(Math.sign(turn(p.longitude, q.longitude)));
    }
  });
});
