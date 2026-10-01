import { describe, expect, it } from "vitest";
import { Body, Observer, SearchRiseSet, SunPosition, MakeTime } from "astronomy-engine";
import { ascendantLongitude, computeNatalChart, signOfLongitude } from "./natal";

describe("signOfLongitude", () => {
  it("maps longitudes to tropical signs", () => {
    expect(signOfLongitude(0)).toBe("Aries");
    expect(signOfLongitude(29.9)).toBe("Aries");
    expect(signOfLongitude(30)).toBe("Taurus");
    expect(signOfLongitude(359)).toBe("Pisces");
    expect(signOfLongitude(-10)).toBe("Pisces"); // wraps
  });
});

describe("computeNatalChart", () => {
  it("gets well-known sun signs right", () => {
    // Solstices/equinoxes are the anchors of the tropical zodiac.
    expect(computeNatalChart(new Date("2000-03-21T12:00:00Z")).sun.sign).toBe("Aries");
    expect(computeNatalChart(new Date("2000-06-22T12:00:00Z")).sun.sign).toBe("Cancer");
    expect(computeNatalChart(new Date("2000-09-24T12:00:00Z")).sun.sign).toBe("Libra");
    expect(computeNatalChart(new Date("2000-12-23T12:00:00Z")).sun.sign).toBe("Capricorn");
  });

  it("omits rising without coordinates", () => {
    expect(computeNatalChart(new Date("1990-05-05T05:05:00Z")).rising).toBeNull();
  });
});

describe("ascendantLongitude", () => {
  it("approximately equals the Sun's longitude at sunrise (the defining property)", () => {
    // At sunrise the Sun sits on the eastern horizon — so the ascendant IS
    // (approximately) the Sun. Check several dates and latitudes.
    const cases = [
      { lat: 41.88, lon: -87.63, date: "2015-04-10" }, // Chicago
      { lat: 51.51, lon: -0.13, date: "2020-10-01" }, // London
      { lat: -33.87, lon: 151.21, date: "2018-01-15" }, // Sydney
    ];
    for (const c of cases) {
      const observer = new Observer(c.lat, c.lon, 0);
      const sunrise = SearchRiseSet(Body.Sun, observer, +1, MakeTime(new Date(c.date + "T00:00:00Z")), 2);
      expect(sunrise).toBeTruthy();
      const sunLon = SunPosition(sunrise!).elon;
      const asc = ascendantLongitude(sunrise!.date, c.lat, c.lon);
      let diff = Math.abs(asc - sunLon);
      if (diff > 180) diff = 360 - diff;
      // Refraction + horizon definition put sunrise slightly off the true
      // horizon crossing; a couple of degrees is expected and sign-safe.
      expect(diff).toBeLessThan(3);
    }
  });
});
