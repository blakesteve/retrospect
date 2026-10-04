/**
 * The wheel's trips to a moment and back (spec 8.11 item 1), with no React
 * and no DOM: the fetches and the frame clock are passed in, so the races a
 * person can make with two buttons are testable. Tonight wraps it in a hook
 * with paths from the server; the Sky view (8.6) drives it with paths and
 * skies it computes in the browser, through the past as well as the future,
 * and jumps it while the dial is dragged.
 *
 * Every `goTo` and `back` takes a new request number and stops whatever was
 * moving at once. A result that comes back after a newer request is dropped,
 * so the last press always wins. Glyphs are not re-laid each frame (that
 * flips a pair's order as two planets cross, and jumps them): each one's
 * nudge from its true longitude blends from the start's layout to the end's.
 */
import { glyphAngles } from "./wheelLayout";
import { lonAt, nextElapsed, travelAt, travelMs, type SkyPath } from "./wheelPath";

export interface TripBody {
  body: string;
  longitude: number;
}

export interface TripState<B extends TripBody, M extends { uts: number }> {
  /** What the wheel draws: the sky now, a moment, or somewhere between. */
  bodies: B[];
  /** Each glyph's angle. */
  glyphs: Record<string, number>;
  /** Where the wheel is in time (unix seconds): now's moment at now, each
      frame's along a trip; the Sky view's dial follows it (8.6). */
  uts: number;
  moving: boolean;
  /** The moment shown, or being traveled to or from; null at now. */
  moment: M | null;
  /** The last arrival at a moment, numbered so each can pulse; null otherwise. */
  arrived: { moment: M; n: number } | null;
}

export interface TripDeps<B extends TripBody> {
  now: { bodies: B[]; uts: number };
  /** The planets' path over a trip, from `fromUts` to `toUts`, either way
      round: Tonight asks `GET /api/sky/path` for now to the later of the
      two; Sky computes it. */
  getPath: (fromUts: number, toUts: number) => Promise<SkyPath>;
  /** The full sky at a moment, dignities and all (`GET /api/sky/at`). */
  getAt: (uts: number) => Promise<B[]>;
  reduced: () => boolean;
  raf: (cb: (ts: number) => void) => number;
  cancelRaf: (id: number) => void;
}

const wrap = (d: number) => ((((d + 540) % 360) + 360) % 360) - 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const nudges = (bodies: readonly TripBody[], glyphs: Record<string, number>) =>
  Object.fromEntries(bodies.map((b) => [b.body, wrap((glyphs[b.body] ?? b.longitude) - b.longitude)]));

export function createTrips<B extends TripBody, M extends { uts: number }>(deps: TripDeps<B>, emit: (s: TripState<B, M>) => void) {
  const { now } = deps;
  let state: TripState<B, M> = { bodies: now.bodies, glyphs: glyphAngles(now.bodies), uts: now.uts, moving: false, moment: null, arrived: null };
  /** Where the wheel is in time; null at now. */
  let at: number | null = null;
  let request = 0;
  let frame = 0;
  /** The latest trip out's path: from now to at least where the wheel is.
      Gone after a jump, whose moment it may not cover; Back then jumps home. */
  let outbound: SkyPath | null = null;
  let arrivals = 0;
  /** Settles the trip in flight, if one is. */
  let settle: ((arrived: boolean) => void) | null = null;

  const set = (patch: Partial<TripState<B, M>>) => {
    state = { ...state, ...patch };
    emit(state);
  };
  /** Stop whatever is moving, where it is. */
  const halt = () => {
    deps.cancelRaf(frame);
    settle?.(false);
    settle = null;
    if (state.moving) set({ moving: false });
  };

  function travel(id: number, toUts: number, end: B[], path: SkyPath, to: M | null): Promise<boolean> {
    const fromUts = at ?? now.uts;
    const from = nudges(state.bodies, state.glyphs);
    const endGlyphs = glyphAngles(end);
    const into = nudges(end, endGlyphs);
    const finish = () => {
      at = to ? toUts : null;
      set({ bodies: end, glyphs: endGlyphs, uts: toUts, moving: false, moment: to, arrived: to ? { moment: to, n: ++arrivals } : null });
      return true;
    };
    if (deps.reduced()) return Promise.resolve(finish());
    const duration = travelMs(fromUts, toUts);
    let elapsed = 0;
    let last: number | null = null;
    set({ moving: true, arrived: null });
    return new Promise<boolean>((resolve) => {
      settle = resolve;
      const step = (ts: number) => {
        if (id !== request) return;
        elapsed = nextElapsed(elapsed, last, ts);
        last = ts;
        const { t, done } = travelAt(fromUts, toUts, elapsed, duration);
        at = t;
        if (done) {
          settle = null;
          return resolve(finish());
        }
        const k = toUts === fromUts ? 1 : (t - fromUts) / (toUts - fromUts);
        const bodies = now.bodies.map((b) => ({ ...b, longitude: lonAt(path, b.body, t) ?? b.longitude }));
        const glyphs = Object.fromEntries(bodies.map((b) => [b.body, norm(b.longitude + (from[b.body] ?? 0) * (1 - k) + (into[b.body] ?? 0) * k)]));
        set({ bodies, glyphs, uts: t });
        frame = deps.raf(step);
      };
      frame = deps.raf(step);
    });
  }

  return {
    get state() {
      return state;
    },
    /** To a moment; true once there, false if a newer press took over. Waits for `ready` (a scroll) too. */
    async goTo(m: M, ready?: Promise<unknown>): Promise<boolean> {
      const id = ++request;
      halt();
      const [path, end] = await Promise.all([deps.getPath(at ?? now.uts, m.uts), deps.getAt(m.uts), ready]);
      if (id !== request) return false;
      outbound = path;
      set({ moment: m });
      return travel(id, m.uts, end, path, m);
    },
    /** Back to now, along the latest trip out's path; true once there. */
    async back(): Promise<boolean> {
      const id = ++request;
      halt();
      if (at === null || !outbound) {
        at = null;
        set({ bodies: now.bodies, glyphs: glyphAngles(now.bodies), uts: now.uts, moving: false, moment: null, arrived: null });
        return true;
      }
      return travel(id, now.uts, now.bodies, outbound, null);
    },
    /** Straight to a moment and its sky, with no travel and no arrival:
        the dial while it's dragged (8.6). Stops whatever was moving. */
    jump(m: M, bodies: B[]) {
      ++request;
      halt();
      at = m.uts;
      outbound = null;
      // Laid out afresh each time. The Sky wheel draws each planet on its own
      // orbit at its true longitude and reads no glyph angles; a wheel that
      // does would see a pair swap at a conjunction mid-drag.
      set({ bodies, glyphs: glyphAngles(bodies), uts: m.uts, moving: false, moment: m, arrived: null });
    },
    dispose() {
      request++;
      deps.cancelRaf(frame);
      settle = null;
    },
  };
}
