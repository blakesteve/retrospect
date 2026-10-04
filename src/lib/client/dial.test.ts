import { describe, expect, it } from "vitest";
import {
  dialKey,
  dialValueText,
  marksByNight,
  moonWaveOpacity,
  nightAt,
  nightAtX,
  offsetOf,
  openingLongitude,
  openingSpiral,
  playAt,
  playStart,
  PLAY_MS,
  playsAround,
  playsWave,
  pulseWidth,
  snapTarget,
  spaced,
  sparkles,
  spiralRadius,
  starSize,
  xOfNight,
} from "./dial";

/* The Sky view's dial (spec 8.6 item 3, 11), on the sample's span: its first
   night is Thursday, Sept 28, 2023, and with tonight Wednesday, May 15, 2024
   it has 231 nights (3 in Sept, 213 Oct to Apr, 15 in May), offsets 0 to
   230. Every expected value is a date counted by hand. */

const FIRST = "2023-09-28";
const N = 231;

describe("the dial's nights", () => {
  it("counts from the first night", () => {
    expect(offsetOf(FIRST, "2024-05-15")).toBe(230);
    expect(nightAt(FIRST, 125)).toBe("2024-01-31");
    expect(nightAt(FIRST, 0)).toBe(FIRST);
  });
});

describe("the dial's keys (11)", () => {
  const key = (k: string, i: number, shift = false) => dialKey(k, shift, i, N, FIRST);
  it("moves a night with the arrows, a week with Shift, later to the right and up", () => {
    expect(key("ArrowRight", 125)).toBe(126);
    expect(key("ArrowUp", 125)).toBe(126);
    expect(key("ArrowLeft", 125)).toBe(124);
    expect(key("ArrowDown", 125)).toBe(124);
    expect(key("ArrowRight", 125, true)).toBe(132);
    expect(key("ArrowLeft", 125, true)).toBe(118);
  });
  it("moves a month with Page Up and Down, on the same day or the month's last", () => {
    expect(nightAt(FIRST, key("PageUp", 125)!)).toBe("2024-02-29"); // Jan 31, a leap year
    expect(nightAt(FIRST, key("PageDown", 125)!)).toBe("2023-12-31");
    expect(nightAt(FIRST, key("PageUp", 154)!)).toBe("2024-03-29"); // Feb 29 keeps its 29th
  });
  it("goes to the ends with Home and End, and never past them", () => {
    expect(key("Home", 125)).toBe(0);
    expect(key("End", 125)).toBe(230);
    expect(key("ArrowLeft", 0)).toBe(0);
    expect(key("ArrowRight", 230)).toBe(230);
    expect(key("PageUp", offsetOf(FIRST, "2024-04-30"))).toBe(230); // May 30 is past tonight
    expect(key("PageDown", 2)).toBe(0); // Aug 30 is before the first night
  });
  it("ignores other keys", () => {
    expect(key("Enter", 125)).toBeNull();
    expect(key("a", 125)).toBeNull();
  });
});

describe("what the dial says (11)", () => {
  it("reads spec 11's example word for word", () => {
    expect(dialValueText("2024-05-10", 39, { storm: "Kp 9" }, false)).toBe("Friday, May 10, 2024: 39 plays, solar storm Kp 9");
  });
  it("adds each of the night's events, and says tonight is so far", () => {
    expect(dialValueText("2024-05-10", 39, { storm: "Kp 9", xflare: "X5.8" }, false)).toBe("Friday, May 10, 2024: 39 plays, solar storm Kp 9, X5.8 flare");
    expect(dialValueText("2024-04-08", 28, { eclipse: "total solar", asteroid: true }, false)).toBe(
      "Monday, Apr 8, 2024: 28 plays, total solar eclipse, an asteroid closer than the Moon",
    );
    expect(dialValueText("2024-05-15", 12, undefined, true)).toBe("Wednesday, May 15, 2024, tonight: 12 plays so far");
    expect(dialValueText("2024-05-15", 0, undefined, true)).toBe("Wednesday, May 15, 2024, tonight: no plays yet");
  });
  it("counts plays in words: none, one, and thousands with a separator", () => {
    expect(dialValueText("2023-10-01", 0, undefined, false)).toBe("Sunday, Oct 1, 2023: no plays");
    expect(dialValueText("2023-10-01", 1, undefined, false)).toBe("Sunday, Oct 1, 2023: 1 play");
    expect(dialValueText("2023-10-01", 1234, undefined, false)).toBe("Sunday, Oct 1, 2023: 1,234 plays");
  });
  it("merges a night's marks of every kind", () => {
    const m = marksByNight({
      storm: [[225, "Kp 9"]],
      xflare: [[225, "X5.8"]],
      eclipse: [],
      asteroid: [225, 274],
      wild: [[225, 3, "The strongest geomagnetic storm in about 20 years", true]],
    });
    expect(m.get(225)).toEqual({ storm: "Kp 9", xflare: "X5.8", asteroid: true, wild: "The strongest geomagnetic storm in about 20 years" });
    expect(m.get(274)).toEqual({ asteroid: true });
    expect(m.get(224)).toBeUndefined();
  });
});

describe("letting go near a wild night (8.6)", () => {
  it("snaps to a wild night within 6 nights, either side, and not from 7", () => {
    expect(snapTarget(94, [100])).toBe(100);
    expect(snapTarget(106, [100])).toBe(100);
    expect(snapTarget(93, [100])).toBeNull();
    expect(snapTarget(107, [100])).toBeNull();
    expect(snapTarget(100, [100])).toBe(100);
  });
  it("takes the nearest, and the earlier of two as near", () => {
    expect(snapTarget(98, [95, 100])).toBe(100);
    expect(snapTarget(100, [94, 106])).toBe(94);
  });
});

describe("tapping the track (11, 2.5.7)", () => {
  it("lands on the night under the point, held to the ends", () => {
    expect(nightAtX(0, 300, N)).toBe(0);
    expect(nightAtX(300, 300, N)).toBe(230);
    expect(nightAtX(150, 300, N)).toBe(115);
    expect(nightAtX(-20, 300, N)).toBe(0);
    expect(nightAtX(400, 300, N)).toBe(230);
    expect(xOfNight(115, 300, N)).toBe(150);
  });
});

describe("Play your years (8.6)", () => {
  it("runs the whole history in 15 seconds", () => {
    expect(PLAY_MS).toBe(15_000);
    expect(playAt(0, 1001, 7_500)).toBe(500);
    expect(playAt(0, 1001, 15_000)).toBe(1000);
  });
  it("goes on from where the dial is at the same pace, and holds at tonight", () => {
    expect(playAt(500, 1001, 7_500)).toBe(1000);
    expect(playAt(500, 1001, 9_000)).toBe(1000);
  });
  it("starts from the first night when the dial is at tonight", () => {
    expect(playStart(230, N)).toBe(0);
    expect(playStart(5, N)).toBe(5);
  });
});

describe("the stars' spiral (8.6)", () => {
  it("runs from the inner radius at the history's start to the outer at now", () => {
    expect(spiralRadius(1000, 1000, 3000, 189, 207)).toBe(189);
    expect(spiralRadius(3000, 1000, 3000, 189, 207)).toBe(207);
    expect(spiralRadius(2000, 1000, 3000, 189, 207)).toBe(198);
  });
  it("sizes a star by its plays, the most-played largest", () => {
    expect(starSize(212, 212)).toBeCloseTo(6.5, 10);
    expect(starSize(0, 212)).toBeCloseTo(2.7, 10);
    expect(starSize(53, 212)).toBeCloseTo(4.6, 10);
  });
});

describe("the dial's waveform (8.6)", () => {
  it("keeps a usual night's height when one night is a hundred times bigger", () => {
    const plays = Array.from({ length: 300 }, (_, i) => (i === 150 ? 2000 : 20));
    const h = playsWave(plays, 300);
    expect(h[40]).toBe(1);
    expect(h[150]).toBe(1);
    // Scaled to the busiest night instead, it would be 0.01 and read as silence.
  });

  it("smooths a quiet night among busy ones over about a week", () => {
    const plays = Array.from({ length: 300 }, (_, i) => (i === 150 ? 0 : 20));
    expect(playsWave(plays, 300)[150]).toBeGreaterThan(0.8);
  });

  it("gathers a long history into the columns it has, each the average of its nights", () => {
    // 16 years in 289px: 20 nights a column, the first half 10 a night and the second 30.
    const plays = Array.from({ length: 5780 }, (_, i) => (i < 2890 ? 10 : 30));
    const h = playsWave(plays, 289);
    expect(h).toHaveLength(289);
    expect(h[20]).toBeCloseTo(1 / 3, 2);
    expect(h[270]).toBe(1);
  });

  it("is flat at the top for a listener who plays the same every night, at any length", () => {
    for (const width of [289, 700]) {
      for (let n = 2; n <= 700; n++) {
        const h = playsWave(Array(n).fill(20), width);
        expect(Math.min(...h), `${n} nights in ${width}px`).toBe(1);
      }
    }
  });

  it("reaches the top for a listener who plays one night a week", () => {
    const h = playsWave(
      Array.from({ length: 200 }, (_, i) => (i % 7 === 0 ? 60 : 0)),
      289,
    );
    expect(Math.max(...h)).toBe(1);
  });

  it("shows a silent week as silence: smoothed over a week, not more", () => {
    const h = playsWave(
      Array.from({ length: 300 }, (_, i) => (i >= 147 && i <= 153 ? 0 : 20)),
      300,
    );
    expect(h[150]).toBe(0);
    expect(h[140]).toBe(1);
  });

  it("averages a column's nights, not its busiest", () => {
    // 600 nights in 300 columns: the first half alternate 0 and 30 (15 a night), the second 20 every night.
    const h = playsWave(
      Array.from({ length: 600 }, (_, i) => (i < 300 ? (i % 2) * 30 : 20)),
      300,
    );
    expect(h[60]).toBe(0.75);
    expect(h[240]).toBe(1);
  });

  it("is flat at nothing for a history with no plays", () => {
    expect(playsWave([0, 0, 0], 300)).toEqual([0, 0, 0]);
  });
});

describe("the Moon's wave on the dial", () => {
  it("is drawn in full while a month spans 6px, as 3 years do in 289px", () => {
    expect(moonWaveOpacity(1096, 289)).toBe(1);
  });
  it("is gone by 3px a month, as 16 years are in 289px, where its peaks blur together", () => {
    expect(moonWaveOpacity(5844, 289)).toBe(0);
  });
  it("fades between: half at 4.5px a month", () => {
    expect(moonWaveOpacity(2953, 450)).toBeCloseTo(0.5, 9);
  });
});

describe("the wheel's opening (8.11)", () => {
  it("starts each planet wound back, the outer farther: the Moon 150°, Saturn 294°", () => {
    expect(openingLongitude(200, 0, 0)).toBeCloseTo(50, 9);
    expect(openingLongitude(200, 6, 0)).toBeCloseTo(266, 9); // 200 - 294, around the wheel
  });
  it("ends with every planet in its place", () => {
    for (let k = 0; k < 7; k++) expect(openingLongitude(123.4, k, 1)).toBeCloseTo(123.4, 9);
  });
  it("starts Saturn last: still wound back a fifth of the way in, while the Moon has moved", () => {
    expect(openingLongitude(200, 6, 0.2)).toBeCloseTo(266, 9);
    expect(openingLongitude(200, 0, 0.2)).not.toBeCloseTo(50, 1);
  });
  it("draws the spiral in from nothing, whole by five-sixths of the way", () => {
    expect(openingSpiral(0)).toBe(0);
    expect(openingSpiral(5 / 6)).toBe(1);
    expect(openingSpiral(0.5)).toBeGreaterThan(0.5);
  });
});

describe("the ring of the night's plays", () => {
  it("runs from 1.2 for a silent night to 8.7 at the top, and no wider", () => {
    expect(pulseWidth(0, 120)).toBe(1.2);
    expect(pulseWidth(120, 120)).toBe(8.7);
    expect(pulseWidth(60, 120)).toBeCloseTo(4.95, 9);
    expect(pulseWidth(900, 120)).toBe(8.7);
  });
});

describe("the plays the ring shows", () => {
  const plays = [0, 0, 0, 0, 0, 0, 0, 90, 0, 0, 0, 0, 0, 0, 0, 30];
  it("is the night's own at rest", () => {
    expect(playsAround(plays, 7, false)).toBe(90);
    expect(playsAround(plays, 6, false)).toBe(0);
  });
  it("is the average of a week either way while the sky moves, so it doesn't flicker", () => {
    expect(playsAround(plays, 7, true)).toBe(90 / 15);
    expect(playsAround(plays, 6, true)).toBe(90 / 14);
  });
});

describe("the track's marks", () => {
  it("keeps the wilder of two that would touch, and every one with room", () => {
    // Wilder first: 100 keeps its place, 104 is 4px from it, 140 has room.
    expect(spaced([100, 104, 140, 95], 9)).toEqual([100, 140]);
  });
});

describe("a star's sparkle", () => {
  it("goes to the most played: over 100 of every 212 of the most played song", () => {
    expect(sparkles(101, 212)).toBe(true);
    expect(sparkles(100, 212)).toBe(false);
    expect(sparkles(500, 1000)).toBe(true);
    expect(sparkles(400, 1000)).toBe(false);
  });
});
