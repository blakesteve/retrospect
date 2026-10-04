import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanetSheet } from "./planet";

/* GET /api/sky/planet end to end (spec 8.7.4). Every expectation is a sky
   fact or a rule from the spec written out as a literal; none is computed
   with the module under test.

   Sources for the instants:
   - USNO and JPL Horizons, as `data.test.ts` quotes them (Jupiter's Apr 2031
     station, Saturn's Taurus and the Moon's Capricorn ingresses).
   - Venus's 2026 retrograde, Oct 3 to Nov 13 (US dates), backing into Libra
     on Oct 25: Blake's folklore material, checked against the data to the
     day (`notes/retrospect-folklore-for-the-12.md`). The minutes printed are
     the data's (Oct 3 07:09:58Z, Nov 14 00:20:45Z, Oct 25 08:56:58Z).
   - Venus in 2025: Aries from Feb 4, back into Pisces Mar 27, Aries again
     Apr 30, Taurus Jun 6, Gemini Jul 4, Cancer Jul 31, Leo Aug 25, Virgo
     Sept 19 (UTC dates; spec 6.2 quotes "Venus in Aries Feb 4 to Jun 5,
     2025" in Central time).
   - Saturn: Capricorn from Dec 2017, Aquarius Mar 2020, back into Capricorn
     Jul 2020, Aquarius Dec 2020 to Mar 2023. Retrograde in Aries Jul 26 to
     Dec 10, 2026. Jupiter in Leo from Jun 30, 2026.
   - Mercury in Pisces Feb 14 to Mar 3, 2025, and in Virgo Sept 2 to 18,
     2025. Mars in Cancer Sept 4 to Nov 3, 2024. The Moon in Taurus Sept 29,
     2026 and in Cancer at the Oct 3, 2026 last quarter. */

const { GET } = await import("@/app/api/sky/planet/route");

const at = (iso: string) => Date.parse(iso) / 1000;

async function call(query: string, now = "2026-10-02T17:00:00Z") {
  vi.setSystemTime(new Date(now));
  const res = await GET(new Request(`http://x/api/sky/planet?${query}`));
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), size: text.length, body: JSON.parse(text) };
}

/** A sheet for a short span, read at `now`. */
async function sheet(body: string, now: string, tz = "America/Chicago"): Promise<PlanetSheet & { zone: string; zoneFellBack: boolean }> {
  const res = await call(`body=${body}&from=${at("2025-01-01T00:00:00Z")}&to=${at("2025-02-01T00:00:00Z")}&tz=${tz}`, now);
  expect(res.status).toBe(200);
  return res.body;
}

const span = (body: string, from: string, to: string, tz = "America/Chicago") =>
  call(`body=${body}&from=${at(from)}&to=${at(to)}&tz=${tz}`);

beforeEach(() => {
  // Nothing here reaches the network; anything that tries fails at once.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in tests");
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("validation", () => {
  it.each([
    ["no body", "from=1700000000&to=1700000001"],
    ["an unknown body", "body=pluto&from=1700000000&to=1700000001"],
    ["a capitalized body", "body=Venus&from=1700000000&to=1700000001"],
    ["no from", "body=venus&to=1700000001"],
    ["a word for from", "body=venus&from=abc&to=1700000001"],
    ["a negative from", "body=venus&from=-1&to=1700000001"],
    ["a fractional to", "body=venus&from=1700000000&to=1700000001.5"],
    ["an exponent", "body=venus&from=1e9&to=1700000001"],
    ["milliseconds for to", "body=venus&from=1700000000&to=1700000001000"],
    ["2100 or later", "body=venus&from=1700000000&to=4102444800"],
    ["from after to", "body=venus&from=1700000001&to=1700000000"],
    ["a night that isn't a date", "body=venus&from=1700000000&to=1700000001&night=May10"],
    ["a 13th month", "body=venus&from=1700000000&to=1700000001&night=2024-13-01"],
    ["Feb 30", "body=venus&from=1700000000&to=1700000001&night=2024-02-30"],
    ["a night before the sky data", "body=venus&from=1700000000&to=1700000001&night=1990-01-01"],
    ["a night after it", "body=venus&from=1700000000&to=1700000001&night=2040-01-01"],
  ])("refuses %s with a 400", async (_what, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid");
    expect(typeof res.body.error).toBe("string");
  });

  it("takes the last second before 2100, and from equal to to", async () => {
    expect((await call("body=venus&from=1700000000&to=4102444799")).status).toBe(200);
    expect((await call("body=venus&from=1700000000&to=1700000000")).status).toBe(200);
  });

  it("caches for five minutes, since tonight and next move with the clock", async () => {
    expect((await call("body=venus&from=1700000000&to=1700000001")).cache).toBe("public, max-age=300");
  });

  it("falls back to UTC when no zone is sent, and says so", async () => {
    const res = await call(`body=venus&from=${at("2025-01-01T00:00:00Z")}&to=${at("2025-02-01T00:00:00Z")}`, "2026-10-10T12:00:00Z");
    expect(res.body.zone).toBe("UTC");
    expect(res.body.zoneFellBack).toBe(true);
    expect(res.body.next.station.text).toBe("Venus turns direct Nov 14, 12:20 a.m. UTC");
  });
});

describe("tonight", () => {
  it.each([
    // body, now, sign, dignity, retrograde, plain, term
    ["venus", "2026-10-10T12:00:00Z", "Scorpio", "detriment", true, "Retrograde in Scorpio, in her detriment", "detriment in Scorpio"],
    ["venus", "2025-04-05T12:00:00Z", "Pisces", "exalted", true, "Retrograde in Pisces, exalted", "exaltation in Pisces"],
    ["mercury", "2025-02-25T12:00:00Z", "Pisces", "fall", false, "In Pisces, in its detriment and fall", "detriment and fall in Pisces"],
    ["mercury", "2025-09-10T12:00:00Z", "Virgo", "home", false, "In Virgo, at home and exalted", "domicile and exaltation in Virgo"],
    ["mars", "2024-10-01T12:00:00Z", "Cancer", "fall", false, "In Cancer, in his fall", "fall in Cancer"],
    ["moon", "2026-09-29T12:00:00Z", "Taurus", "exalted", false, "In Taurus, exalted", "exaltation in Taurus"],
    ["moon", "2026-10-03T12:00:00Z", "Cancer", "home", false, "In Cancer, at home", "domicile in Cancer"],
    ["saturn", "2026-10-02T17:00:00Z", "Aries", "fall", true, "Retrograde in Aries, in his fall", "fall in Aries"],
    ["jupiter", "2026-10-02T17:00:00Z", "Leo", "neutral", false, "In Leo, a neutral sign", "no major dignity or debility in Leo"],
  ] as const)("%s at %s: %s, %s", async (body, now, sign, dignity, retrograde, plain, term) => {
    const { tonight } = await sheet(body, now);
    expect(tonight).toMatchObject({ sign, dignity, retrograde, plain, term });
  });

  it("titles the Sun and the Moon with an article, and gives the degree as 8°06′ reads", async () => {
    // USNO: the Sun enters Aries 2030-03-20 13:52 UT; eight minutes on he's
    // a third of an arcminute in.
    const sun = await sheet("sun", "2030-03-20T14:00:00Z");
    expect(sun.tonight).toEqual({
      sign: "Aries",
      degreeText: "0°00′",
      dignity: "exalted",
      retrograde: false,
      title: "The Sun tonight",
      plain: "In Aries, exalted",
      term: "exaltation in Aries",
    });
    expect((await sheet("moon", "2026-10-03T12:00:00Z")).tonight.title).toBe("The Moon tonight");
    expect((await sheet("venus", "2026-10-03T12:00:00Z")).tonight.title).toBe("Venus tonight");
  });
});

describe("on a past night, as the Sky view's dial opens it", () => {
  const night = (body: string, date: string, tz = "America/Chicago", now = "2026-11-20T12:00:00Z") =>
    call(`body=${body}&from=${at("2025-01-01T00:00:00Z")}&to=${at("2025-02-01T00:00:00Z")}&night=${date}&tz=${tz}`, now).then((r) => {
      expect(r.status).toBe(200);
      return r.body as PlanetSheet;
    });

  it("reads the planet that night, never tonight, and says the night's date", async () => {
    // Read on Nov 20, after Venus's 2026 retrograde ended; the night is Oct 10, during it.
    const s = await night("venus", "2026-10-10");
    expect(s.tonight).toMatchObject({
      title: "Venus on Oct 10, 2026",
      sign: "Scorpio",
      dignity: "detriment",
      retrograde: true,
      plain: "Retrograde in Scorpio, in her detriment",
    });
    // "Next" runs from that night too, its year said only when it isn't this year.
    expect(s.next.station!.text).toBe("Venus turns direct Nov 13, 6:20 p.m. CST");
  });

  it("says the year of what came after a night in another year, so it can't read as coming up", async () => {
    // Read Nov 20, 2026; Venus left Leo for Virgo on Oct 8, 2023.
    const s = await night("venus", "2023-09-28");
    expect(s.tonight.title).toBe("Venus on Sept 28, 2023");
    expect(s.next.signChange!.text).toMatch(/^Venus enters Virgo Oct 8, 2023, /);
  });

  it("reads it at 9 p.m. that night in the zone, as the wheel shows it", async () => {
    expect((await night("mars", "2024-10-01")).now).toBe(at("2024-10-02T02:00:00Z")); // 9 p.m. CDT
    expect((await night("mars", "2024-10-01", "Asia/Tokyo")).now).toBe(at("2024-10-01T12:00:00Z")); // 9 p.m. JST
    expect((await night("mars", "2024-10-01")).tonight).toMatchObject({ sign: "Cancer", plain: "In Cancer, in his fall", title: "Mars on Oct 1, 2024" });
  });

  it("titles the Sun and the Moon with their article", async () => {
    expect((await night("sun", "2024-05-10")).tonight.title).toBe("The Sun on May 10, 2024");
    expect((await night("moon", "2024-05-10")).tonight.title).toBe("The Moon on May 10, 2024");
  });
});

describe("the dignity map", () => {
  const ORDER = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

  it("Venus: home in Taurus and Libra, exalted in Pisces, detriment in Aries and Scorpio, fall in Virgo", async () => {
    const { dignityMap } = await sheet("venus", "2026-10-02T17:00:00Z");
    expect(dignityMap).toEqual([
      { sign: "Aries", dignity: "detriment" },
      { sign: "Taurus", dignity: "home" },
      { sign: "Gemini", dignity: "neutral" },
      { sign: "Cancer", dignity: "neutral" },
      { sign: "Leo", dignity: "neutral" },
      { sign: "Virgo", dignity: "fall" },
      { sign: "Libra", dignity: "home" },
      { sign: "Scorpio", dignity: "detriment" },
      { sign: "Sagittarius", dignity: "neutral" },
      { sign: "Capricorn", dignity: "neutral" },
      { sign: "Aquarius", dignity: "neutral" },
      { sign: "Pisces", dignity: "exalted" },
    ]);
  });

  it("Mars: home in Aries and Scorpio, exalted in Capricorn, detriment in Libra and Taurus, fall in Cancer", async () => {
    const { dignityMap } = await sheet("mars", "2026-10-02T17:00:00Z");
    expect(dignityMap).toEqual([
      { sign: "Aries", dignity: "home" },
      { sign: "Taurus", dignity: "detriment" },
      { sign: "Gemini", dignity: "neutral" },
      { sign: "Cancer", dignity: "fall" },
      { sign: "Leo", dignity: "neutral" },
      { sign: "Virgo", dignity: "neutral" },
      { sign: "Libra", dignity: "detriment" },
      { sign: "Scorpio", dignity: "home" },
      { sign: "Sagittarius", dignity: "neutral" },
      { sign: "Capricorn", dignity: "exalted" },
      { sign: "Aquarius", dignity: "neutral" },
      { sign: "Pisces", dignity: "neutral" },
    ]);
  });

  it("Mercury shows home over exalted in Virgo, and fall over detriment in Pisces", async () => {
    const { dignityMap } = await sheet("mercury", "2026-10-02T17:00:00Z");
    expect(dignityMap.map((e) => e.sign)).toEqual(ORDER);
    expect(dignityMap.find((e) => e.sign === "Virgo")!.dignity).toBe("home");
    expect(dignityMap.find((e) => e.sign === "Pisces")!.dignity).toBe("fall");
    expect(dignityMap.find((e) => e.sign === "Gemini")!.dignity).toBe("home");
    expect(dignityMap.find((e) => e.sign === "Sagittarius")!.dignity).toBe("detriment");
  });
});

describe("next station and sign change", () => {
  it("Venus before her 2026 retrograde: she turns retrograde Oct 3", async () => {
    const { next } = await sheet("venus", "2026-09-20T12:00:00Z");
    expect(next.station).toEqual({
      time: at("2026-10-03T07:09:58Z"),
      precision: "minute",
      text: "Venus turns retrograde Oct 3, 2:09 a.m. CDT",
      detail: null,
      direction: "retrograde",
      sign: "Scorpio",
    });
  });

  it("Venus during it: direct Nov 13, and she backs into Libra Oct 25", async () => {
    const { next } = await sheet("venus", "2026-10-10T12:00:00Z");
    expect(next.station!.text).toBe("Venus turns direct Nov 13, 6:20 p.m. CST");
    expect(next.station!.direction).toBe("direct");
    expect(next.station!.sign).toBe("Libra");
    expect(next.signChange).toEqual({
      time: at("2026-10-25T08:56:58Z"),
      precision: "minute",
      text: "Venus backs into Libra Oct 25, 3:56 a.m. CDT",
      detail: null,
      sign: "Libra",
      dignity: "home",
      retrograde: true,
    });
  });

  it("reads the same instants in Tokyo, where the station falls on Nov 14", async () => {
    const res = await sheet("venus", "2026-10-10T12:00:00Z", "Asia/Tokyo");
    expect(res.zone).toBe("Asia/Tokyo");
    expect(res.zoneFellBack).toBe(false);
    expect(res.next.station!.text).toBe("Venus turns direct Nov 14, 9:20 a.m. GMT+9");
    expect(res.next.signChange!.text).toBe("Venus backs into Libra Oct 25, 5:56 p.m. GMT+9");
  });

  it("Venus moving forward enters a sign", async () => {
    // Venus enters Sagittarius 2027-01-07 (she leaves Scorpio then).
    const { next } = await sheet("venus", "2026-12-20T12:00:00Z");
    expect(next.signChange!.text).toMatch(/^Venus enters Sagittarius Jan 7, 2027, \d{1,2}:\d\d a\.m\. CST$/);
    expect(next.signChange!.retrograde).toBe(false);
  });

  it("the Moon enters Capricorn Jul 10, 2033 at 4:43 p.m. CDT (Horizons 21:43:36 UT), and never stations", async () => {
    const { next } = await sheet("moon", "2033-07-10T12:00:00Z");
    expect(next.station).toBeNull();
    expect(next.signChange).toMatchObject({
      precision: "minute",
      text: "The Moon enters Capricorn Jul 10, 4:43 p.m. CDT",
      detail: null,
      sign: "Capricorn",
      dignity: "detriment",
    });
  });

  it("the Sun never stations", async () => {
    const { next } = await sheet("sun", "2030-03-01T00:00:00Z");
    expect(next.station).toBeNull();
    expect(next.signChange!.text).toMatch(/^The Sun enters Aries Mar 20, 8:5\d a\.m\. CDT$/);
  });

  it("names the year when the event isn't in the listener's current year", async () => {
    // 2027-01-01 00:00 UT is still Dec 31, 2026 in Chicago, and Jan 1 in Tokyo.
    // Horizons: Mars stations retrograde 2027-01-10 12:59:06 UT; the data's
    // instant is 13:00:49, inside the 3 minutes data.test.ts allows.
    expect((await sheet("mars", "2027-01-01T00:00:00Z")).next.station!.text).toBe("Mars turns retrograde Jan 10, 2027, 7:00 a.m. CST");
    expect((await sheet("mars", "2027-01-01T00:00:00Z", "Asia/Tokyo")).next.station!.text).toBe("Mars turns retrograde Jan 10, 10:00 p.m. GMT+9");
  });

  it("Jupiter and Saturn read to the day, with an hour's window as the detail", async () => {
    // Horizons: Jupiter stations retrograde 2031-04-15 12:02:29 UT, 7:02 a.m. CDT.
    const jupiter = (await sheet("jupiter", "2031-03-01T00:00:00Z")).next.station!;
    expect(jupiter.precision).toBe("day");
    expect(jupiter.text).toBe("Jupiter turns retrograde Apr 15");
    expect(jupiter.detail).toBe("Between 6:35 and 7:35 a.m. CDT");
    expect(Math.abs(jupiter.time - at("2031-04-15T12:02:29Z"))).toBeLessThanOrEqual(1800);

    // Horizons: Saturn enters Taurus 2028-04-13 03:39:58 UT: 10:39 p.m. CDT on
    // Apr 12 in Chicago, 12:39 p.m. on Apr 13 in Tokyo.
    const chicago = (await sheet("saturn", "2026-10-02T17:00:00Z")).next.signChange!;
    expect(chicago).toMatchObject({ precision: "day", text: "Saturn enters Taurus Apr 12, 2028", detail: "Between 10:35 and 11:35 p.m. CDT" });
    const tokyo = (await sheet("saturn", "2026-10-02T17:00:00Z", "Asia/Tokyo")).next.signChange!;
    expect(tokyo).toMatchObject({ text: "Saturn enters Taurus Apr 13, 2028", detail: "Between 12:35 and 1:35 p.m. GMT+9" });

    // Saturn turns direct Dec 10, 2026, in Aries.
    const saturn = (await sheet("saturn", "2026-10-02T17:00:00Z")).next.station!;
    expect(saturn).toMatchObject({ precision: "day", text: "Saturn turns direct Dec 10", direction: "direct", sign: "Aries" });

    for (const e of [jupiter, chicago, tokyo, saturn]) expect(e.text).not.toMatch(/\d:\d\d/);
  });

  it("says either day when the hour's window crosses midnight", async () => {
    // Jupiter enters Virgo late on Jul 25, 2027, Central time (the data's
    // instant is 04:45 UT on the 26th).
    const { next } = await sheet("jupiter", "2026-10-02T17:00:00Z");
    expect(next.signChange!.text).toBe("Jupiter enters Virgo Jul 25 or 26, 2027");
    expect(next.signChange!.detail).toBe("Between 11:15 p.m. CDT, Jul 25, and 12:15 a.m. CDT, Jul 26");
  });
});

describe("the path", () => {
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  it("clips to the span's ends, and keeps a sign re-entered in a retrograde loop as its own run", async () => {
    const { body } = await span("venus", "2025-03-01T00:00:00Z", "2025-07-01T00:00:00Z");
    const path = body.path;
    expect(path.kind).toBe("segments");
    expect(path.start).toBe(at("2025-03-01T00:00:00Z"));
    expect(path.end).toBe(at("2025-07-01T00:00:00Z"));
    // In Chicago, both ends fall on the evening before.
    expect(path.startLabel).toBe("Feb 28, 2025");
    expect(path.endLabel).toBe("Jun 30, 2025");
    expect(path.segments.map((s: { signs: string[]; dignity: string }) => [s.signs, s.dignity])).toEqual([
      [["Aries"], "detriment"],
      [["Pisces"], "exalted"],
      [["Aries"], "detriment"],
      [["Taurus"], "home"],
    ]);
    expect(path.segments[0].start).toBe(at("2025-03-01T00:00:00Z"));
    expect(path.segments[3].end).toBe(at("2025-07-01T00:00:00Z"));
    expect(path.segments.slice(1).map((s: { start: number }) => day(s.start))).toEqual(["2025-03-27", "2025-04-30", "2025-06-06"]);
    for (let i = 1; i < path.segments.length; i++) expect(path.segments[i].start).toBe(path.segments[i - 1].end);
  });

  it("merges neighbors in the same dignity: Gemini, Cancer and Leo are one neutral run for Venus", async () => {
    const one = (await span("venus", "2025-07-10T00:00:00Z", "2025-09-10T00:00:00Z")).body.path;
    expect(one.segments).toEqual([
      { start: at("2025-07-10T00:00:00Z"), end: at("2025-09-10T00:00:00Z"), signs: ["Gemini", "Cancer", "Leo"], dignity: "neutral" },
    ]);
    const two = (await span("venus", "2025-07-10T00:00:00Z", "2025-10-01T00:00:00Z")).body.path;
    expect(two.segments.map((s: { signs: string[]; dignity: string }) => [s.signs, s.dignity])).toEqual([
      [["Gemini", "Cancer", "Leo"], "neutral"],
      [["Virgo"], "fall"],
    ]);
    expect(day(two.segments[1].start)).toBe("2025-09-19");
  });

  it("merges across a retrograde loop too: Saturn at home in Capricorn and Aquarius, 2018 to 2022", async () => {
    const { path } = (await span("saturn", "2018-01-01T00:00:00Z", "2023-01-01T00:00:00Z")).body;
    expect(path.segments).toEqual([
      {
        start: at("2018-01-01T00:00:00Z"),
        end: at("2023-01-01T00:00:00Z"),
        signs: ["Capricorn", "Aquarius", "Capricorn", "Aquarius"],
        dignity: "home",
      },
    ]);
  });

  it("gives a one-instant span one run", async () => {
    const t = at("2025-08-01T00:00:00Z"); // Venus in Cancer
    const { path } = (await call(`body=venus&from=${t}&to=${t}&tz=America/Chicago`)).body;
    expect(path.segments).toEqual([{ start: t, end: t, signs: ["Cancer"], dignity: "neutral" }]);
  });

  it("clamps the span to the sky data, 2002 through 2035, and has no path outside it", async () => {
    const early = (await span("venus", "2000-06-01T00:00:00Z", "2002-02-01T00:00:00Z", "UTC")).body.path;
    expect(early.start).toBe(at("2002-01-01T00:00:00Z"));
    expect(early.startLabel).toBe("Jan 1, 2002");
    expect(early.segments[0].start).toBe(at("2002-01-01T00:00:00Z"));
    const late = (await span("venus", "2035-12-01T00:00:00Z", "2040-01-01T00:00:00Z", "UTC")).body.path;
    expect(late.end).toBe(at("2035-12-31T23:59:59Z"));
    expect(late.segments.at(-1).end).toBe(at("2035-12-31T23:59:59Z"));
    expect((await span("venus", "1999-01-01T00:00:00Z", "2001-12-31T00:00:00Z")).body.path).toBeNull();
    expect((await span("venus", "2036-01-01T00:00:00Z", "2040-01-01T00:00:00Z")).body.path).toBeNull();
  });

  it("gives the Moon one letter a night, her dignity at 9 p.m. local", async () => {
    // Horizons: she enters Capricorn 2033-07-10 21:43:36 UT. 9 p.m. on Jul 9
    // in Chicago is 02:00 UT on the 10th (Sagittarius), on Jul 10 and 11 she's
    // in Capricorn. In Tokyo 9 p.m. is 12:00 UT, before the ingress on the 10th.
    const chicago = (await span("moon", "2033-07-09T12:00:00Z", "2033-07-12T08:00:00Z")).body.path;
    expect(chicago).toMatchObject({ kind: "nights", firstNight: "2033-07-09", nights: "ndd" });
    expect(chicago.segments).toBeUndefined();
    const tokyo = (await span("moon", "2033-07-09T12:00:00Z", "2033-07-12T08:00:00Z", "Asia/Tokyo")).body.path;
    expect(tokyo).toMatchObject({ kind: "nights", firstNight: "2033-07-09", nights: "nndd" });
    // After the Sept 26, 2026 full moon in Aries: Taurus (exalted) on the
    // nights of Sept 28 and 29, Gemini, then Cancer (home) at the Oct 3 last
    // quarter, and Leo by the night of Oct 4.
    const week = (await span("moon", "2026-09-28T12:00:00Z", "2026-10-04T12:00:00Z")).body.path;
    expect(week).toMatchObject({ firstNight: "2026-09-28", nights: "xxnnhhn" });
  });

  it("keeps 20 years of the Moon under 60 KB, every night accounted for", async () => {
    // Mar 1, 2006 to Mar 1, 2026, from 6 a.m. Central: 7,305 days later, so
    // 7,306 nights.
    const res = await span("moon", "2006-03-01T12:00:00Z", "2026-03-01T12:00:00Z");
    expect(res.size).toBeLessThan(60 * 1024);
    const { nights, firstNight } = res.body.path;
    expect(firstNight).toBe("2006-03-01");
    expect(nights).toHaveLength(7306);
    expect(nights).toMatch(/^[hxdfn]+$/);
    // She passes through every sign each month, so each of her four signs
    // with a dignity holds about a twelfth of the nights.
    for (const code of ["h", "x", "d", "f"]) {
      const share = nights.split(code).length / nights.length;
      expect(share, code).toBeGreaterThan(0.06);
      expect(share, code).toBeLessThan(0.11);
    }
  });

  it("keeps 20 years of each planet under 60 KB too", async () => {
    for (const body of ["sun", "mercury", "venus", "mars", "jupiter", "saturn"]) {
      expect((await span(body, "2006-03-01T12:00:00Z", "2026-03-01T12:00:00Z")).size, body).toBeLessThan(60 * 1024);
    }
  });
});

describe("questions", () => {
  it.each([
    ["venus", [4, 6, 10, 11]],
    ["mars", [6, 9, 12]],
    ["moon", [2, 3, 5]],
    ["mercury", [1]],
    ["sun", []],
    ["jupiter", []],
    ["saturn", []],
  ])("%s: %j", async (body, questions) => {
    expect((await sheet(body, "2026-10-02T17:00:00Z")).questions).toEqual(questions);
  });
});

describe("words (spec 9.3, 9.6)", () => {
  /* Every sentence the sheet returns, over two years of each body read every
     nine days, in Chicago and Tokyo. The scan only means something if it
     reached every template, so it checks that first. */
  const PRONOUN = { sun: "his", moon: "her", mercury: "its", venus: "her", mars: "his", jupiter: "his", saturn: "his" } as const;

  it("never says peregrine, wandering or cannot, nor anything causal, gives each body its pronoun, and reaches every template", async () => {
    const byBody = new Map<string, Set<string>>();
    for (const tz of ["America/Chicago", "Asia/Tokyo"]) {
      for (const body of Object.keys(PRONOUN)) {
        const lines = byBody.get(body) ?? new Set<string>();
        byBody.set(body, lines);
        for (let t = at("2025-01-01T00:00:00Z"); t < at("2027-01-01T00:00:00Z"); t += 9 * 86_400) {
          const s = await sheet(body, new Date(t * 1000).toISOString(), tz);
          for (const line of [s.tonight.title, s.tonight.plain, s.tonight.term, s.next.station?.text, s.next.station?.detail, s.next.signChange?.text, s.next.signChange?.detail]) {
            if (line) lines.add(line);
          }
        }
      }
    }
    const all = [...byBody.values()].flatMap((s) => [...s]);
    for (const marker of [
      / tonight$/, /^In \w+, at home$/, /, exalted$/, /in her detriment/, /in his fall/, /in its detriment and fall/, /, a neutral sign$/,
      /^Retrograde in /, /^domicile in /, /^exaltation in /, /^no major dignity or debility in /,
      / turns retrograde /, / turns direct /, / enters /, / backs into /, /^Between \d+:\d\d and /, /^Between .*, and /, / or \d+/,
    ]) {
      expect(all.some((l) => marker.test(l)), String(marker)).toBe(true);
    }
    for (const line of all) expect(line).not.toMatch(/peregrine|wandering|cannot|because|energy|caus|\u2014/i);
    // Retrograde is said once, first, in plain words; the term doesn't repeat it.
    expect(all.filter((l) => /^(domicile|exaltation|detriment|fall|no major) .*retrograde/.test(l))).toEqual([]);
    // Spec 9.3: her for Venus and the Moon, his for the Sun, Mars, Jupiter
    // and Saturn, its for Mercury. Each body reached a detriment or a fall.
    for (const [body, lines] of byBody) {
      const said = [...lines].flatMap((l) => [...l.matchAll(/\bin (\w+) (?:detriment|fall)/g)].map((m) => m[1]));
      expect(said.length, body).toBeGreaterThan(0);
      expect(new Set(said), body).toEqual(new Set([PRONOUN[body as keyof typeof PRONOUN]]));
    }
  });
});
