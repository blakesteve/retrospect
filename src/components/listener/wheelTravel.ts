"use client";

import { useEffect, useMemo, useState } from "react";
import { createTrips, type TripState } from "@/lib/motion/trips";
import type { SkyPath } from "@/lib/motion/wheelPath";
import { getJson, type Planet, type SkyAt } from "./api";
import { prefersReducedMotion } from "./media";

/* The wheel goes to a moment and back (spec 8.11 item 1): the React side of
   `src/lib/motion/trips.ts`, which holds the rules (the last press wins,
   Back stops the trip out at once, glyphs blend rather than jump) and their
   tests. The planets follow their real paths (`GET /api/sky/path`). */

export interface WheelMoment {
  uts: number;
  /** "Oct 3, 2:09 a.m. CDT: Venus turns retrograde" */
  label: string;
  /** "Oct 3, 2:09 a.m. CDT", for "The wheel shows …" */
  when: string;
  /** The body that's the point, which pulses once on arrival. */
  body: string | null;
}

export type WheelTravel = TripState<Planet, WheelMoment> & {
  /** True once the wheel is there; false if a newer press took over. */
  goTo: (m: WheelMoment, ready?: Promise<unknown>) => Promise<boolean>;
  back: () => Promise<boolean>;
};

export function useWheelTravel(now: { bodies: Planet[]; uts: number } | null): WheelTravel | null {
  const [shown, setShown] = useState<{ owner: object; state: TripState<Planet, WheelMoment> } | null>(null);
  const trips = useMemo(() => {
    if (!now) return null;
    // Paths by the hour they reach, asked for once each.
    const paths = new Map<number, Promise<SkyPath>>();
    const owner = {};
    const t = createTrips<Planet, WheelMoment>(
      {
        now,
        getPath: (to) => {
          const key = Math.round(to / 3600) * 3600;
          let p = paths.get(key);
          if (!p) {
            p = getJson<SkyPath>(`/api/sky/path?to=${key}`);
            p.catch(() => paths.delete(key));
            paths.set(key, p);
          }
          return p;
        },
        getAt: (uts) => getJson<SkyAt>(`/api/sky/at?t=${Math.floor(uts)}`).then((s) => s.bodies),
        reduced: prefersReducedMotion,
        raf: (cb) => requestAnimationFrame(cb),
        cancelRaf: (id) => cancelAnimationFrame(id),
      },
      (state) => setShown({ owner, state }),
    );
    return { t, owner };
  }, [now]);
  useEffect(() => () => trips?.t.dispose(), [trips]);
  if (!trips) return null;
  const state = shown && shown.owner === trips.owner ? shown.state : trips.t.state;
  return { ...state, goTo: trips.t.goTo, back: trips.t.back };
}
