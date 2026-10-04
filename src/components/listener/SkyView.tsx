"use client";

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button, Card } from "@blakesteve/roster";
import { createTrips, type TripState } from "@/lib/motion/trips";
import { nextElapsed } from "@/lib/motion/wheelPath";
import { ninePm, zoneClock } from "@/lib/zone";
import { dateText, WEEKDAYS, weekdayOf } from "@/lib/client/dates";
import {
  dialKey,
  dialValueText,
  marksByNight,
  moonWaveOpacity,
  nightAt,
  offsetOf,
  OPENING_MS,
  openingLongitude,
  openingSpiral,
  playAt,
  playsAround,
  playStart,
  playsWave,
  pulseWidth,
  REDUCED_STEP_MS,
  snapTarget,
  spaced,
  sparkles,
  spiralRadius,
  starSize,
  type DialNight,
} from "@/lib/client/dial";
import { buildSpiral, spiralAt, spiralPieces, spiralStrokes, TAIL_SECONDS } from "@/lib/client/spiral";
import { NATAL_EVENT, readStoredBirth } from "@/lib/client/natalStore";
import { useListener, VIEW_HEADING } from "./Shell";
import { getJson, type DialData, type Dignity, type Planet } from "./api";
import { SkyOrbits, RR, type SkySpiral, type SkyStar } from "./SkyOrbits";
import { TimeDial } from "./TimeDial";
import { DIGNITY_COLOR, SIGNS, WheelKey } from "./sky";
import { SheetLink } from "./cards";
import { ForYou } from "./forYou";
import { CompareCard, QuestionsGrid } from "./shared";
import { prefersReducedMotion, usePauseWhenHidden, useSeen } from "./media";
import { RowFailed } from "./pieces";
import { sheetFrom } from "./sheetUrl";

/* Sky (spec 8.6): the wheel with your songs as stars, and a dial that moves
   the sky through every night of your history. The wheel's first frame is
   tonight's sky from the server; the rest is computed in the browser by the
   one sky module (7.2), which loads just after the first paint (13). Moving
   the dial travels as Tonight's wheel does (`trips.ts`, 8.11): a drag jumps
   night by night, a key, a tap or a button travels there. */

type Compute = typeof import("@/lib/client/skyCompute");
type Load<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; data: T };
type Moment = { uts: number; i: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sky module, fetched once the view has painted; whether it failed, and a way to ask again. */
function useSkyCompute(): [Compute | null, boolean, () => void] {
  const [got, setGot] = useState<{ tries: number; mod: Compute | null; failed: boolean }>({ tries: 0, mod: null, failed: false });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    import("@/lib/client/skyCompute").then(
      (m) => live && setGot({ tries, mod: m, failed: false }),
      // The chunk didn't come: the wheel stays at tonight, and says so.
      () => live && setGot({ tries, mod: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [tries]);
  return [got.mod, got.failed && got.tries === tries, () => setTries((t) => t + 1)];
}

/** Every night's plays and events, for the dial (the dial route). */
function useDialData(): [Load<DialData>, () => void] {
  const L = useListener();
  const url = L.listenerUrl("dial");
  const [tries, setTries] = useState(0);
  const key = `${url}#${tries}`;
  const [got, setGot] = useState<{ key: string; load: Load<DialData> } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      for (let i = 0; i < 30 && live; i++) {
        const d = await getJson<DialData | { status: "computing"; zone: string }>(url);
        if (d.status !== "computing") return d as DialData;
        await sleep(2000);
      }
      throw new Error("still computing");
    })().then(
      (data) => live && setGot({ key, load: { state: "ready", data } }),
      () => live && setGot({ key, load: { state: "failed" } }),
    );
    return () => {
      live = false;
    };
  }, [url, key]);
  return [got?.key === key ? got.load : { state: "loading" }, () => setTries((t) => t + 1)];
}

/** The wheel's width: the column's, at most 440px (10: 343px at 375). */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(343);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.min(440, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const FLASH_ORDER = ["eclipse", "storm", "flare", "asteroid"] as const;
type Flash = { kind: (typeof FLASH_ORDER)[number]; n: number };
/** The fewest milliseconds between two flashes, or two pulses: a drag, a
    trip or Play crosses a night most frames, and a flash every frame never
    fades (8.11: motion means something). */
const FLASH_GAP_MS = 500;
const clockMs = () => performance.now();

/** Below the dial (8.6 item 6): read from the shell's data, so a dial frame never redraws it. */
const BelowTheDial = memo(function BelowTheDial() {
  return (
    <>
      <ForYou />
      <QuestionsGrid />
      <CompareCard />
    </>
  );
});

/** The wheel opens once a visit (8.11), as the Orrery did: the planets
    wind back into place, the spiral draws in from your first night, and the
    stars fly in and twinkle. Not again on a return from a sheet or a view,
    not when a sheet opened the page, and never under reduced motion. */
let skyOpened = false;
/** The longest the opening holds the planets for the stars before going without them. */
const OPENING_WAIT_MS = 1500;
/** The stars' flight and twinkle end on their own by then (globals.css: 4.8s at most). */
const OPENING_STARS_MS = 5000;
/** A frame's longest step: a slow device's frames still count in full, a hidden tab's gap doesn't. */
const OPENING_FRAME_MS = 250;
const ORDER = ["Moon", "Mercury", "Venus", "Sun", "Mars", "Jupiter", "Saturn"];
type Opening = {
  hold: boolean;
  p: number;
  stars: boolean;
  /** The pointer press that ended it, by its time stamp: that press only stops the motion. */
  endedBy: RefObject<number | null>;
};

/** Where the opening is: holding (the planets here, the stars on their way,
    or the wheel not yet on screen), running (p from 0 to 1), or done. Any
    input ends it at once, the stars' flight and twinkle too, except while
    the reveal is over the page: its keys and taps are its own. */
function useOpening(planets: boolean, all: boolean, starsHere: boolean, seen: boolean, revealOpen: boolean): Opening {
  const [eligible] = useState(
    () => !skyOpened && typeof window !== "undefined" && sheetFrom(new URLSearchParams(window.location.search)) === null && !prefersReducedMotion(),
  );
  const [o, setO] = useState<{ at: "wait" | "run" | "done"; p: number; stars: boolean }>({ at: eligible ? "wait" : "done", p: 1, stars: false });
  const endedBy = useRef<number | null>(null);
  useEffect(() => {
    // Only once it's on screen (8.11).
    if (o.at !== "wait" || !planets || !seen || revealOpen) return;
    const t = window.setTimeout(
      () => {
        skyOpened = true;
        setO({ at: "run", p: 0, stars: starsHere });
      },
      all ? 0 : OPENING_WAIT_MS,
    );
    return () => clearTimeout(t);
  }, [o.at, planets, all, starsHere, seen, revealOpen]);
  useEffect(() => {
    if (o.at !== "run") return;
    let elapsed = 0;
    let last: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      // Held while the tab is hidden.
      elapsed += last === null ? 0 : Math.min(OPENING_FRAME_MS, Math.max(0, ts - last));
      last = ts;
      const p = Math.min(1, elapsed / OPENING_MS);
      setO((x) => (x.at === "run" ? { ...x, at: p >= 1 ? "done" : "run", p } : x));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [o.at]);
  useEffect(() => {
    if (!o.stars) return;
    const t = window.setTimeout(() => setO((x) => ({ ...x, stars: false })), OPENING_STARS_MS);
    return () => clearTimeout(t);
  }, [o.stars]);
  useEffect(() => {
    if ((o.at === "done" && !o.stars) || revealOpen) return;
    // Only a press while the planets move is swallowed; once they rest, a tap is a tap.
    const moving = o.at !== "done";
    const end = (e: Event) => {
      skyOpened = true;
      if (moving && e.type === "pointerdown") endedBy.current = e.timeStamp;
      setO({ at: "done", p: 1, stars: false });
    };
    window.addEventListener("keydown", end, true);
    window.addEventListener("pointerdown", end, true);
    window.addEventListener("wheel", end, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", end, true);
      window.removeEventListener("pointerdown", end, true);
      window.removeEventListener("wheel", end, true);
    };
  }, [o.at, o.stars, revealOpen]);
  if (!planets || o.at === "done") return { hold: false, p: 1, stars: o.stars, endedBy };
  return o.at === "wait" ? { hold: true, p: 0, stars: false, endedBy } : { hold: false, p: o.p, stars: o.stars, endedBy };
}

export function SkyView() {
  const L = useListener();
  usePauseWhenHidden();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  // The wheel at the moment the page loaded (8.6, "Tonight").
  const nowSky = useMemo(() => (sky ? { bodies: sky.sky.bodies, uts: Math.floor(Date.parse(sky.sky.at) / 1000) } : null), [sky]);
  const [compute, computeFailed, retryCompute] = useSkyCompute();
  const [dial, retryDial] = useDialData();
  const d = dial.state === "ready" && dial.data.first && dial.data.plays.length > 0 ? dial.data : null;
  const n = d?.plays.length ?? 0;
  const first = d?.first ?? null;
  const [wheelRef, wheelSize] = useWidth();

  /* ---- Nights and their moments ---- */
  // 9 p.m. on each night's date (7.4), and tonight is the page's own moment,
  // in the zone the dial route cut the nights in (its fallback included): a
  // link's tz the browser takes and the server refuses can't crash the view.
  const zone = d?.zone ?? null;
  const clock = useMemo(() => {
    if (!first || !nowSky || !zone) return null;
    try {
      const from = Date.parse(`${first}T00:00:00Z`) / 1000 - 2 * 86_400;
      return zoneClock(zone, from, nowSky.uts + 2 * 86_400);
    } catch {
      return null;
    }
  }, [first, nowSky, zone]);
  const night0 = first ? Math.round(Date.parse(`${first}T00:00:00Z`) / 86_400_000) : 0;
  const momentUts = (i: number) => (i >= n - 1 && nowSky ? nowSky.uts : clock ? ninePm(clock, night0 + i) : 0);
  const moment = (i: number): Moment => ({ uts: momentUts(i), i });
  /** A fraction of a night as an instant, between its two 9 p.m.s. */
  const momentAt = (p: number): number => {
    const a = Math.floor(p);
    const b = Math.min(n - 1, a + 1);
    return momentUts(a) + (momentUts(b) - momentUts(a)) * (p - a);
  };
  /** Where an instant sits on the dial, a fraction of a night. */
  const posOf = (uts: number): number => {
    if (n <= 1 || !clock) return Math.max(0, n - 1);
    const m2 = momentUts(n - 2);
    const m1 = momentUts(n - 1);
    if (uts >= m2) return Math.min(n - 1, n - 2 + (m1 > m2 ? (uts - m2) / (m1 - m2) : 1));
    return Math.max(0, (uts - momentUts(0)) / 86_400);
  };
  const byNight = useMemo(() => (d ? marksByNight(d.marks) : new Map<number, DialNight>()), [d]);
  const wild = useMemo(() => d?.marks.wild ?? [], [d]);
  const headlines = useMemo(() => wild.filter((w) => w[3]).map((w) => w[0]), [wild]);

  /* ---- The stars: the songs row's set (7.5), placed once the sky module is here ---- */
  const songs = useMemo(() => (L.songs.state === "ready" ? (L.songs.data.row ?? []) : []), [L.songs]);
  const startUts = clock ? clock.nightStart(night0) : null;
  const stars = useMemo<(SkyStar & { offset: number; title: string })[]>(() => {
    if (!compute || !nowSky || startUts === null || !first) return [];
    const max = Math.max(1, ...songs.filter((s) => !s.firstScrobble).map((s) => s.plays));
    return songs.map((s) => ({
      id: s.songId,
      angle: compute.sunLongitude(s.firstPlayUts),
      r: spiralRadius(s.firstPlayUts, startUts, nowSky.uts, RR.si, RR.so),
      size: s.firstScrobble ? 3.6 : starSize(s.plays, max),
      name: `${s.track} by ${s.artist}, ${s.firstScrobble ? "your first scrobble" : "first played"} ${s.firstPlayDate} at ${s.firstPlayTime}`,
      origin: s.firstScrobble,
      // The Orrery's: a sparkle over 100 plays of its most played 212.
      sparkle: !s.firstScrobble && sparkles(s.plays, max),
      offset: offsetOf(first, s.firstNight),
      title: s.track,
    }));
  }, [compute, nowSky, startUts, first, songs]);
  /** The spiral, the Sun's place as the history ran, smooth at any length. */
  const spiralGeo = useMemo(
    () => (compute && nowSky && startUts !== null ? buildSpiral(startUts, nowSky.uts, compute.sunLongitude, RR.si, RR.so) : null),
    [compute, nowSky, startUts],
  );
  const starNights = useMemo(() => (first ? songs.map((s) => offsetOf(first, s.firstNight)) : []), [first, songs]);

  /* ---- The wheel's travel ---- */
  const [trip, setTrip] = useState<TripState<Planet, Moment> | null>(null);
  const trips = useMemo(() => {
    if (!compute || !nowSky) return null;
    return createTrips<Planet, Moment>(
      {
        now: nowSky,
        getPath: (a, b) => Promise.resolve(compute.skyPath(a, b)),
        getAt: (uts) => Promise.resolve(compute.skyBodies(uts)),
        reduced: prefersReducedMotion,
        raf: (cb) => requestAnimationFrame(cb),
        cancelRaf: (id) => cancelAnimationFrame(id),
      },
      setTrip,
    );
  }, [compute, nowSky]);
  useEffect(() => () => trips?.dispose(), [trips]);
  const state = trip ?? trips?.state ?? null;
  // Mid-trip a planet carries the sky it set off from; its halo follows its
  // sign as it goes, and the retrograde mark waits for the end, where the sky is exact.
  const bodies = useMemo(() => {
    const raw = state?.bodies ?? nowSky?.bodies ?? [];
    if (!state?.moving || !compute) return raw;
    return raw.map((b) => {
      const sign = compute.signOf(b.longitude);
      return { ...b, sign, dignity: compute.haloDignity(b.body as Parameters<Compute["haloDignity"]>[0], sign) as Dignity, retrograde: false };
    });
  }, [state, nowSky, compute]);
  // A fifth on screen will do: a landscape phone may never show half of it.
  const wheelSeen = useSeen(wheelRef, bodies.length > 0, 0.2);
  const opening = useOpening(
    bodies.length > 0,
    Boolean(compute || computeFailed) && dial.state !== "loading" && L.songs.state !== "loading",
    stars.length > 0,
    wheelSeen,
    L.revealOpen,
  );
  // While it opens, each planet winds back into its place (8.11).
  const shown = useMemo(
    () => (opening.p >= 1 ? bodies : bodies.map((b) => ({ ...b, longitude: openingLongitude(b.longitude, Math.max(0, ORDER.indexOf(b.body)), opening.p) }))),
    [bodies, opening.p],
  );
  const pos = state && d ? posOf(state.uts) : Math.max(0, n - 1);
  // Where the dial stands: where a trip is going while it travels, so a key
  // pressed mid-trip steps from there, and that's what the dial says (11).
  const at = state?.moving && state.moment ? state.moment.i : Math.round(pos);

  // The nights the dial crossed since the last frame flash their events,
  // pulse their plays and light their stars (8.6); never under reduced
  // motion. Worked out as the night changes, while rendering.
  const [fx, setFx] = useState<{
    seen: number | null;
    flash: Flash | null;
    flashAt: number;
    lit: { id: string; title: string; n: number } | null;
    pulse: number;
    pulseAt: number;
  }>({ seen: null, flash: null, flashAt: -Infinity, lit: null, pulse: 0, pulseAt: -Infinity });
  const night = d && state ? Math.round(pos) : null;
  if (night !== fx.seen) {
    const prev = fx.seen;
    const next = { ...fx, seen: night };
    if (prev !== null && night !== null && d && !prefersReducedMotion()) {
      const dir = night > prev ? 1 : -1;
      let kind: Flash["kind"] | null = null;
      let star: { id: string; title: string } | null = null;
      let played = false;
      for (let k = prev + dir, steps = 0; dir > 0 ? k <= night : k >= night; k += dir) {
        if (++steps > 1200) break;
        const m = byNight.get(k);
        const here = m ? (m.eclipse ? "eclipse" : m.storm ? "storm" : m.xflare ? "flare" : m.asteroid ? "asteroid" : null) : null;
        if (here && (kind === null || FLASH_ORDER.indexOf(here) < FLASH_ORDER.indexOf(kind))) kind = here;
        if (d.plays[k] > 0) played = true;
        const s = stars.find((x) => x.offset === k);
        if (s) star = { id: s.id, title: s.title };
      }
      const t = clockMs();
      if (kind && t - fx.flashAt >= FLASH_GAP_MS) Object.assign(next, { flash: { kind, n: (fx.flash?.n ?? 0) + 1 }, flashAt: t });
      if (star) next.lit = { ...star, n: (fx.lit?.n ?? 0) + 1 };
      if (played && t - fx.pulseAt >= FLASH_GAP_MS) Object.assign(next, { pulse: fx.pulse + 1, pulseAt: t });
    }
    setFx(next);
  }

  /* ---- Moving the dial ---- */
  const [card, setCard] = useState<number | null>(null);
  const ready = Boolean(trips && d && clock);
  const go = (i: number, how: "key" | "tap" | "wild" | "back") => {
    if (!trips || !ready) return;
    setCard(null);
    void trips.goTo(moment(i)).then((arrived) => {
      if (arrived && how === "wild") setCard(i);
    });
  };
  const jump = (p: number) => {
    if (!trips || !compute || !ready) return;
    const uts = momentAt(p);
    trips.jump({ uts, i: Math.round(p) }, compute.skyBodies(uts));
  };
  const release = (i: number) => {
    // Letting go within 6 nights of a wild night snaps to it (8.6).
    const w = snapTarget(
      i,
      wild.map((x) => x[0]),
    );
    if (w === null) return;
    if (w === i) setCard(w);
    else go(w, "wild");
  };

  /* ---- Play your years (8.6, 11): 15 seconds, any input stops it ---- */
  const [playing, setPlaying] = useState(false);
  const play = useRef<{ raf: number; timer: number } | null>(null);
  const stop = () => {
    if (!play.current) return;
    cancelAnimationFrame(play.current.raf);
    clearInterval(play.current.timer);
    play.current = null;
    setPlaying(false);
  };
  const start = () => {
    if (!ready || !first) return;
    setCard(null);
    const from = playStart(at, n);
    jump(from);
    setPlaying(true);
    if (prefersReducedMotion()) {
      // A month a second, as jumps (11).
      let i = from;
      const timer = window.setInterval(() => {
        // Held while the tab is hidden (8.11).
        if (document.hidden) return;
        i = dialKey("PageUp", false, i, n, first) ?? n - 1;
        jump(i);
        if (i >= n - 1) stop();
      }, REDUCED_STEP_MS);
      play.current = { raf: 0, timer };
      return;
    }
    let elapsed = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      elapsed = nextElapsed(elapsed, last, ts);
      last = ts;
      const p = playAt(from, n, elapsed);
      jump(p);
      if (p >= n - 1) stop();
      else if (play.current) play.current.raf = requestAnimationFrame(step);
    };
    play.current = { raf: requestAnimationFrame(step), timer: 0 };
  };
  useEffect(() => {
    if (!playing) return;
    // Any input stops it, anywhere on the page, except a press of the button
    // that toggles it (a click, or Enter or Space, which click it).
    const any = (e: Event) => {
      const onPlay = Boolean((e.target as Element | null)?.closest?.("[data-play]"));
      const presses = e.type === "pointerdown" || (e instanceof KeyboardEvent && (e.key === "Enter" || e.key === " "));
      if (onPlay && presses) return;
      stop();
    };
    window.addEventListener("keydown", any, true);
    window.addEventListener("pointerdown", any, true);
    window.addEventListener("wheel", any, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", any, true);
      window.removeEventListener("pointerdown", any, true);
      window.removeEventListener("wheel", any, true);
    };
  }, [playing]);
  useEffect(() => () => stop(), []);

  const nextWild = () => {
    if (headlines.length === 0) return;
    const after = headlines.find((w) => w > at) ?? headlines[0];
    go(after, "wild");
  };

  /* ---- A planet selected: the sectors by its standing in each sign (8.6) ---- */
  const [selected, setSelected] = useState<string | null>(null);
  const tints = useMemo(() => {
    if (!selected || !compute) return null;
    return Object.fromEntries(
      SIGNS.map((s) => [s, compute.haloDignity(selected as Parameters<Compute["haloDignity"]>[0], s as Parameters<Compute["haloDignity"]>[1]) as Dignity]),
    );
  }, [selected, compute]);
  const legend = tints ? (["home", "exalted", "detriment", "fall"] as const).filter((dg) => Object.values(tints).includes(dg)) : [];

  /* ---- Your birth chart, from this browser only (8.6 item 5) ---- */
  const [natal, setNatal] = useState<{ body: string; longitude: number }[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      const birth = readStoredBirth();
      if (!birth) {
        setNatal(null);
        return;
      }
      import("@/lib/astro/natal").then((m) => {
        const c = live ? m.chartFromBirth(birth) : null;
        if (!c || !live) return;
        setNatal([
          { body: "Sun", longitude: c.sun.longitude },
          { body: "Moon", longitude: c.moon.longitude },
          { body: "Mercury", longitude: c.mercury.longitude },
          { body: "Venus", longitude: c.venus.longitude },
          { body: "Mars", longitude: c.mars.longitude },
        ]);
      });
    };
    read();
    window.addEventListener(NATAL_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(NATAL_EVENT, read);
    };
  }, []);

  /* ---- What the wheel and dial show ---- */
  const nightDate = first ? nightAt(first, at) : null;
  const isTonight = n > 0 && at === n - 1;
  const moonPhase = compute && state ? compute.moonPhase(state.uts) : (sky?.sky.moon.phaseAngle ?? null);
  const day = nightDate ? { dow: WEEKDAYS[weekdayOf(nightDate)].slice(0, 3).toUpperCase(), date: dateText(nightDate).replace(/, \d{4}$/, "") } : null;
  // The spiral to the dial's moment, its last year brightening to a comet
  // there; while the wheel opens, drawn in from the first night.
  const strokes = useMemo(() => (spiralGeo ? spiralStrokes(spiralGeo.gap) : null), [spiralGeo]);
  const spiral = useMemo<SkySpiral | null>(() => {
    if (!spiralGeo || !strokes) return null;
    const moment = state?.uts ?? spiralGeo.to;
    const tip = opening.p >= 1 ? moment : spiralGeo.from + (moment - spiralGeo.from) * openingSpiral(opening.p);
    const head = spiralAt(spiralGeo, tip);
    return {
      d: spiralGeo.d,
      length: spiralGeo.length,
      done: head.along,
      strokes,
      tail: spiralPieces(spiralGeo, Math.max(spiralGeo.from, tip - TAIL_SECONDS), tip, 10),
      head: { x: head.x, y: head.y },
    };
  }, [spiralGeo, strokes, state?.uts, opening.p]);
  // The ring around the center, as wide as the drawn night's plays.
  const playsTop = useMemo(() => {
    const played = (d?.plays ?? []).filter((p) => p > 0).sort((a, b) => a - b);
    return played.length ? played[Math.floor(0.98 * (played.length - 1))] : 1;
  }, [d]);
  const pulse = { width: d && night !== null ? pulseWidth(playsAround(d.plays, night, Boolean(state?.moving) || playing), playsTop) : 1.2, n: fx.pulse };
  const valueText = (i: number) => (first && d ? dialValueText(nightAt(first, i), d.plays[i] ?? 0, byNight.get(i), i === n - 1) : "");
  const usual = (date: string) => d?.usual[weekdayOf(date)] ?? null;
  const cardNight =
    card !== null && first && d ? { date: nightAt(first, card), plays: d.plays[card], title: wild.find((w) => w[0] === card)?.[2] ?? "" } : null;

  return (
    <div className="mt-4">
      <h1 id={VIEW_HEADING} tabIndex={-1} className="sr-only">
        Sky
      </h1>

      <div ref={wheelRef}>
        <SkyOrbits
          size={wheelSize}
          bodies={shown}
          moonPhase={moonPhase}
          day={day}
          stars={stars}
          spiral={spiral}
          natal={natal ?? []}
          selected={selected}
          tints={tints}
          onPlanet={(body) => {
            setSelected(body);
            L.open({ kind: "planet", value: body.toLowerCase() });
          }}
          onStar={(id) => L.open({ kind: "song", value: id })}
          lit={fx.lit}
          flash={fx.flash}
          pulse={pulse}
          opening={opening}
          playing={playing}
        />
      </div>
      {bodies.length > 0 && <WheelKey bodies={bodies} className="mt-2" />}
      {L.songs.state === "failed" && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-[14px] text-ink-2">Your songs didn&rsquo;t load.</p>
          <Button size="lg" variant="outline" onClick={L.retryData}>
            Try again
          </Button>
        </div>
      )}
      {L.skyNow.state === "failed" && (
        <div className="mt-2">
          <RowFailed name="Tonight's sky" />
        </div>
      )}
      {computeFailed && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-[14px] text-ink-2">The sky for your nights didn&rsquo;t load.</p>
          <Button size="lg" variant="outline" onClick={retryCompute}>
            Try again
          </Button>
        </div>
      )}
      {selected && tints && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-[var(--line)] bg-surface-2 px-3 py-2 text-[13px] text-ink-2"
          data-legend
        >
          <span className="text-ink">{selected === "Sun" || selected === "Moon" ? `The ${selected}'s` : `${selected}'s`} standing in each sign:</span>
          {legend.map((dg) => (
            <span key={dg} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: DIGNITY_COLOR[dg] ?? undefined }} />
              {dg === "home" ? "At home" : dg === "exalted" ? "Exalted" : dg === "detriment" ? "In detriment" : "In fall"}
            </span>
          ))}
          <Button
            size="lg"
            variant="link"
            className="ml-auto"
            onClick={() => {
              const was = selected;
              setSelected(null);
              // The legend goes with it: focus returns to the planet (11).
              requestAnimationFrame(() => document.querySelector<SVGGElement>(`[data-sky-wheel] [data-body="${was}"]`)?.focus());
            }}
          >
            Clear
          </Button>
        </div>
      )}

      {/* The dial (8.6 item 3): a readout, then the track. */}
      <section aria-label="Your nights" className="mt-4">
        {dial.state === "failed" ? (
          <div className="flex flex-wrap items-center gap-3 py-4">
            <p className="text-[15px] text-ink-2">Your nights didn&rsquo;t load.</p>
            <Button size="lg" variant="outline" onClick={retryDial}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <div aria-hidden className="flex h-[58px] flex-col justify-center overflow-hidden">
              {nightDate ? (
                <>
                  <p className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className="font-display text-[20px] text-ink">{`${WEEKDAYS[weekdayOf(nightDate)]}, ${dateText(nightDate)}`}</span>
                    {isTonight && <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold">Tonight</span>}
                  </p>
                  <p className="truncate text-[13.5px] text-ink-2">{valueText(at).replace(/^[^:]*: /, "")}</p>
                </>
              ) : (
                <div className="skeleton h-10 w-2/3" />
              )}
            </div>
            <TimeDial
              count={n}
              value={pos}
              at={at}
              label="Move through your nights"
              valueText={valueText}
              keyStep={(key, shift, i) => (first ? dialKey(key, shift, i, n, first) : null)}
              onDrag={(i) => {
                setCard(null);
                jump(i);
              }}
              onRelease={release}
              onGo={(i, how) => go(i, how)}
              onInput={stop}
              disabled={!ready}
              track={(w) => (
                <DialTrack
                  width={w}
                  data={d}
                  compute={compute}
                  momentAt={momentAt}
                  moments={clock && nowSky ? nowSky.uts : null}
                  first={first}
                  stars={starNights}
                />
              )}
            />
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button size="lg" variant="outline" onClick={nextWild} disabled={!ready || headlines.length === 0}>
                Jump to a wild night
              </Button>
              <Button size="lg" variant="outline" onClick={() => go(n - 1, "back")} disabled={!ready}>
                Back to tonight
              </Button>
            </div>
            <Button size="lg" variant="outline" className="mt-2 w-full" onClick={() => (playing ? stop() : start())} disabled={!ready} data-play>
              {playing ? "Pause" : "Play your years"}
            </Button>
            <div aria-live="polite" className="mt-3">
              {cardNight && (
                <Card padding="none" className="sky-card p-3" data-snap>
                  <p className="font-display text-[17px] leading-snug text-ink">{cardNight.title}</p>
                  <p className="mt-0.5 text-[13.5px] text-ink-2">
                    {`${WEEKDAYS[weekdayOf(cardNight.date)]}, ${dateText(cardNight.date)} · ${cardNight.plays} ${cardNight.plays === 1 ? "play" : "plays"}`}
                    {usual(cardNight.date) !== null && ` · a usual ${WEEKDAYS[weekdayOf(cardNight.date)]} is ${usual(cardNight.date)}`}
                  </p>
                  <Button size="lg" className="mt-2" onClick={() => L.open({ kind: "night", value: cardNight.date })}>
                    Open this night
                  </Button>
                </Card>
              )}
            </div>
          </>
        )}
      </section>

      <p className="mt-6">
        <SheetLink to={{ kind: "chart", value: "you" }} className="inline-flex min-h-11 items-center text-[15px] text-gold underline underline-offset-4">
          {natal ? "Your chart" : "Add your birth chart"}
        </SheetLink>
      </p>

      <BelowTheDial />
    </div>
  );
}

/** The dial's track (8.6 item 3), the Orrery's: a tick over every wild night
    (the dial snaps to each) and a mark over the wildest, and a sparkle at
    each song's first play; then, in the track itself, each
    year, plays per night as a smoothed waveform with the Moon's light as a
    wave along its foot; and under it, ticks for storms and X-flares and a
    dot for each eclipse. A long history gathers its nights into the column
    they fall in. */
function DialTrack({
  width,
  data,
  compute,
  momentAt,
  moments,
  first,
  stars,
}: {
  width: number;
  data: DialData | null;
  compute: Compute | null;
  momentAt: (p: number) => number;
  /** Set once the nights' moments can be read (the zone's clock and tonight's sky are here); null before. */
  moments: number | null;
  first: string | null;
  stars: number[];
}) {
  const n = data?.plays.length ?? 0;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width);
  const cols = Math.max(2, Math.min(n, Math.floor(width)));
  const area = useMemo(() => {
    if (!data || n < 2) return null;
    const h = playsWave(data.plays, cols);
    const k = h.length;
    // A column's center: its own night, or the middle of the nights it gathers.
    const cx = (c: number) => (k === n ? (c / (n - 1)) * width : Math.min(width, Math.max(0, (((c + 0.5) * n) / k - 0.5) / (n - 1)) * width));
    return `M0 62${h.map((v, c) => `L${cx(c).toFixed(1)} ${(62 - v * 28).toFixed(1)}`).join("")}L${width.toFixed(1)} 62Z`;
  }, [data, width, cols, n]);
  // The Moon's light along the waveform's foot, once the sky module is here:
  // a dozen samples a month, and drawn only while its months can be told apart.
  const moonOpacity = moonWaveOpacity(n, width);
  const moonShown = moonOpacity > 0;
  const moon = useMemo(() => {
    if (!data || !compute || moments === null || n < 2 || !moonShown) return null;
    const k = Math.min(2000, Math.max(cols, Math.ceil((n / 29.53) * 12)));
    return Array.from({ length: k }, (_, j) => {
      const p = (j / (k - 1)) * (n - 1);
      const lit = compute.moonLight(momentAt(p));
      return `${j ? "L" : "M"}${((j / (k - 1)) * width).toFixed(1)} ${(62 - lit * 8).toFixed(1)}`;
    }).join("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the data, width and module
  }, [data, compute, moments, width, cols, n, moonShown]);
  // Each year's line, labeled where there's room for it.
  const years = useMemo(() => {
    if (!first || n < 2) return [];
    const out: { i: number; y: string; label: boolean }[] = [];
    let lastLabel = -Infinity;
    for (let y = Number(first.slice(0, 4)) + 1; ; y++) {
      const i = offsetOf(first, `${y}-01-01`);
      if (i > n - 1) break;
      const at = n <= 1 ? 0 : (i / (n - 1)) * width;
      const label = at - lastLabel >= 36 && at <= width - 30;
      if (label) lastLabel = at;
      out.push({ i, y: String(y), label });
    }
    return out;
  }, [first, n, width]);
  // A mark over each wild night that heads its event, the wilder first where
  // two would touch; an eclipse's dot likewise, so a long history stays
  // legible. Every wild night keeps a fine tick, so none the dial snaps to is unmarked.
  const wildMarks = useMemo(() => {
    if (!data || n < 2) return [];
    const heads = data.marks.wild.filter((w) => w[3]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return spaced(
      heads.map((w) => (w[0] / (n - 1)) * width),
      9,
    );
  }, [data, n, width]);
  const eclipses = useMemo(() => {
    if (!data || n < 2) return [];
    const at = data.marks.eclipse.map(([i, kind]) => ({ x: (i / (n - 1)) * width, solar: kind.includes("solar") }));
    const keep = new Set(
      spaced(
        at.map((e) => e.x),
        7,
      ),
    );
    return at.filter((e) => keep.has(e.x));
  }, [data, n, width]);
  if (!data) return <div className="skeleton h-full w-full rounded-lg" />;
  return (
    <svg width={width} height={76} viewBox={`0 0 ${width} 76`} aria-hidden className="block overflow-visible">
      <defs>
        <linearGradient id="sky-plays" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4af37" stopOpacity=".55" />
          <stop offset="1" stopColor="#d4af37" stopOpacity=".04" />
        </linearGradient>
      </defs>
      {data.marks.wild.map(([i]) => (
        <line key={`t${i}`} x1={x(i)} x2={x(i)} y1={7} y2={11} stroke="var(--gold)" strokeOpacity={0.55} strokeWidth={1} />
      ))}
      {wildMarks.map((wx) => (
        <path key={`w${wx}`} d={`M${(wx - 3.5).toFixed(1)} 5h7l-3.5 6z`} fill="var(--gold)" />
      ))}
      {stars.map((i, k) => (
        <path
          key={k}
          transform={`translate(${x(Math.min(n - 1, Math.max(0, i))).toFixed(1)} 21)`}
          d="M0 -4.2L0.8 -0.8L4.2 0L0.8 0.8L0 4.2L-0.8 0.8L-4.2 0L-0.8 -0.8Z"
          fill="var(--gold)"
          opacity={0.85}
        />
      ))}
      <rect x={-8} y={30} width={width + 16} height={34} rx={8} fill="rgba(255,255,255,.025)" stroke="rgba(212,175,55,.14)" />
      {years.map((yr) => (
        <line key={yr.y} x1={x(yr.i)} x2={x(yr.i)} y1={30} y2={64} stroke="rgba(212,175,55,.25)" />
      ))}
      {area && <path d={area} fill="url(#sky-plays)" stroke="rgba(212,175,55,.75)" strokeWidth={1} strokeLinejoin="round" />}
      {moon && <path d={moon} fill="none" stroke="rgba(116,135,234,.4)" strokeWidth={1} opacity={moonOpacity} />}
      {years
        .filter((yr) => yr.label)
        .map((yr) => (
          <text
            key={yr.y}
            x={x(yr.i) + 4}
            y={41}
            fontSize={10.5}
            fontWeight={600}
            letterSpacing="0.06em"
            fill="var(--text-secondary)"
            stroke="#10142e"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {yr.y}
          </text>
        ))}
      {data.marks.storm.map(([i]) => (
        <line key={`s${i}`} x1={x(i)} x2={x(i)} y1={66} y2={74} stroke="var(--aurora)" strokeWidth={1.4} />
      ))}
      {data.marks.xflare.map(([i]) => (
        <line key={`f${i}`} x1={x(i)} x2={x(i)} y1={66} y2={72} stroke="var(--flare)" strokeWidth={1.4} />
      ))}
      {eclipses.map((e) => (
        <circle key={`e${e.x}`} cx={e.x} cy={70} r={2.4} strokeWidth={1.1} fill={e.solar ? "#0b1026" : "#c8553a"} stroke={e.solar ? "#fff6d8" : "#e0a090"} />
      ))}
    </svg>
  );
}
