import { describe, expect, it } from "vitest";
import { createTrips, type TripState } from "./trips";
import { glyphAngles, separation } from "./wheelLayout";
import type { SkyPath } from "./wheelPath";

/* Spec 8.11 item 1: the wheel's trips, with a hand-cranked frame clock and
   fetches that answer when told to. Each race here was reproduced in
   Chromium by the 3 Oct review before the controller existed. */

const DAY = 86_400;
const T0 = 1_790_000_000;
type Body = { body: string; longitude: number; tag: string };
type Moment = { uts: number; name: string };

const NOW: Body[] = [
  { body: "Sun", longitude: 100, tag: "now" },
  { body: "Moon", longitude: 80, tag: "now" },
];
const atSky = (uts: number): Body[] => [
  { body: "Sun", longitude: 100, tag: `at ${uts}` },
  { body: "Moon", longitude: 80 + ((uts - T0) / DAY) * 100 / 7, tag: `at ${uts}` },
];
/** Seven days: the Sun holds at 100°, the Moon runs from 80° to 180°, passing it. */
const PATH: SkyPath = {
  from: T0,
  to: T0 + 7 * DAY,
  step: { moon: 3600, others: DAY },
  bodies: { sun: Array(8).fill(100), moon: Array.from({ length: 7 * 24 + 1 }, (_, i) => 80 + (i * 100) / (7 * 24)) },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function harness({ reduced = false } = {}) {
  let queue: ((ts: number) => void)[] = [];
  let clock = 0;
  const states: TripState<Body, Moment>[] = [];
  const paths: number[] = [];
  const pending: { uts: number; at: ReturnType<typeof deferred<Body[]>> }[] = [];
  let hold = false;
  const trips = createTrips<Body, Moment>(
    {
      now: { bodies: NOW, uts: T0 },
      getPath: async (to) => {
        paths.push(to);
        return PATH;
      },
      getAt: (uts) => {
        if (!hold) return Promise.resolve(atSky(uts));
        const d = deferred<Body[]>();
        pending.push({ uts, at: d });
        return d.promise;
      },
      reduced: () => reduced,
      raf: (cb) => queue.push(cb),
      cancelRaf: () => {
        queue = [];
      },
    },
    (s) => states.push(s),
  );
  /** Runs `n` frames, 16ms apart. */
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      clock += 16;
      const q = queue;
      queue = [];
      for (const cb of q) cb(clock);
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { trips, states, paths, pending, frames, settle, holdFetches: () => (hold = true), queued: () => queue.length };
}

const A: Moment = { uts: T0 + 7 * DAY, name: "A" };
const B: Moment = { uts: T0 + 3 * DAY, name: "B" };

describe("the wheel's trips (8.11 item 1)", () => {
  it("travels to a moment, ends on that moment's own sky, and counts the arrival", async () => {
    const h = harness();
    const done = h.trips.goTo(A);
    await h.settle();
    h.frames(60);
    expect(await done).toBe(true);
    const s = h.trips.state;
    expect(s.moment).toEqual(A);
    expect(s.arrived).toEqual({ moment: A, n: 1 });
    expect(s.moving).toBe(false);
    expect(s.bodies.map((b) => b.tag)).toEqual([`at ${A.uts}`, `at ${A.uts}`]);
  });

  it("lets the later press win when an earlier answer comes back last", async () => {
    const h = harness();
    h.holdFetches();
    const first = h.trips.goTo(A);
    const second = h.trips.goTo(B);
    await h.settle();
    // B's sky arrives, then A's, late.
    h.pending[1].at.resolve(atSky(B.uts));
    await h.settle();
    h.frames(60);
    h.pending[0].at.resolve(atSky(A.uts));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    h.frames(60);
    expect(h.trips.state.moment).toEqual(B);
    expect(h.trips.state.arrived?.moment).toEqual(B);
  });

  it("stops the trip out at once when Back is pressed, and comes home along the same path with no arrival", async () => {
    const h = harness();
    const out = h.trips.goTo(A);
    await h.settle();
    h.frames(10);
    const turned = h.trips.state.bodies.find((b) => b.body === "Moon")!.longitude;
    expect(turned).toBeGreaterThan(80);
    const home = h.trips.back();
    expect(await out).toBe(false);
    h.frames(1);
    // The first frame home moves toward now, never on toward A.
    expect(h.trips.state.bodies.find((b) => b.body === "Moon")!.longitude).toBeLessThanOrEqual(turned);
    h.frames(80);
    expect(await home).toBe(true);
    expect(h.paths).toHaveLength(1);
    expect(h.states.every((s) => s.arrived === null)).toBe(true);
    expect(h.trips.state.moment).toBeNull();
    expect(h.trips.state.bodies).toBe(NOW);
  });

  it("leaves a newer trip's moment alone when a Back it overtook would have ended", async () => {
    const h = harness();
    const out = h.trips.goTo(A);
    await h.settle();
    h.frames(60);
    await out;
    const home = h.trips.back();
    h.frames(5);
    const again = h.trips.goTo(B);
    expect(await home).toBe(false);
    await h.settle();
    h.frames(80);
    expect(await again).toBe(true);
    expect(h.trips.state.moment).toEqual(B);
  });

  it("jumps under reduced motion, asking for no frames", async () => {
    const h = harness({ reduced: true });
    expect(await h.trips.goTo(A)).toBe(true);
    expect(h.queued()).toBe(0);
    expect(h.states.some((s) => s.moving)).toBe(false);
    expect(h.trips.state.moment).toEqual(A);
  });

  it("never jumps a glyph as the Moon passes the Sun, and lands on the moment's own layout", async () => {
    const h = harness();
    const out = h.trips.goTo(A);
    await h.settle();
    h.frames(60);
    await out;
    const suns = h.states.map((s) => s.glyphs.Sun);
    const steps = suns.slice(1).map((g, i) => Math.abs(((g - suns[i] + 540) % 360) - 180));
    // At the start the two glyphs are nudged apart by about half their
    // separation each; laying them out afresh each frame flipped the Sun's
    // glyph from one side to the other, about a whole separation at once.
    expect(separation("Sun", "Moon")).toBeGreaterThan(20);
    expect(Math.max(...steps)).toBeLessThan(1);
    expect(h.trips.state.glyphs).toEqual(glyphAngles(atSky(A.uts)));
  });

  it("stops asking for frames once disposed", async () => {
    const h = harness();
    void h.trips.goTo(A);
    await h.settle();
    h.frames(3);
    h.trips.dispose();
    const before = h.states.length;
    h.frames(10);
    expect(h.states.length).toBe(before);
  });
});

describe("the glyph layout (8.9)", () => {
  it("leaves a glyph alone that nothing crowds", () => {
    expect(glyphAngles([{ body: "Mars", longitude: 10 }, { body: "Saturn", longitude: 200 }])).toEqual({ Mars: 10, Saturn: 200 });
  });
  it("nudges two crowded glyphs apart evenly, at least their separation", () => {
    const g = glyphAngles([{ body: "Venus", longitude: 50 }, { body: "Mars", longitude: 50 }]);
    expect(Math.abs(g.Mars - g.Venus)).toBeGreaterThanOrEqual(separation("Venus", "Mars"));
    expect((g.Mars + g.Venus) / 2).toBeCloseTo(50, 6);
  });
});
