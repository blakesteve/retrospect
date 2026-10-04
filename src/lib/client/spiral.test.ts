import { describe, expect, it } from "vitest";
import { buildSpiral, pt, spiralAt, spiralPieces, spiralStrokes, TAIL_SECONDS } from "./spiral";

/* The Sky view's spiral calendar (spec 8.6 item 2): a turn a year at the
   Sun's longitude, from the inner radius at the first night to the outer at
   now, drawn smooth and never filled solid however long the history. */

const DAY = 86_400;
const YEAR = 365.2422 * DAY;
const FROM = Date.parse("2010-03-01T00:00:00Z") / 1000;
// A Sun that speeds up and slows down by 2° through the year, as the real one does.
const sun = (uts: number) => (((((uts - FROM) / YEAR) * 360 + 2 * Math.sin(((uts - FROM) / YEAR) * 2 * Math.PI)) % 360) + 360) % 360;
const angleOf = (x: number, y: number) => ((Math.atan2(y, -x) * 180) / Math.PI + 360) % 360;
const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("the spiral's shape", () => {
  const s = buildSpiral(FROM, FROM + 16 * YEAR, sun, 189, 207);

  it("winds a turn a year: 16 turns for 16 years, 1.125 apart", () => {
    expect(s.turns).toBeCloseTo(16, 9);
    expect(s.gap).toBeCloseTo(1.125, 9);
  });

  it("never turns a corner a viewer could see: under 3° between points (0.07 units off the arc), all 16 years", () => {
    for (let j = 1; j < s.x.length; j++) {
      expect(off(angleOf(s.x[j], s.y[j]), angleOf(s.x[j - 1], s.y[j - 1])), `point ${j}`).toBeLessThan(3);
    }
  });

  it("puts each instant at the Sun's longitude then, to 0.1°, between its points too", () => {
    for (const years of [0.13, 3.71, 9.5, 15.98]) {
      const t = FROM + years * YEAR;
      const at = spiralAt(s, t);
      expect(off(angleOf(at.x, at.y), sun(t)), `${years} years in`).toBeLessThan(0.1);
    }
  });

  it("runs from the inner radius at the first night to the outer at now", () => {
    const a = spiralAt(s, FROM);
    const b = spiralAt(s, FROM + 16 * YEAR);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(189, 0);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(207, 0);
    expect(a.along).toBe(0);
    expect(b.along).toBe(s.length);
    // Halfway in time is halfway out.
    const m = spiralAt(s, FROM + 8 * YEAR);
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(198, 0);
  });

  it("is one path through every point", () => {
    expect(s.d.startsWith(`M${s.x[0]} ${s.y[0]}L`)).toBe(true);
    expect(s.d.split(" ").length).toBe(s.x.length * 2 - 1);
  });

  it("stays smooth across the longest history Last.fm can hold, 34 years", () => {
    const l = buildSpiral(FROM, FROM + 34 * YEAR, sun, 189, 207);
    for (let j = 1; j < l.x.length; j++) {
      expect(off(angleOf(l.x[j], l.y[j]), angleOf(l.x[j - 1], l.y[j - 1])), `point ${j}`).toBeLessThan(3);
    }
  });

  it("moves along the path smoothly between its points, never jumping to one", () => {
    const step = (16 * YEAR) / (s.x.length - 1);
    const t = FROM + 1000 * step;
    const a = spiralAt(s, t);
    const b = spiralAt(s, t + step / 4);
    const c = spiralAt(s, t + step / 2);
    expect(b.along).toBeGreaterThan(a.along);
    expect(c.along).toBeGreaterThan(b.along);
    expect(c.along - a.along).toBeCloseTo((s.cum[1001] - s.cum[1000]) / 2, 6);
  });

  it("is smooth for a young history too: at least 120 points for five months", () => {
    const y = buildSpiral(FROM, FROM + 150 * DAY, sun, 189, 207);
    expect(y.x.length).toBeGreaterThanOrEqual(120);
    expect(y.turns).toBeLessThan(0.5);
  });

  it("reads the Sun at most every 8 days, and no more than 1,200 times", () => {
    let reads = 0;
    buildSpiral(FROM, FROM + 16 * YEAR, (t) => (reads++, sun(t)), 189, 207);
    expect(reads).toBeGreaterThanOrEqual(Math.ceil((16 * YEAR) / (8 * DAY)));
    expect(reads).toBeLessThanOrEqual(1200);
  });
});

describe("the spiral between two instants", () => {
  const s = buildSpiral(FROM, FROM + 3 * YEAR, sun, 189, 207);
  const start = (d: string) => d.slice(1, d.indexOf("L")).split(" ").map(Number);
  const end = (d: string) => d.split(" ").slice(-2).map(Number);

  it("comes in end-to-end pieces from the first instant to the second", () => {
    const a = FROM + 1.2 * YEAR;
    const b = FROM + 2.2 * YEAR;
    const p = spiralPieces(s, a, b, 10);
    expect(p).toHaveLength(10);
    const pa = spiralAt(s, a);
    const pb = spiralAt(s, b);
    expect(start(p[0])[0]).toBeCloseTo(pa.x, 0);
    expect(start(p[0])[1]).toBeCloseTo(pa.y, 0);
    expect(end(p[9])[0]).toBeCloseTo(pb.x, 0);
    expect(end(p[9])[1]).toBeCloseTo(pb.y, 0);
    for (let k = 1; k < 10; k++) expect(start(p[k])).toEqual(end(p[k - 1]));
  });

  it("only ever runs forward: each point in a piece further round than the last", () => {
    const pieces = spiralPieces(s, FROM + 0.3 * YEAR, FROM + 0.55 * YEAR, 4);
    for (const d of pieces) {
      const nums = d.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number);
      for (let j = 2; j < nums.length; j += 2) {
        const step = (angleOf(nums[j], nums[j + 1]) - angleOf(nums[j - 2], nums[j - 1]) + 360) % 360;
        expect(step, d.slice(0, 30)).toBeGreaterThan(0);
        expect(step).toBeLessThan(10);
      }
    }
  });

  it("brightens the last year behind the moment", () => {
    expect(TAIL_SECONDS).toBe(365.2422 * 86_400);
  });

  it("is empty when the instants are one", () => {
    expect(spiralPieces(s, FROM, FROM, 4)).toEqual(["", "", "", ""]);
  });
});

describe("how the spiral is stroked", () => {
  it("is the Orrery's, a dashed track and a gold line, while the turns stand apart (3 years)", () => {
    expect(spiralStrokes(18 / 3)).toEqual({ baseWidth: 1, baseOpacity: 0.26, baseDash: "1.2 3.2", doneWidth: 1.5, doneOpacity: 0.66 });
  });

  it("never fills the band: each line under half its gap, from 4 years to 34", () => {
    for (let years = 4; years <= 34; years++) {
      const gap = 18 / years;
      const k = spiralStrokes(gap);
      expect(k.doneWidth / gap, `${years} years`).toBeLessThanOrEqual(0.5);
      expect(k.baseWidth / gap, `${years} years`).toBeLessThanOrEqual(0.5);
    }
  });

  it("goes solid and faint once the turns crowd (16 years), so they don't shimmer", () => {
    const k = spiralStrokes(18 / 16);
    expect(k.baseDash).toBeUndefined();
    expect(k.doneOpacity).toBeLessThan(0.35);
    expect(k.baseOpacity).toBeLessThan(0.16);
  });
});

describe("the wheel's angles", () => {
  it("puts 0° Aries at 9 o'clock and runs counterclockwise", () => {
    const [x, y] = pt(0, 100);
    expect(x).toBeCloseTo(-100, 9);
    expect(y).toBeCloseTo(0, 9);
    // 90° (Cancer) at 6 o'clock in screen coordinates, y down.
    expect(pt(90, 100)[1]).toBeCloseTo(100, 9);
  });
});
