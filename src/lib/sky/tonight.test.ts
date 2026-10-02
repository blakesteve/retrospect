import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCompact } from "@/lib/space/compact";
import { forgetFinalMonths, writeMonth, type EpicDay } from "@/lib/space/store";
import { synthCompact } from "@/lib/space/synthLog";
import { MemoryBlobStore, setBlobStore, type BlobStore } from "@/lib/store/blob";
import { bodyWords, degreeText, skyAt, type Sign, type SkyBody } from "./sky";
import { moonContext, receptions, tonightSky } from "./tonight";

/* The top of Tonight (spec 8.4), pinned to the real sky. Every expected value
   is a literal from the spec or from JPL Horizons (geocentric, apparent,
   ecliptic of date; queried 2 Oct 2026), never from this module:

   - Sept 26, 2026, 16:49 UT: full moon (Moon minus Sun 179.92 at 16:40 and
     180.01 at 16:50), the Moon in Aries 3°38′, 99.93% lit at 17:30. Mars in
     Cancer (119.18) at 17:30.
   - Sept 29, 2026, 03:00 UT: Sun 185.997 (Libra 5°59′), Moon 37.235 (Taurus
     7°14′, 92.64% lit), Mercury 208.160 (Libra 28°09′), Venus 218.161
     (Scorpio 8°09′), Mars 120.592 (Leo 0°35′, so in Leo less than a day at
     his 0.6° a day), Jupiter 139.253 (Leo 19°15′), Saturn 11.725 (Aries
     11°43′, and 11.647 a day later: retrograde).
   - Sept 30, 2026, 20:00 UT: the Moon in Gemini, 79.46% lit.
   - Oct 3, 2026, about 13:25 UT: last quarter (Moon minus Sun 269.95 at
     13:20 and 270.05 at 13:30).
   - Oct 4, 2026, 03:00 UT: the Moon in Cancer (108.35), 43.66% lit.
   - Oct 10, 2026, 15:50 UT: new moon; 0.13% lit at 12:00.
   - Oct 18, 2026, 16:12 UT: first quarter (Moon minus Sun 90.00); at 12:00
     the Moon is in Capricorn (293.22), 48.47% lit.
   - Oct 26, 2026, 04:12 UT: full moon; at 12:00 the Moon is in Taurus
     (37.45), 99.69% lit.
   - Nov 30, 2026, 12:00 UT: Sun 248.29 (Sagittarius), Mercury 231.32
     (Scorpio), Mars 151.75 (Virgo), Jupiter 146.77 (Leo), Moon 148.73 (Leo),
     58.42% lit.
   - Jun 15, 2026, 02:55 UT: new moon. Jun 18, 00:00 UT: the Moon in Leo
     (127.26), 12.03% lit. Jun 24, 12:00 UT: the Moon in Scorpio (212.67),
     74.77% lit. Jun 29, 23:57 UT: full moon.

   Stations (published retrograde tables, matching the sky data to the
   minute): Venus turns retrograde Oct 3, 2026, 07:10 UT, in Scorpio, backs
   into Libra Oct 25, and turns direct Nov 14, 00:20 UT; Mercury turns
   retrograde Oct 24, 07:14 UT, and direct Nov 13, 15:53 UT, and turns
   retrograde again Jun 29, 2026, 17:37 UT; Saturn turns direct Dec 10, 2026,
   23:23 UT. Sydney's daylight saving starts Oct 4, 2026. */

const at = (iso: string) => Date.parse(iso) / 1000;
const tonightAt = (iso: string, zone: string, questionsHeld: string[] = ["held"]) =>
  tonightSky({ now: at(iso), zone, sky: skyAt(new Date(iso)), questionsHeld });

describe("the heading and the time (spec 8.4)", () => {
  it("names the night by the local clock, the spec's own example included", () => {
    // 1 a.m. Tuesday, Sept 29 in Chicago "is Monday night, Sept 28".
    expect(tonightAt("2026-09-29T06:00:00Z", "America/Chicago").heading).toBe("Monday night, Sept 28");
    expect(tonightAt("2026-09-29T08:59:00Z", "America/Chicago").heading).toBe("Monday night, Sept 28"); // 3:59 a.m.
    expect(tonightAt("2026-09-29T09:00:00Z", "America/Chicago").heading).toBe("Tuesday, Sept 29"); // 4:00 a.m.
    expect(tonightAt("2026-09-29T20:59:00Z", "America/Chicago").heading).toBe("Tuesday, Sept 29"); // 3:59 p.m.
    expect(tonightAt("2026-09-29T21:00:00Z", "America/Chicago").heading).toBe("Tuesday night, Sept 29"); // 4:00 p.m.
    expect(tonightAt("2026-09-29T03:00:00Z", "America/Chicago").heading).toBe("Monday night, Sept 28"); // 10 p.m.
  });

  it("reads the listener's own clock, outside the US too", () => {
    expect(tonightAt("2026-09-29T03:00:00Z", "Australia/Sydney").heading).toBe("Tuesday, Sept 29"); // 1 p.m.
    expect(tonightAt("2026-06-24T17:00:00Z", "Australia/Sydney").heading).toBe("Wednesday night, Jun 24"); // 3 a.m. Thursday
    expect(tonightAt("2026-06-24T12:00:00Z", "Australia/Sydney").heading).toBe("Wednesday night, Jun 24"); // 10 p.m.
    expect(tonightAt("2026-10-05T01:00:00Z", "UTC").heading).toBe("Sunday night, Oct 4");
  });

  it("gives the time with the zone as the rest of the app writes it", () => {
    expect(tonightAt("2026-09-29T03:00:00Z", "America/Chicago").timeLine).toBe("The sky right now, 10:00 p.m. CDT");
    expect(tonightAt("2026-09-29T03:00:00Z", "Australia/Sydney").timeLine).toBe("The sky right now, 1:00 p.m. GMT+10");
    // Sydney's daylight saving began that morning.
    expect(tonightAt("2026-10-04T03:00:00Z", "Australia/Sydney").timeLine).toBe("The sky right now, 2:00 p.m. GMT+11");
    expect(tonightAt("2026-10-05T01:00:00Z", "UTC").timeLine).toBe("The sky right now, 1:00 a.m. UTC");
  });
});

describe("the Moon's line (spec 8.4)", () => {
  it("says the phase, the light, the real full moon's distance, her sign and her dignity", () => {
    const want = {
      phaseName: "waning gibbous",
      illumination: 93,
      label: "Waning gibbous, 93% lit",
      line: "Waning gibbous, 93% lit · 2 days after full, in Taurus, where she's exalted",
    };
    expect(tonightAt("2026-09-29T03:00:00Z", "America/Chicago").moon).toEqual(want);
    // The same instant reads the same in any zone: days are elapsed time.
    expect(tonightAt("2026-09-29T03:00:00Z", "Australia/Sydney").moon).toEqual(want);
  });

  it("words each of her dignities, and says nothing in a neutral sign", () => {
    expect(tonightAt("2026-10-04T03:00:00Z", "America/Chicago").moon.line).toBe(
      "Waning crescent, 44% lit · 7 days before new, in Cancer, at home",
    );
    expect(tonightAt("2026-06-24T12:00:00Z", "Australia/Sydney").moon.line).toBe(
      "Waxing gibbous, 75% lit · 5 days before full, in Scorpio, in her fall",
    );
    expect(tonightAt("2026-10-18T12:00:00Z", "UTC").moon.line).toBe(
      "First quarter, 48% lit · 8 days before full, in Capricorn, in her detriment",
    );
    expect(tonightAt("2026-09-30T20:00:00Z", "America/Chicago").moon.line).toBe("Waning gibbous, 79% lit · 4 days after full, in Gemini");
    expect(tonightAt("2026-06-18T00:00:00Z", "America/Chicago").moon.line).toBe("Waxing crescent, 12% lit · 3 days after new, in Leo");
  });

  it("calls her full or new inside the questions' 36-hour windows, and only there", () => {
    expect(tonightAt("2026-10-26T12:00:00Z", "America/Chicago").moon.line).toBe(
      "Full moon, 100% lit · 8 hours after full, in Taurus, where she's exalted",
    );
    expect(tonightAt("2026-10-10T12:00:00Z", "America/Chicago").moon.line).toBe("New moon, 0% lit · 4 hours before new, in Libra");
    // Sept 26 16:49 UT plus 36 hours is Sept 28 04:49.
    expect(tonightAt("2026-09-28T04:40:00Z", "UTC").moon.phaseName).toBe("full");
    expect(tonightAt("2026-09-28T05:00:00Z", "UTC").moon.phaseName).toBe("waning gibbous");
  });

  it("calls a quarter for 12 hours either side of its instant", () => {
    // Last quarter Oct 3 about 13:25 UT: from about 01:25 Oct 3 to 01:25 Oct 4.
    expect(tonightAt("2026-10-03T01:00:00Z", "UTC").moon.phaseName).toBe("waning gibbous");
    expect(tonightAt("2026-10-03T02:00:00Z", "UTC").moon.phaseName).toBe("last quarter");
    expect(tonightAt("2026-10-04T01:00:00Z", "UTC").moon.phaseName).toBe("last quarter");
    expect(tonightAt("2026-10-04T02:00:00Z", "UTC").moon.phaseName).toBe("waning crescent");
    expect(tonightAt("2026-10-18T16:12:00Z", "UTC").moon.label).toBe("First quarter, 50% lit");
    expect(tonightAt("2026-06-24T12:00:00Z", "UTC").moon.phaseName).toBe("waxing gibbous");
  });

  it("counts hours under a day, then whole days, from the nearest full or new moon", () => {
    expect(moonContext(at("2026-09-26T17:30:00Z"))).toBe("less than an hour after full"); // 41 minutes
    expect(moonContext(at("2026-09-26T17:50:00Z"))).toBe("an hour after full"); // 1 h 1 min
    expect(moonContext(at("2026-09-26T23:00:00Z"))).toBe("6 hours after full"); // 6 h 11 min
    expect(moonContext(at("2026-09-27T06:00:00Z"))).toBe("13 hours after full"); // 13 h 11 min, still hours
    expect(moonContext(at("2026-09-27T16:30:00Z"))).toBe("a day after full"); // 23 h 41 min
    expect(moonContext(at("2026-09-28T16:49:00Z"))).toBe("2 days after full");
    expect(moonContext(at("2026-10-10T14:50:00Z"))).toBe("an hour before new");
    expect(moonContext(at("2026-10-09T15:00:00Z"))).toBe("a day before new");
  });
});

describe("the sky chips (spec 8.4)", () => {
  it("takes a fresh sign change, then the dignities a question tests, at most three", () => {
    /* Mars entered Leo under a day before. Venus's station is 4 days off,
       too far. The Sun and Saturn are in their falls, but no question tests
       them. The Moon changed sign 12 hours before, but she's left out. */
    expect(tonightAt("2026-09-29T03:00:00Z", "America/Chicago").chips).toEqual([
      { kind: "sign", body: "Mars", text: "Mars just entered Leo" },
      { kind: "dignity", body: "Venus", dignity: "detriment", text: "Venus in Scorpio · in her detriment" },
      { kind: "dignity", body: "Moon", dignity: "exalted", text: "Moon in Taurus · exalted" },
    ]);
  });

  it("names a coming station's day as the heads-up does", () => {
    // The spec's own chip: Venus stations 2:09 a.m. CDT Saturday, Oct 3.
    expect(tonightAt("2026-09-30T20:00:00Z", "America/Chicago").chips).toEqual([
      { kind: "station", body: "Venus", text: "Venus turns retrograde Saturday" },
      { kind: "sign", body: "Mercury", text: "Mercury just entered Scorpio" },
      { kind: "dignity", body: "Venus", dignity: "detriment", text: "Venus in Scorpio · in her detriment" },
    ]);
    expect(tonightAt("2026-09-30T20:00:00Z", "Australia/Sydney").chips[0].text).toBe("Venus turns retrograde Saturday");
    expect(tonightAt("2026-10-02T12:00:00Z", "America/Chicago").chips[0].text).toBe("Venus turns retrograde tomorrow");
    expect(tonightAt("2026-12-09T12:00:00Z", "America/Chicago").chips[0]).toEqual({
      kind: "station",
      body: "Saturn",
      text: "Saturn ends his retrograde tomorrow",
    });
  });

  it("puts a station of the last 3 days in the past tense, in the listener's days", () => {
    // 10 p.m. Saturday in Chicago, the station was 2:09 a.m. that day; in Sydney it's Sunday afternoon.
    expect(tonightAt("2026-10-04T03:00:00Z", "America/Chicago").chips[0].text).toBe("Venus turned retrograde today");
    expect(tonightAt("2026-10-04T03:00:00Z", "Australia/Sydney").chips[0].text).toBe("Venus turned retrograde yesterday");
    expect(tonightAt("2026-10-05T12:00:00Z", "America/Chicago").chips[0].text).toBe("Venus turned retrograde Saturday");
    // Both ended Friday the 13th in Chicago, Venus nearer now, so first.
    expect(tonightAt("2026-11-15T18:00:00Z", "America/Chicago").chips).toEqual([
      { kind: "station", body: "Venus", text: "Venus ended her retrograde Friday" },
      { kind: "station", body: "Mercury", text: "Mercury ended its retrograde Friday" },
      { kind: "dignity", body: "Venus", dignity: "home", text: "Venus in Libra · at home" },
    ]);
    // Venus's station, 5 days back, is too old.
    expect(tonightAt("2026-10-08T12:00:00Z", "America/Chicago").chips.map((c) => c.kind)).not.toContain("station");
  });

  it("says a planet backed into a sign, carries its dignity, and doesn't repeat it", () => {
    // Mercury turned retrograde Saturday; Venus backed into Libra, her home, 27 hours ago.
    // The full moon would be fourth.
    expect(tonightAt("2026-10-26T12:00:00Z", "America/Chicago").chips).toEqual([
      { kind: "station", body: "Mercury", text: "Mercury turned retrograde Saturday" },
      { kind: "sign", body: "Venus", dignity: "home", text: "Venus just backed into Libra" },
      { kind: "dignity", body: "Moon", dignity: "exalted", text: "Moon in Taurus · exalted" },
    ]);
  });

  it("ends with a full or new moon window when there's room", () => {
    expect(tonightAt("2026-10-10T12:00:00Z", "America/Chicago").chips).toEqual([
      { kind: "dignity", body: "Venus", dignity: "detriment", text: "Venus in Scorpio · in her detriment" },
      { kind: "moon", text: "New moon" },
    ]);
    expect(tonightAt("2026-09-26T17:30:00Z", "UTC").chips).toEqual([
      { kind: "dignity", body: "Venus", dignity: "detriment", text: "Venus in Scorpio · in her detriment" },
      { kind: "dignity", body: "Mars", dignity: "fall", text: "Mars in Cancer · in his fall" },
      { kind: "moon", text: "Full moon" },
    ]);
  });
});

describe("each planet's words (spec 8.4, 8.7.1, 9.3)", () => {
  it("gives every planet's sign, degree, dignity and retrograde flag, in words", () => {
    expect(tonightAt("2026-09-29T03:00:00Z", "America/Chicago").planets).toEqual([
      {
        body: "Sun", sign: "Libra", degreeText: "5°59′", dignity: "fall", retrograde: false,
        line: "Sun in Libra · in his fall", detail: "Sun in his fall · fall in Libra, 5°59′", name: "Sun in Libra, in his fall",
      },
      {
        body: "Moon", sign: "Taurus", degreeText: "7°14′", dignity: "exalted", retrograde: false,
        line: "Moon in Taurus · exalted", detail: "Moon exalted · exaltation in Taurus, 7°14′", name: "Moon in Taurus, exalted",
      },
      {
        body: "Mercury", sign: "Libra", degreeText: "28°09′", dignity: "neutral", retrograde: false,
        line: "Mercury in Libra · a neutral sign", detail: "Mercury in a neutral sign · Libra, 28°09′", name: "Mercury in Libra, a neutral sign",
      },
      {
        body: "Venus", sign: "Scorpio", degreeText: "8°09′", dignity: "detriment", retrograde: false,
        line: "Venus in Scorpio · in her detriment", detail: "Venus in her detriment · detriment in Scorpio, 8°09′",
        name: "Venus in Scorpio, in her detriment",
      },
      {
        body: "Mars", sign: "Leo", degreeText: "0°35′", dignity: "neutral", retrograde: false,
        line: "Mars in Leo · a neutral sign", detail: "Mars in a neutral sign · Leo, 0°35′", name: "Mars in Leo, a neutral sign",
      },
      {
        body: "Jupiter", sign: "Leo", degreeText: "19°15′", dignity: "neutral", retrograde: false,
        line: "Jupiter in Leo · a neutral sign", detail: "Jupiter in a neutral sign · Leo, 19°15′", name: "Jupiter in Leo, a neutral sign",
      },
      {
        body: "Saturn", sign: "Aries", degreeText: "11°43′", dignity: "fall", retrograde: true,
        line: "Saturn in Aries · in his fall", detail: "Saturn in his fall · fall in Aries, 11°43′, retrograde",
        name: "Saturn in Aries, in his fall, retrograde",
      },
    ]);
  });

  it("writes the spec's own examples", () => {
    expect(degreeText(8, 6)).toBe("8°06′");
    const words = (body: SkyBody, sign: Sign, degree = 0, minute = 0) => bodyWords({ body, sign, degree, minute, retrograde: false });
    expect(words("Venus", "Taurus", 14, 21).detail).toBe("Venus at home · domicile in Taurus, 14°21′"); // 8.7.1
    expect(words("Venus", "Scorpio").line).toBe("Venus in Scorpio · in her detriment"); // 9.3
    expect(words("Moon", "Taurus").line).toBe("Moon in Taurus · exalted");
    expect(words("Mars", "Cancer").line).toBe("Mars in Cancer · in his fall");
    expect(words("Mercury", "Pisces").line).toBe("Mercury in Pisces · in its detriment and fall");
    expect(words("Mercury", "Libra").line).toBe("Mercury in Libra · a neutral sign");
    expect(words("Venus", "Scorpio").name).toBe("Venus in Scorpio, in her detriment");
    expect(words("Mercury", "Virgo", 3, 0).detail).toBe("Mercury at home and exalted · domicile and exaltation in Virgo, 3°00′");
    expect(words("Mercury", "Pisces", 20, 5).detail).toBe("Mercury in its detriment and fall · detriment and fall in Pisces, 20°05′");
  });
});

describe("mutual reception (spec 8.4)", () => {
  it("names pairs each in a sign the other rules, plain words first", () => {
    expect(tonightAt("2026-11-30T12:00:00Z", "UTC").receptions).toEqual([
      "The Sun and Jupiter are each in a sign the other rules · mutual reception",
      "Mercury and Mars are each in a sign the other rules · mutual reception",
    ]);
    // The full moon in Aries, Mars's home, while Mars was in Cancer, hers.
    expect(tonightAt("2026-09-26T17:30:00Z", "UTC").receptions).toEqual([
      "The Moon and Mars are each in a sign the other rules · mutual reception",
    ]);
    expect(tonightAt("2026-09-29T03:00:00Z", "UTC").receptions).toEqual([]);
  });

  it("needs both halves: each at home, or only one in the other's sign, isn't one", () => {
    expect(receptions([{ body: "Venus", sign: "Taurus" }, { body: "Mars", sign: "Aries" }])).toEqual([]);
    expect(receptions([{ body: "Venus", sign: "Aries" }, { body: "Mars", sign: "Leo" }])).toEqual([]);
    expect(receptions([{ body: "Venus", sign: "Aries" }, { body: "Mars", sign: "Taurus" }])).toEqual([
      "Venus and Mars are each in a sign the other rules · mutual reception",
    ]);
  });
});

describe("none overhead (spec 8.4, item 3)", () => {
  /* Jun 17 to 28, 2026 holds none of the ten sky conditions. The full moon's
     window opens Jun 28 at 11:57 UT (36 hours before 23:57 Jun 29), before
     Mercury turns retrograde Jun 29 at 17:37. */
  const NONE = "None of the 12 questions' skies is overhead tonight.";

  it("names the soonest condition by its subject, on the payload's day rules", () => {
    expect(tonightAt("2026-06-18T00:00:00Z", "America/Chicago", []).noneOverhead).toBe(`${NONE} Next: a full moon begins Jun 28.`);
    expect(tonightAt("2026-06-24T17:00:00Z", "America/Chicago", []).noneOverhead).toBe(`${NONE} Next: a full moon begins Sunday.`);
    expect(tonightAt("2026-06-24T12:00:00Z", "Australia/Sydney", []).noneOverhead).toBe(`${NONE} Next: a full moon begins Sunday.`);
    expect(tonightAt("2026-06-27T12:00:00Z", "America/Chicago", []).noneOverhead).toBe(`${NONE} Next: a full moon begins tomorrow.`);
  });

  it("is null while any question is overhead", () => {
    expect(tonightAt("2026-06-24T17:00:00Z", "America/Chicago", ["storms"]).noneOverhead).toBeNull();
  });
});

describe("Tonight's words never break spec 9.6", () => {
  /* Every sentence this module writes, over two years of real skies every 11
     hours in three zones, with the questions that really held. A scan only
     proves something about the templates it reached, so each template's
     marker must turn up too. */
  const zones = ["America/Chicago", "Australia/Sydney", "UTC"];
  const sentences: string[] = [];
  for (let t = at("2026-01-01T00:00:00Z"), i = 0; t < at("2028-01-01T00:00:00Z"); t += 11 * 3600, i++) {
    const sky = skyAt(new Date(t * 1000));
    const x = tonightSky({ now: t, zone: zones[i % 3], sky, questionsHeld: sky.conditions });
    sentences.push(x.heading, x.timeLine, x.moon.label, x.moon.line, ...x.chips.map((c) => c.text), ...x.receptions);
    sentences.push(...x.planets.flatMap((p) => [p.line, p.detail, p.name]));
    if (x.noneOverhead) sentences.push(x.noneOverhead);
  }

  it("reached every template", () => {
    const markers = [
      "turns retrograde", "turned retrograde", "ends her retrograde", "ends his retrograde", "ends its retrograde",
      "ended her retrograde", "ended his retrograde", "ended its retrograde", "just entered", "just backed into",
      "The Sun just entered", "are each in a sign the other rules", "Next: ", " night, ", "GMT+11", "CDT", "CST", "UTC",
      "New moon, ", "Waxing crescent, ", "First quarter, ", "Waxing gibbous, ", "Full moon, ", "Waning gibbous, ",
      "Last quarter, ", "Waning crescent, ", "less than an hour ", "an hour ", " hours ", "a day ", " days ",
      ", at home", ", where she's exalted", ", in her detriment", ", in her fall", "· domicile", "· exaltation",
      "· detriment", "· fall", ", retrograde",
    ];
    expect(markers.filter((m) => !sentences.some((s) => s.includes(m)))).toEqual([]);
    expect(sentences).toContain("Full moon");
    expect(sentences).toContain("New moon");
  });

  it("uses none of the words 9.6 forbids, and opens on no verb", () => {
    const banned =
      /\b(cannot|peregrine|wandering|because|caused?|made you|significant|statistically|proves?|electromagnet\w*|energ(y|ies|etic)|vibrat\w*|vibes?|frequenc(y|ies)|download\w*|activat\w*)\b|\u2014/i;
    expect(sentences.filter((s) => banned.test(s))).toEqual([]);
    const openers = new Set([
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "The", "None",
      "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
      "New", "Waxing", "First", "Full", "Waning", "Last",
    ]);
    expect([...new Set(sentences.map((s) => s.split(/[ ,]/)[0]))].filter((w) => !openers.has(w))).toEqual([]);
  });
});

/* ---- The route ------------------------------------------------------------- */

/* The NASA refresh the route asks for after responding is the space work's
   business, tested with it. Here it's a spy: with the store down, a real pass
   would fail in the background and say nothing about this route. */
const refreshNasaAfter = vi.fn();
vi.mock("@/lib/space/refresh", () => ({ refreshNasaAfter: (...args: unknown[]) => refreshNasaAfter(...args) }));
const { GET: skyNowRoute } = await import("@/app/api/sky/now/route");
const { GET: skyAtRoute } = await import("@/app/api/sky/at/route");

/** Sept 26 to 28, 2026 from DSCOVR, made up in EPIC's shape: names, times and
    centroid longitudes as EPIC reports them, the camera seeing the side of
    Earth near local noon. */
const EPIC_SEPT: EpicDay[] = [
  { date: "2026-09-25", images: [{ name: "epic_1b_20260925180000", time: "2026-09-25T18:00:00Z", lat: 1, lon: -90.1 }] },
  { date: "2026-09-27", images: [{ name: "epic_1b_20260927175500", time: "2026-09-27T17:55:00Z", lat: 1, lon: -88.9 }] },
  {
    date: "2026-09-28",
    images: [
      { name: "epic_1b_20260928015922", time: "2026-09-28T01:59:22Z", lat: 1.2, lon: 150.3 },
      { name: "epic_1b_20260928060112", time: "2026-09-28T06:01:12Z", lat: 1.1, lon: 89.6 },
      { name: "epic_1b_20260928175812", time: "2026-09-28T17:58:12Z", lat: 0.9, lon: -89.9 },
      { name: "epic_1b_20260928215003", time: "2026-09-28T21:50:03Z", lat: 0.8, lon: -147.2 },
    ],
  },
];

const callNow = async (iso: string, zone: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  try {
    const res = await skyNowRoute(new Request(`http://x/api/sky/now?tz=${encodeURIComponent(zone)}`));
    return { status: res.status, body: await res.json() };
  } finally {
    vi.useRealTimers();
  }
};

describe("GET /api/sky/now, with Tonight's words (spec 7.4, 8.4)", () => {
  beforeEach(async () => {
    forgetFinalMonths();
    setBlobStore(new MemoryBlobStore());
    // Nothing here reaches the network: a NASA refresh that starts fails at once.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network in tests");
      }),
    );
    await writeMonth({ source: "epic", month: "2026-09", firstDate: "2015-06-13", refreshedAt: "2026-09-29T00:00:00.000Z", records: EPIC_SEPT });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    refreshNasaAfter.mockClear();
    setBlobStore(null);
  });

  it("keeps every field it had, and adds the top of Tonight, in Chicago", async () => {
    await writeCompact(synthCompact("2026-09-29T02:00:00Z"));
    const { status, body } = await callNow("2026-09-29T03:00:00Z", "America/Chicago");
    expect(status).toBe(200);
    // What it served before.
    expect(body.zone).toBe("America/Chicago");
    expect(body.zoneFellBack).toBe(false);
    expect(body.sky.bodies.find((b: { body: string }) => b.body === "Venus").sign).toBe("Scorpio");
    expect(body.questionsHeld).toEqual(["moonstrong", "venusdet"]);
    expect(body.nasa).toBe("ok");
    expect(body.comingUp.find((i: { kind: string }) => i.kind === "station")).toMatchObject({
      text: "Venus stations retrograde in Scorpio",
      date: "Oct 3, 2026",
      at: "2:09 a.m. CDT",
    });
    // What it adds.
    expect(body.heading).toBe("Monday night, Sept 28");
    expect(body.timeLine).toBe("The sky right now, 10:00 p.m. CDT");
    expect(body.moon.line).toBe("Waning gibbous, 93% lit · 2 days after full, in Taurus, where she's exalted");
    expect(body.chips.map((c: { text: string }) => c.text)).toEqual([
      "Mars just entered Leo",
      "Venus in Scorpio · in her detriment",
      "Moon in Taurus · exalted",
    ]);
    expect(body.planets).toHaveLength(7);
    expect(body.planets[3]).toMatchObject({ body: "Venus", degreeText: "8°09′", detail: "Venus in her detriment · detriment in Scorpio, 8°09′" });
    expect(body.receptions).toEqual([]);
    expect(body.noneOverhead).toBeNull();
    // Of Sept 28's photos, the one facing Chicago's longitude (90° west).
    expect(body.epic).toEqual({
      url: "https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928175812.jpg",
      date: "Sept 28",
      line: "Earth on Sept 28, from a million miles out",
      credit: "NASA EPIC team",
    });
  });

  it("speaks Sydney's clock and picks Sydney's side of Earth", async () => {
    await writeCompact(synthCompact("2026-09-29T02:00:00Z"));
    const { body } = await callNow("2026-09-29T03:00:00Z", "Australia/Sydney");
    expect(body.heading).toBe("Tuesday, Sept 29");
    expect(body.timeLine).toBe("The sky right now, 1:00 p.m. GMT+10");
    expect(body.epic.url).toBe("https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928015922.jpg");
    expect(body.epic.line).toBe("Earth on Sept 28, from a million miles out");
  });

  it("says no question is overhead, until NASA logs a storm tonight", async () => {
    await writeMonth({ source: "epic", month: "2026-06", firstDate: "2015-06-13", refreshedAt: "2026-06-24T00:00:00.000Z", records: [] });
    await writeCompact(synthCompact("2026-06-24T16:00:00Z"));
    const quiet = await callNow("2026-06-24T17:00:00Z", "America/Chicago");
    expect(quiet.body.questionsHeld).toEqual([]);
    expect(quiet.body.noneOverhead).toBe("None of the 12 questions' skies is overhead tonight. Next: a full moon begins Sunday.");
    expect(quiet.body.epic).toBeNull(); // nothing from DSCOVR in the last 3 days

    // A G4 reading ending 11 a.m. CDT, after tonight began at 4 a.m.
    await writeCompact(synthCompact("2026-06-24T16:00:00Z", { kp: [["2026-06-24T16:00:00Z", 8]] }));
    const storm = await callNow("2026-06-24T17:00:00Z", "America/Chicago");
    expect(storm.body.questionsHeld).toEqual(["storms"]);
    expect(storm.body.noneOverhead).toBeNull();
  });

  it("still shows the sky when NASA's data can't be read", async () => {
    const broken: BlobStore = {
      get: async () => {
        throw new Error("store down");
      },
      put: async () => {
        throw new Error("store down");
      },
      del: async () => undefined,
      has: async () => false,
      list: async () => {
        throw new Error("store down");
      },
    };
    setBlobStore(broken);
    const { status, body } = await callNow("2026-09-29T03:00:00Z", "America/Chicago");
    expect(status).toBe(200);
    expect(body.nasa).toBe("unavailable");
    expect(refreshNasaAfter).toHaveBeenCalledWith(null);
    expect(body.epic).toBeNull();
    expect(body.heading).toBe("Monday night, Sept 28");
    expect(body.moon.label).toBe("Waning gibbous, 93% lit");
  });
});

describe("GET /api/sky/at carries each body's words too (spec 7.4, 8.7.1)", () => {
  it("serves the line, detail and accessible name with every body", async () => {
    const sky = await (await skyAtRoute(new Request(`http://x/api/sky/at?t=${at("2026-09-29T03:00:00Z")}`))).json();
    expect(sky.bodies.find((b: { body: string }) => b.body === "Saturn")).toMatchObject({
      degreeText: "11°43′",
      line: "Saturn in Aries · in his fall",
      detail: "Saturn in his fall · fall in Aries, 11°43′, retrograde",
      name: "Saturn in Aries, in his fall, retrograde",
    });
  });
});
