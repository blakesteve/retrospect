import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePathQuery, sampleTimes, skyPath } from "./path";

/* The wheel's path (spec 7.4, 8.11, 18). Longitudes are pinned to JPL
   Horizons (geocentric, apparent, ecliptic of date; the values tonight.test.ts
   pins): Sept 29, 2026, 03:00 UT, Sun 185.997, Moon 37.235, Mercury 208.160,
   Venus 218.161, Mars 120.592, Jupiter 139.253, Saturn 11.725. Venus turns
   retrograde Oct 3, 2026, 07:10 UT (published), 2:09 a.m. CDT, in Scorpio. */

const at = (iso: string) => Date.parse(iso) / 1000;
const HOUR = 3_600;
const DAY = 86_400;
const T0 = at("2026-09-29T03:00:00Z");

const { GET } = await import("@/app/api/sky/path/route");

const call = async (nowIso: string, to: string | number | null) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(nowIso));
  try {
    const res = await GET(new Request(`http://x/api/sky/path${to === null ? "" : `?to=${to}`}`));
    return { status: res.status, cache: res.headers.get("Cache-Control"), body: await res.json() };
  } finally {
    vi.useRealTimers();
  }
};
afterEach(() => vi.useRealTimers());

describe("the wheel's path (spec 18)", () => {
  it("starts at the same longitudes the wheel draws, to 0.01°", () => {
    const p = skyPath(T0, T0 + 2 * DAY);
    const horizons = { sun: 185.997, moon: 37.235, mercury: 208.16, venus: 218.161, mars: 120.592, jupiter: 139.253, saturn: 11.725 };
    for (const [body, lon] of Object.entries(horizons)) {
      const first = p.bodies[body as keyof typeof horizons][0];
      expect(Math.abs(first - lon), body).toBeLessThan(0.02);
      expect(String(first).split(".")[1]?.length ?? 0, body).toBeLessThanOrEqual(2);
    }
    expect(Object.keys(p.bodies)).toEqual(["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"]);
  });

  it("samples the Moon hourly and the rest daily, both ends included: 45 days is 1,081 and 46", () => {
    const p = skyPath(T0, T0 + 45 * DAY);
    expect(p.step).toEqual({ moon: 3600, others: 86400 });
    expect(p.bodies.moon).toHaveLength(1081);
    for (const b of ["sun", "mercury", "venus", "mars", "jupiter", "saturn"] as const) expect(p.bodies[b], b).toHaveLength(46);
  });

  it("ends exactly at `to`, a short last step when it isn't a whole day on", () => {
    expect(sampleTimes(T0, T0 + 2 * DAY + 5 * HOUR, DAY)).toEqual([T0, T0 + DAY, T0 + 2 * DAY, T0 + 2 * DAY + 5 * HOUR]);
    expect(sampleTimes(T0, T0 + 2 * DAY, DAY)).toEqual([T0, T0 + DAY, T0 + 2 * DAY]);
    expect(sampleTimes(T0, T0, DAY)).toEqual([T0]);
    const p = skyPath(T0, T0 + 2 * DAY + 5 * HOUR);
    expect(p.bodies.venus).toHaveLength(4);
    expect(p.bodies.moon).toHaveLength(54);
    // The Moon's last hourly sample and the daily series' last are the same instant.
    expect(skyPath(T0 + 2 * DAY + 5 * HOUR, T0 + 2 * DAY + 5 * HOUR).bodies.moon).toEqual([p.bodies.moon.at(-1)]);
  });

  it("shows Venus slowing to her station and turning back", () => {
    // Daily from Sept 29 to Oct 9, 03:00 UT; she stations Oct 3, 07:10 UT.
    const v = skyPath(T0, T0 + 10 * DAY).bodies.venus;
    const steps = v.slice(1).map((x, i) => Math.round((x - v[i]) * 100) / 100);
    // Forward and slowing, then back and gathering pace.
    expect(steps[0]).toBeGreaterThan(0.1);
    expect(steps.slice(0, 4).every((d, i) => i === 0 || d < steps[i - 1])).toBe(true);
    expect(steps.slice(5).every((d) => d < 0)).toBe(true);
    expect(steps[9]).toBeLessThan(steps[5]);
    // Her farthest point is Oct 3 or 4 at 03:00, the days either side of the station, in Scorpio.
    const top = v.indexOf(Math.max(...v));
    expect([4, 5]).toContain(top);
    expect(v[top]).toBeGreaterThanOrEqual(210);
    expect(v[top]).toBeLessThan(240);
  });
});

describe("GET /api/sky/path", () => {
  it("rounds `from` down to the hour and `to` to the nearest", () => {
    expect(parsePathQuery(String(T0 + HOUR + 29 * 60 + 59), T0 + 59 * 60 + 59)).toEqual({ from: T0, to: T0 + HOUR });
    expect(parsePathQuery(String(T0 + HOUR + 30 * 60), T0 + 30)).toEqual({ from: T0, to: T0 + 2 * HOUR });
  });

  it("serves the path from this hour, cached until the hour turns", async () => {
    const { status, cache, body } = await call("2026-09-29T03:20:00Z", T0 + 2 * DAY + 10 * 60);
    expect(status).toBe(200);
    expect(body.from).toBe(T0);
    expect(body.to).toBe(T0 + 2 * DAY);
    expect(body.bodies.venus).toHaveLength(3);
    expect(Math.abs(body.bodies.venus[0] - 218.161)).toBeLessThan(0.02);
    // 40 minutes left in the hour: the same URL an hour on starts later.
    expect(cache).toBe("public, max-age=2400, s-maxage=2400");
  });

  it("allows a `to` up to 45 days after now, as given, so every coming-up moment is in reach", async () => {
    // From 3:20, a `to` 45 days on rounds to 3:00, exactly 45 days from `from`.
    const exact = await call("2026-09-29T03:20:00Z", at("2026-11-13T03:20:00Z"));
    expect(exact.status).toBe(200);
    expect(exact.body.bodies.moon).toHaveLength(1081);
    // At 3:50 (`from` 3:00), a moment a minute short of 45 days rounds to
    // 4:00 on day 45: 45 days and an hour from `from`, and still served.
    const late = await call("2026-09-29T03:50:00Z", at("2026-11-13T03:49:00Z"));
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ from: T0, to: at("2026-11-13T04:00:00Z") });
    expect(late.body.bodies.moon).toHaveLength(1082);
    expect(late.body.bodies.venus).toHaveLength(47);
    // A minute past 45 days is refused, however it rounds.
    const over = await call("2026-09-29T03:50:00Z", at("2026-11-13T03:51:00Z"));
    expect(over).toMatchObject({ status: 400, body: { code: "invalid", error: "to must be at most 45 days from now" } });
    expect((await call("2026-09-29T03:20:00Z", at("2026-11-13T03:21:00Z"))).status).toBe(400);
  });

  it("refuses a `to` before now, or one that isn't a number", async () => {
    // 2:20 rounds to 2:00, before 3:00. 3:10 rounds to 3:00 itself: one sample each.
    expect((await call("2026-09-29T03:20:00Z", at("2026-09-29T02:20:00Z"))).body).toMatchObject({ code: "invalid", error: "to must not be before now" });
    const same = await call("2026-09-29T03:20:00Z", at("2026-09-29T03:10:00Z"));
    expect(same.status).toBe(200);
    expect(same.body.bodies.moon).toHaveLength(1);
    for (const bad of [null, "", "soon", "1.5", "-3600", "1e9"]) {
      const res = await call("2026-09-29T03:20:00Z", bad);
      expect(res.status, String(bad)).toBe(400);
      expect(res.body.code, String(bad)).toBe("invalid");
    }
  });
});
