import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalZone,
  nightMonth,
  nightName,
  nightWeekday,
  requestZone,
  zoneClock,
} from "./zone";

/* Spec 7.1 and 6.6. Every instant below is a literal, checked against the
   published rules (US: second Sunday in March to first Sunday in November
   since 2007, first Sunday in April to last Sunday in October before;
   New South Wales: first Sunday in October to first Sunday in April; Brazil
   ended daylight saving in 2019), never computed by the module under test. */

const at = (iso: string) => Date.parse(iso) / 1000;
const HOUR = 3600;

describe("which zones a request may name", () => {
  it("accepts IANA zones, aliases included, and names each once", () => {
    expect(canonicalZone("America/Chicago")).toBe("America/Chicago");
    expect(canonicalZone("US/Central")).toBe("America/Chicago");
    expect(canonicalZone("america/chicago")).toBe("America/Chicago");
    // Spec 6.6: one record for Asia/Kolkata and Asia/Calcutta.
    expect(canonicalZone("Asia/Kolkata")).not.toBeNull();
    expect(canonicalZone("Asia/Kolkata")).toBe(canonicalZone("Asia/Calcutta"));
    expect(canonicalZone("Europe/Kyiv")).not.toBeNull();
    expect(canonicalZone("Europe/Kyiv")).toBe(canonicalZone("Europe/Kiev"));
  });

  it("accepts UTC by every name, which Intl.supportedValuesOf leaves out", () => {
    for (const name of ["UTC", "utc", "Etc/UTC", "GMT", "Etc/GMT"]) expect(canonicalZone(name), name).toBe("UTC");
  });

  it("refuses what isn't a zone, and a bare offset", () => {
    for (const bad of ["", "Not/AZone", "America/Chicago ", "Chicago", "+05:30", "-0500", "+00:00"]) {
      expect(canonicalZone(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(canonicalZone(null)).toBeNull();
    expect(canonicalZone(undefined)).toBeNull();
    expect(canonicalZone(-300)).toBeNull();
  });
});

describe("the zone a request asks for", () => {
  const ask = (query: string) => requestZone(new URLSearchParams(query));

  it("uses tz when it's a zone", () => {
    expect(ask("tz=America/Chicago")).toEqual({ zone: "America/Chicago", fellBack: false });
    expect(ask("tz=Australia%2FSydney")).toEqual({ zone: "Australia/Sydney", fellBack: false });
  });

  it("falls back to UTC, flagged, when tz is missing or refused", () => {
    expect(ask("")).toEqual({ zone: "UTC", fellBack: true });
    expect(ask("tz=")).toEqual({ zone: "UTC", fellBack: true });
    expect(ask("tz=Mars/Olympus_Mons")).toEqual({ zone: "UTC", fellBack: true });
    // Today's fixed offset is not a zone.
    expect(ask("tzm=-300")).toEqual({ zone: "UTC", fellBack: true });
  });

  it("doesn't flag a browser that really is on UTC", () => {
    expect(ask("tz=UTC")).toEqual({ zone: "UTC", fellBack: false });
    expect(ask("tz=Etc/UTC")).toEqual({ zone: "UTC", fellBack: false });
  });
});

describe("offsets, daylight saving included", () => {
  const offsetHours = (zone: string, iso: string) => zoneClock(zone, at(iso)).offsetAt(at(iso)) / HOUR;

  it("America/Chicago springs forward and falls back to the second (2026)", () => {
    expect(offsetHours("America/Chicago", "2026-03-08T07:59:59Z")).toBe(-6);
    expect(offsetHours("America/Chicago", "2026-03-08T08:00:00Z")).toBe(-5);
    expect(offsetHours("America/Chicago", "2026-11-01T06:59:59Z")).toBe(-5);
    expect(offsetHours("America/Chicago", "2026-11-01T07:00:00Z")).toBe(-6);
  });

  it("uses the rules in force at the time, not today's (Chicago, 2006)", () => {
    // Today's rule would have started daylight saving on 12 March 2006.
    expect(offsetHours("America/Chicago", "2006-03-12T09:00:00Z")).toBe(-6);
    expect(offsetHours("America/Chicago", "2006-04-02T07:59:59Z")).toBe(-6);
    expect(offsetHours("America/Chicago", "2006-04-02T08:00:00Z")).toBe(-5);
    expect(offsetHours("America/Chicago", "2006-10-29T06:59:59Z")).toBe(-5);
    expect(offsetHours("America/Chicago", "2006-10-29T07:00:00Z")).toBe(-6);
  });

  it("Australia/Sydney, south of the equator, runs the other way (2026)", () => {
    expect(offsetHours("Australia/Sydney", "2026-04-04T15:59:59Z")).toBe(11);
    expect(offsetHours("Australia/Sydney", "2026-04-04T16:00:00Z")).toBe(10);
    expect(offsetHours("Australia/Sydney", "2026-10-03T15:59:59Z")).toBe(10);
    expect(offsetHours("Australia/Sydney", "2026-10-03T16:00:00Z")).toBe(11);
  });

  it("America/Sao_Paulo kept daylight saving until 2019, then dropped it", () => {
    expect(offsetHours("America/Sao_Paulo", "2018-11-04T02:59:59Z")).toBe(-3);
    expect(offsetHours("America/Sao_Paulo", "2018-11-04T03:00:00Z")).toBe(-2);
    expect(offsetHours("America/Sao_Paulo", "2019-02-17T02:00:00Z")).toBe(-3);
    expect(offsetHours("America/Sao_Paulo", "2026-01-15T12:00:00Z")).toBe(-3);
  });

  it("keeps half hours: Kolkata, and Lord Howe's half-hour daylight saving", () => {
    expect(offsetHours("Asia/Kolkata", "2026-06-01T00:00:00Z")).toBe(5.5);
    expect(offsetHours("Australia/Lord_Howe", "2026-10-03T15:29:59Z")).toBe(10.5);
    expect(offsetHours("Australia/Lord_Howe", "2026-10-03T15:30:00Z")).toBe(11);
  });

  it("reaches outside the years it was built for", () => {
    const clock = zoneClock("America/Chicago", at("2026-01-01T00:00:00Z"), at("2026-12-31T00:00:00Z"));
    expect(clock.offsetAt(at("2005-07-01T12:00:00Z")) / HOUR).toBe(-5);
    expect(clock.offsetAt(at("2005-12-01T12:00:00Z")) / HOUR).toBe(-6);
    expect(clock.offsetAt(at("2026-07-01T12:00:00Z")) / HOUR).toBe(-5);
    expect(clock.offsetAt(at("2034-12-01T12:00:00Z")) / HOUR).toBe(-6);
  });

  it("refuses an instant it can't read, and keeps working after", () => {
    const clock = zoneClock("America/Chicago", at("2026-01-01T00:00:00Z"));
    // NaN, infinity, before 1970, 2100 on, and milliseconds passed as seconds.
    for (const bad of [NaN, Infinity, -1, at("2100-01-01T00:00:00Z"), Date.parse("2026-06-01T00:00:00Z")]) {
      expect(() => clock.offsetAt(bad), String(bad)).toThrow(RangeError);
      expect(() => zoneClock("America/Chicago", bad), String(bad)).toThrow(RangeError);
    }
    expect(clock.offsetAt(at("2026-06-01T00:00:00Z")) / HOUR).toBe(-5);
    expect(clock.offsetAt(at("2099-12-31T23:59:59Z")) / HOUR).toBe(-6);
  });

  it("refuses to build a clock for a name that isn't a zone", () => {
    expect(() => zoneClock("Not/AZone", 0)).toThrow(RangeError);
    expect(() => zoneClock("+05:30", 0)).toThrow(RangeError);
  });
});

describe("agreement with an independent reading of the zone", () => {
  /* Each zone's offset as a different formatter reports it, at seeded instants
     in three seeded years from 2002 through 2035, so every zone is checked
     without building all 34 years of all of them (about 17 s). Not
     intlOffset, which the clock is built on. */
  const oracle = (zone: string, uts: number) => {
    const wall = new Date(uts * 1000).toLocaleString("sv-SE", { timeZone: zone, hourCycle: "h23" });
    return (Date.parse(wall.replace(" ", "T") + "Z") - uts * 1000) / 1000;
  };
  const zones = [...Intl.supportedValuesOf("timeZone"), "UTC", "Asia/Kolkata", "Europe/Kyiv"];
  let seed = 0x2b1d;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const YEAR = 365.2425 * 86400;

  it(`agrees in every zone (${zones.length}), at 21 instants each`, () => {
    expect(zones.length).toBeGreaterThan(400);
    const misses: string[] = [];
    let checked = 0;
    for (const zone of zones) {
      for (let y = 0; y < 3; y++) {
        const start = at(`${2002 + Math.floor(rand() * 34)}-01-01T00:00:00Z`);
        const clock = zoneClock(zone, start);
        for (let i = 0; i < 7; i++) {
          const uts = Math.floor(start + rand() * (YEAR - 86400));
          checked++;
          if (clock.offsetAt(uts) !== oracle(zone, uts)) misses.push(`${zone} ${new Date(uts * 1000).toISOString()}`);
        }
      }
    }
    expect(checked).toBe(zones.length * 21);
    expect(misses).toEqual([]);
  }, 20_000);
});

describe("plays don't each ask Intl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks nothing of Intl per play once the clock is built", () => {
    const formats = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    // Years no other test builds, so the clock can't come from the cache.
    const from = at("2090-01-01T00:00:00Z");
    const clock = zoneClock("Pacific/Chatham", from, from + 365 * 86400);
    const built = formats.mock.calls.length;
    expect(built).toBeGreaterThan(0); // the spy sees the clock being built
    for (let i = 0; i < 100_000; i++) clock.nightOf(from + i * 311);
    expect(formats.mock.calls.length).toBe(built);
  });
});

describe("nights run 4 a.m. to 4 a.m. and are named by the date they start", () => {
  const night = (zone: string, iso: string) => nightName(zoneClock(zone, at(iso)).nightOf(at(iso)));

  it("puts a 1 a.m. song on the night before", () => {
    // Saturday 9 May 2026, 1:00 a.m. CDT, is Friday night.
    expect(night("America/Chicago", "2026-05-09T06:00:00Z")).toBe("2026-05-08");
    expect(nightWeekday(zoneClock("America/Chicago", 0).nightOf(at("2026-05-09T06:00:00Z")))).toBe(5);
  });

  it("puts 12 to 4 a.m. on May 11 behind the May 10 door (spec 7.1)", () => {
    expect(night("America/Chicago", "2026-05-11T05:00:00Z")).toBe("2026-05-10"); // 12:00 a.m. CDT
    expect(night("America/Chicago", "2026-05-11T08:59:59Z")).toBe("2026-05-10"); // 3:59:59 a.m.
    expect(night("America/Chicago", "2026-05-11T09:00:00Z")).toBe("2026-05-11"); // 4:00 a.m.
  });

  it("makes Chicago's spring-forward night 23 hours long", () => {
    // Saturday 7 March 2026, 4:00 a.m. CST, to Sunday 4:00 a.m. CDT.
    expect(night("America/Chicago", "2026-03-07T09:59:59Z")).toBe("2026-03-06");
    expect(night("America/Chicago", "2026-03-07T10:00:00Z")).toBe("2026-03-07");
    expect(night("America/Chicago", "2026-03-08T08:59:59Z")).toBe("2026-03-07");
    expect(night("America/Chicago", "2026-03-08T09:00:00Z")).toBe("2026-03-08");
  });

  it("makes Chicago's fall-back night 25 hours long, both 1:30s in it", () => {
    expect(night("America/Chicago", "2026-10-31T08:59:59Z")).toBe("2026-10-30");
    expect(night("America/Chicago", "2026-10-31T09:00:00Z")).toBe("2026-10-31"); // 4:00 a.m. CDT
    expect(night("America/Chicago", "2026-11-01T06:30:00Z")).toBe("2026-10-31"); // 1:30 a.m. CDT
    expect(night("America/Chicago", "2026-11-01T07:30:00Z")).toBe("2026-10-31"); // 1:30 a.m. CST
    expect(night("America/Chicago", "2026-11-01T09:59:59Z")).toBe("2026-10-31");
    expect(night("America/Chicago", "2026-11-01T10:00:00Z")).toBe("2026-11-01"); // 4:00 a.m. CST
  });

  it("makes Sydney's spring-forward night 23 hours and its fall-back night 25", () => {
    // Saturday 3 October 2026, 4:00 a.m. AEST, to Sunday 4:00 a.m. AEDT.
    expect(night("Australia/Sydney", "2026-10-02T17:59:59Z")).toBe("2026-10-02");
    expect(night("Australia/Sydney", "2026-10-02T18:00:00Z")).toBe("2026-10-03");
    expect(night("Australia/Sydney", "2026-10-03T16:59:59Z")).toBe("2026-10-03");
    expect(night("Australia/Sydney", "2026-10-03T17:00:00Z")).toBe("2026-10-04");
    // Saturday 4 April 2026, 4:00 a.m. AEDT, to Sunday 4:00 a.m. AEST.
    expect(night("Australia/Sydney", "2026-04-03T16:59:59Z")).toBe("2026-04-03");
    expect(night("Australia/Sydney", "2026-04-03T17:00:00Z")).toBe("2026-04-04");
    expect(night("Australia/Sydney", "2026-04-04T17:59:59Z")).toBe("2026-04-04");
    expect(night("Australia/Sydney", "2026-04-04T18:00:00Z")).toBe("2026-04-05");
  });

  it("reads a night's weekday and month from the date it starts on", () => {
    const n = (date: string) => at(`${date}T00:00:00Z`) / 86400;
    expect(nightName(n("2026-05-08"))).toBe("2026-05-08");
    expect(nightWeekday(n("1970-01-01"))).toBe(4); // Thursday
    expect(nightWeekday(n("1969-12-31"))).toBe(3); // Wednesday, before the epoch
    expect(nightWeekday(n("2026-05-08"))).toBe(5); // Friday
    expect(nightMonth(n("2026-02-28"))).toBe(1);
    expect(nightMonth(n("2026-03-01"))).toBe(2);
  });
});
