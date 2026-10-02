"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@blakesteve/roster";
import { sheetFrom } from "./sheetUrl";

/* The first-visit guide (spec 8.10): three tips on Tonight, after the reveal,
   dismissible at any step and remembered per browser. Not modal: each tip is
   a region named "Tip 1 of 3", focus moves to its Next button, and Escape
   ends it (11). Each step also advances when the visitor does what it asks:
   a planet's sheet opening (tip 1, by tap or by key), the songs row
   scrolling (tip 2), a question's sheet opening (tip 3). While a sheet is
   open the guide waits, and takes up again once it closes. */

const TIPS = [
  "This is tonight's sky. Tap any planet.",
  "Swipe your songs. Each one has a sky.",
  "These are the only claims we make. Tap one.",
];
const KEY = "retrospect:guide-done";
/** The sheet each tip asks for: tip 1 a planet's, tip 3 a question's. */
const ASKS: (string | null)[] = ["planet", null, "q"];

const done = () => {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
};

export function Guide({ anchors }: { anchors: string[] }) {
  // Mounted only on the client, after the reveal, so storage is readable here.
  const [step, setStep] = useState<number | null>(() => (done() ? null : 0));
  const nextRef = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState(0);
  const sheet = sheetFrom(useSearchParams());
  const sheetOpen = sheet !== null;

  const finish = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* shown again next time: harmless */
    }
    setStep(null);
  };
  const advance = () => setStep((s) => (s === null || s >= TIPS.length - 1 ? (finish(), null) : s + 1));

  // Doing what the tip asks: its sheet opened. Adjusted while rendering;
  // the move shows once the sheet closes.
  const [asked, setAsked] = useState(false);
  if (step !== null && sheet && ASKS[step] === sheet.kind && !asked) setAsked(true);
  if (asked && !sheetOpen) {
    setAsked(false);
    advance();
  }

  const anchorId = step === null || sheetOpen ? null : anchors[step];

  // Bring the step's anchor into view and sit the tip under it.
  useEffect(() => {
    const anchor = anchorId ? document.getElementById(anchorId) : null;
    if (!anchor) return;
    anchor.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const place = () => setTop(anchor.getBoundingClientRect().bottom + window.scrollY + 8);
    const raf = requestAnimationFrame(place);
    const t = setTimeout(place, 400);
    nextRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [anchorId]);

  // Escape ends the guide, but not the Escape that closes a sheet.
  useEffect(() => {
    if (step === null || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, sheetOpen]);

  // Tip 2 asks for a swipe: the songs row scrolling.
  useEffect(() => {
    if (step !== 1 || !anchorId) return;
    const rail = document.getElementById(anchorId)?.querySelector<HTMLElement>(".rail");
    if (!rail) return;
    const onScroll = () => rail.scrollLeft > 60 && advance();
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => rail.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per step
  }, [step, anchorId]);

  if (step === null || sheetOpen) return null;
  return (
    <div
      role="region"
      aria-label={`Tip ${step + 1} of ${TIPS.length}`}
      className="absolute left-4 right-4 z-30 mx-auto max-w-[380px] rounded-[18px] border border-[var(--hairline)] bg-surface-2 p-4 shadow-[0_20px_46px_rgba(2,4,14,.62)]"
      style={{ top }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
        Tip {step + 1} of {TIPS.length}
      </p>
      <p className="mt-1.5 font-display text-[20px] leading-snug text-ink">{TIPS[step]}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="lg" variant="ghost" onClick={finish}>
          Skip
        </Button>
        <Button size="lg" ref={nextRef} onClick={advance}>
          {step === TIPS.length - 1 ? "Got it" : "Next"}
        </Button>
      </div>
    </div>
  );
}
