import { describe, expect, it } from "vitest";
import eclipses from "@/data/eclipses.json";
import donki from "@/lib/answers/testdata/donki-compact.json";
import { zoneClock } from "@/lib/zone";
import { SPACE_EVENTS, SPACE_PHOTOS } from "./curated";

const at = (iso: string) => Date.parse(iso) / 1000;
const chicago = zoneClock("America/Chicago", at("2017-01-01T00:00:00Z"), at("2026-01-01T00:00:00Z"));
/** The date of the Chicago night holding an instant. */
const chicagoNight = (iso: string) => new Date(chicago.nightOf(at(iso)) * 86_400_000).toISOString().slice(0, 10);
/** Eclipse peaks from the app's own sky data, to the second. */
const peaks = new Set(eclipses.windows.map((w) => w.peak.slice(0, 19) + "Z"));

describe("the curated photos (spec 7.3)", () => {
  it("is the round 2 seed, without the ISS aurora that was paired with the wrong night", () => {
    expect(SPACE_PHOTOS.map((p) => p.nasaId)).toEqual([
      "iss070e003409",
      "GRC-2024-C-02616",
      "PIA26383",
      "MAF_20250314_LunarEclipse_composite",
      "PIA26304",
    ]);
    expect(JSON.stringify(SPACE_PHOTOS)).not.toContain("iss072e159172");
  });

  it("points every photo at NASA's Image Library, by its own id, with a credit", () => {
    for (const p of SPACE_PHOTOS) {
      expect(p.image).toMatch(new RegExp(`^https://images-assets\\.nasa\\.gov/image/${p.nasaId}/${p.nasaId}~(large|medium)\\.jpg$`));
      expect(p.page).toBe(`https://images.nasa.gov/details/${p.nasaId}`);
      expect(p.credit).toMatch(/^NASA\//);
    }
  });

  it("says in every caption when the photo was taken", () => {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (const p of SPACE_PHOTOS) {
      const [y, m, d] = p.taken.from.split("-").map(Number);
      const [, , d2] = p.taken.to.split("-").map(Number);
      const when = p.taken.from === p.taken.to ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d} and ${d2}, ${y}`;
      expect(p.caption, p.nasaId).toContain(when);
    }
  });

  it("shows each night photo on its own event's night, and the Mars aurora on none", () => {
    // Nights run 4 a.m. to 4 a.m.: the blood moon peaked at 1:58 a.m. CDT on
    // Mar 14, 2025, so in Chicago it's the night of Mar 13.
    expect(Object.fromEntries(SPACE_PHOTOS.filter((p) => p.eventAt).map((p) => [p.nasaId, chicagoNight(p.eventAt!)]))).toEqual({
      iss070e003409: "2023-10-14",
      "GRC-2024-C-02616": "2024-04-08",
      PIA26383: "2024-06-29",
      MAF_20250314_LunarEclipse_composite: "2025-03-13",
    });
    for (const p of SPACE_PHOTOS) {
      expect(p.showOn === "night", p.nasaId).toBe(p.eventAt !== null);
      // A night photo was taken within a day of its event, never before it.
      if (p.eventAt) {
        expect(Date.parse(p.taken.from) - Date.parse(p.eventAt.slice(0, 10)), p.nasaId).toBeGreaterThanOrEqual(0);
        expect(Date.parse(p.taken.to) - Date.parse(p.eventAt), p.nasaId).toBeLessThan(86_400_000);
      }
      if (p.kind === "eclipse") expect(peaks.has(p.eventAt!), p.nasaId).toBe(true);
    }
    expect(SPACE_PHOTOS.find((p) => p.nasaId === "PIA26304")).toMatchObject({ showOn: "fact", eventAt: null });
  });
});

describe("the curated events (spec 7.3)", () => {
  it("rests every title on a government source, with its words and the date it said them", () => {
    for (const e of SPACE_EVENTS) {
      expect(new URL(e.source).protocol, e.id).toBe("https:");
      expect(new URL(e.source).hostname, e.id).toMatch(/(^|\.)(nasa\.gov|noaa\.gov|spaceweather\.gov)$/);
      expect(e.sourceSays.length, e.id).toBeGreaterThan(0);
      for (const quote of e.sourceSays) expect(quote.length, e.id).toBeGreaterThan(10);
      expect(e.asOf >= e.at.slice(0, 10) || e.kind === "eclipse", e.id).toBe(true);
      expect(e.asOf <= "2026-10-01", e.id).toBe(true);
      // A superlative in the title has one in the source's own words.
      if (/\b(strongest|largest|biggest|most)\b/i.test(e.title)) {
        expect(e.sourceSays.join(" "), e.id).toMatch(/\b(strongest|largest|biggest|most)\b/i);
      }
    }
  });

  it("writes no clock times, since the page writes them in the listener's zone", () => {
    for (const e of SPACE_EVENTS) expect(`${e.title} ${e.story}`, e.id).not.toMatch(/\d:\d\d|\b(a|p)\.m\.|\b(EDT|EST|CDT|CST|PDT|UTC)\b/);
  });

  it("puts each event on its night, eclipses at the app's own peaks", () => {
    expect(Object.fromEntries(SPACE_EVENTS.map((e) => [e.id, chicagoNight(e.at)]))).toEqual({
      "eclipse-2023-10-14": "2023-10-14",
      "eclipse-2024-04-08": "2024-04-08",
      "storm-2024-05-10": "2024-05-10",
      "asteroid-2024-06-29": "2024-06-29",
      "flare-2017-09-06": "2017-09-06",
      "flare-2024-10-03": "2024-10-03",
      "eclipse-2025-03-14": "2025-03-13",
    });
    for (const e of SPACE_EVENTS.filter((x) => x.kind === "eclipse")) expect(peaks.has(e.at), e.id).toBe(true);
    expect(new Set(SPACE_EVENTS.map((e) => e.id)).size).toBe(SPACE_EVENTS.length);
  });
});

/* Two titles rest on NASA's log as well as their source ("so far", with an
   as-of date, architect 1 Oct 2026). These hold them to the log committed
   for the null test, DONKI as of 1 Oct 2026: a log refreshed with a bigger
   flare fails here instead of leaving a false title on the page. */
describe("superlatives that rest on NASA's log", () => {
  const flares = Object.values(donki.xflares)
    .flat()
    .map(([peak, cls]) => ({ peak: new Date((peak as number) * 1000).toISOString(), size: Number(String(cls).slice(1)) }));
  const biggest = (from: string, to: string) =>
    flares.filter((f) => f.peak >= from && f.peak < to).sort((a, b) => b.size - a.size)[0];
  const event = (id: string) => SPACE_EVENTS.find((e) => e.id === id)!;

  it("checks a log that reaches the as-of month", () => {
    expect(donki.refreshedAt >= "2026-09-30").toBe(true);
    for (const e of SPACE_EVENTS.filter((x) => /NASA's log/.test(x.title))) {
      expect(e.checkedAgainst, e.id).toMatch(/September 2026$/);
      expect(e.title, e.id).toMatch(/, as of September 2026$/);
    }
  });

  it("has nothing in the log bigger than the X9.3 of Sept 6, 2017", () => {
    expect(biggest("2010-01-01", "2026-10-01")).toEqual({ peak: "2017-09-06T12:02:00.000Z", size: 9.3 });
    expect(event("flare-2017-09-06").title).toBe("The largest flare in NASA's log, as of September 2026");
  });

  it("has nothing bigger than the X9.0 of Oct 3, 2024 since NOAA called it Solar Cycle 25's largest", () => {
    expect(biggest("2024-10-03T12:19:00Z", "2026-10-01")!.size).toBeLessThan(9.0);
    expect(biggest("2024-10-01", "2024-10-04")).toEqual({ peak: "2024-10-03T12:18:00.000Z", size: 9 });
    expect(event("flare-2024-10-03").title).toBe("The largest flare of this solar cycle in NASA's log, as of September 2026");
  });
});
