"use client";

import { useEffect, useState, type RefObject } from "react";

/** A media query's match, kept current. False on the server. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return on;
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Reduced motion asked for, right now (for a choice made at the moment of acting). */
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches;

/** Where the pointer can hover: a mouse gets arrows, touch swipes (8.10). The
    Carousel shows its arrows on the same query. */
export const CAN_HOVER = "(any-hover: hover)";

/** Whether the element is on screen now (half of it or more). */
export function useOnScreen(ref: RefObject<Element | null>, ready = true): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, ready]);
  return on;
}

/** True once the element has been on screen (8.11: anything that starts on
    its own runs only once it's on screen). */
export function useSeen(ref: RefObject<Element | null>, ready = true): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!ready || seen || !el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, ready, seen]);
  return seen;
}

/** CSS animations hold still while the tab is hidden (8.11): `data-hidden`
    on the root pauses them (globals.css). */
export function usePauseWhenHidden() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute("data-hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      root.removeAttribute("data-hidden");
    };
  }, []);
}
