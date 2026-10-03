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

  it("names the body each is about, for the wheel's pulse (8.11)", () => {
    const body = (text: string) => all.find((i) => i.text === text)?.body;
    expect(body("Mercury stations retrograde in Aries")).toBe("Mercury");
    expect(body("Total solar eclipse")).toBe("Sun");
    expect(all.filter((i) => i.kind === "moon").map((i) => i.body)).toEqual(all.filter((i) => i.kind === "moon").map(() => "Moon"));
    expect(all.find((i) => i.kind === "sign" && i.text.startsWith("The Sun"))?.body).toBe("Sun");
    // The Moon entering her signs, and Venus and Mars coming into harmony.
    expect(all.filter((i) => i.text.startsWith("The Moon enters")).every((i) => i.body === "Moon")).toBe(true);
    expect(all.filter((i) => i.text.startsWith("The Moon enters")).length).toBeGreaterThan(0);
    // The total lunar eclipse of Mar 14, 2025, from a month before.
    const lunar = comingUp(at("2025-02-20T12:00:00Z"), 45, 100).find((i) => i.kind === "eclipse");
    expect(lunar).toMatchObject({ text: "Total lunar eclipse", body: "Moon" });
    const harmony = comingUp(at("2025-08-20T12:00:00Z"), 45, 100).find((i) => i.text === "Venus and Mars come into harmony");
    expect(harmony?.body).toBe("Venus");
  });

  it("keeps to the next 45 days, in time order, and shows at most 6", () => {
    expect(all.every((i) => i.time > now && i.time <= now + 45 * 86_400)).toBe(true);
    expect(all.map((i) => i.time)).toEqual([...all.map((i) => i.time)].sort((a, b) => a - b));
    expect(comingUp(now)).toEqual(all.slice(0, 6));
    // Never NASA's questions: no one knows when the next storm comes.
    expect(all.flatMap((i) => i.questions)).not.toContain("storms");
  });
});
