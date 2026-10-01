import { describe, expect, it } from "vitest";
import { comingUp } from "./comingUp";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("coming up (spec 7.4)", () => {
  // From noon UTC on Mar 25, 2024: Mercury stations retrograde on Apr 1 and
  // the total solar eclipse is on Apr 8, a new moon too.
  const now = at("2024-03-25T12:00:00Z");
  const all = comingUp(now, 45, 100);

  it("lists stations, eclipses and the questions they start, once each", () => {
    const station = all.find((i) => i.text === "Mercury stations retrograde in Aries")!;
    expect(Math.abs(station.time - at("2024-04-01T22:14:00Z"))).toBeLessThan(60);
    expect(station.questions).toEqual(["mercury"]);
    const eclipse = all.find((i) => i.kind === "eclipse")!;
    expect(eclipse.text).toBe("Total solar eclipse");
    expect(eclipse.time).toBe(at("2024-04-08T18:17:19Z"));
    // The eclipse is the new moon's listing, not a second line for it.
    expect(eclipse.questions).toContain("newmoon");
    expect(all.filter((i) => i.kind === "moon" && Math.abs(i.time - eclipse.time) < 86_400)).toEqual([]);
  });

  it("keeps to the next 45 days, in time order, and shows at most 6", () => {
    expect(all.every((i) => i.time > now && i.time <= now + 45 * 86_400)).toBe(true);
    expect(all.map((i) => i.time)).toEqual([...all.map((i) => i.time)].sort((a, b) => a - b));
    expect(comingUp(now)).toEqual(all.slice(0, 6));
    // Never NASA's questions: no one knows when the next storm comes.
    expect(all.flatMap((i) => i.questions)).not.toContain("storms");
  });
});
