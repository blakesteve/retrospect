"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
/* Loaded with the host, not with each sheet: a sheet loads on demand
   (13), and Turbopack copies any module its parent hasn't loaded into that
   sheet's own chunk. Without this, the Carousel the sheets' rows use was
   copied into every sheet's chunk, 10 copies of about 12 kB in all; the
   nights cache the night and song sheets share would be copied the same way. */
import "@/components/listener/rail";
import "@/components/listener/nightsCache";
import { usePathname, useSearchParams } from "next/navigation";
import { Sheet } from "@blakesteve/roster";
import { useListener, VIEW_HEADING } from "./Shell";
import { dropSheet, sheetDepth, sheetFrom, type SheetKind, type SheetRef } from "./sheetUrl";
import { QUESTIONS } from "@/lib/answers/questions";
import { isNightDate, songIndex, tonightDate } from "./format";
import { SheetSkeleton } from "./pieces";
import { planetSheetValue } from "@/lib/client/planetSheet";

/** What can be refused before anything loads (8.7: the sheet doesn't open). */
function obviouslyInvalid(ref: SheetRef, L: ReturnType<typeof useListener>, onSky: boolean): boolean {
  switch (ref.kind) {
    case "q":
      return !QUESTIONS.some((q) => q.id === ref.value);
    case "planet":
      // Tonight, or any night inside the sky data (8.7.4).
      return planetSheetValue(ref.value) === null;
    case "chart":
      // The birth chart draws on the Sky view's wheel, and nowhere else.
      return ref.value !== "you" || !onSky;
    case "night":
      // Not a date, or in the future. A night before the history's first is
      // the sheet's to refuse, from the route's own nights: the sync's
      // oldestUts can be later than the first play (a sync state from before
      // the field existed takes it from the next sync's newest scrobbles), and
      // refusing by it shut the calendar's early doors as they opened.
      return !isNightDate(ref.value) || ref.value > tonightDate(L.zone);
    case "song":
      return L.songs.state === "ready" && !songIndex(L.songs.data).has(ref.value);
    case "share": {
      const [kind, v] = ref.value.split(":");
      if (!v) return true;
      if (kind === "q") return !QUESTIONS.some((q) => q.id === v);
      if (kind === "night") return !isNightDate(v);
      return kind !== "song";
    }
  }
}

/* One sheet at a time, driven by the URL (spec 4, 8.7). Each sheet's body
   loads on demand, so none weighs on a view's first load (13). */

export interface SheetBodyProps {
  value: string;
  /** Refines the provisional title once the content knows it. A node is
      fine: Roster's `Sheet` keeps the title's text as its name (5.2.0). */
  setTitle: (title: ReactNode) => void;
  setBusy: (busy: boolean) => void;
  /** The parameter points at nothing in this history (8.7). */
  invalid: () => void;
  /** "Try again" (8.7): fetch again and remount the body. */
  retry: () => void;
  lead?: string;
}

const Skeleton = SheetSkeleton;

const BODIES: Record<SheetKind, React.ComponentType<SheetBodyProps>> = {
  song: dynamic(() => import("./sheets/SongSheet"), { loading: Skeleton }),
  night: dynamic(() => import("./sheets/NightSheet"), { loading: Skeleton }),
  q: dynamic(() => import("./sheets/QuestionSheet"), { loading: Skeleton }),
  planet: dynamic(() => import("./sheets/PlanetSheet"), { loading: Skeleton }),
  share: dynamic(() => import("./sheets/ShareSheet"), { loading: Skeleton }),
  // The birth chart and its math (natal.ts, with SiderealTime and
  // SunPosition) load only when this opens (8.6 item 5, 13).
  chart: dynamic(() => import("./sheets/ChartSheet"), { loading: Skeleton }),
};

const PROVISIONAL: Record<SheetKind, string> = {
  song: "The sky of a song",
  night: "A night",
  q: "A question",
  planet: "A planet",
  share: "Share",
  chart: "Your birth chart",
};

export function SheetHost({ onInvalid, lead }: { onInvalid: () => void; lead: { date: string; text: string } | null }) {
  const params = useSearchParams();
  const ref = sheetFrom(params);
  const L = useListener();
  // What the sheet shows, kept through the leave so it never slides out empty.
  const [shown, setShown] = useState<SheetRef | null>(ref);
  const [title, setTitle] = useState<ReactNode>(ref ? PROVISIONAL[ref.kind] : "");
  const [busy, setBusy] = useState(true);
  // A sheet the app didn't push arrived by a link: focus returns to the
  // view's heading when it closes (8.7, Roster's returnFocus).
  const [deepLinked, setDeepLinked] = useState(false);
  const [tries, setTries] = useState(0);

  const onSky = usePathname()?.endsWith("/sky") ?? false;
  const rejected = ref !== null && obviouslyInvalid(ref, L, onSky);
  const key = ref && !rejected ? `${ref.kind}:${ref.value}` : null;
  useEffect(() => {
    if (rejected) {
      onInvalid();
      dropSheet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per bad parameter
  }, [rejected]);
  // A new parameter: adjust while rendering, not in an effect.
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (key !== lastKey) {
    setLastKey(key);
    if (ref && key) {
      setShown(ref);
      setTitle(PROVISIONAL[ref.kind]);
      setBusy(true);
      setDeepLinked(typeof window !== "undefined" && sheetDepth() === 0);
    }
  }

  const Body = shown ? BODIES[shown.kind] : null;
  return (
    <Sheet
      isOpen={key !== null}
      onClose={L.close}
      onAfterClose={() => {
        if (!sheetFrom(new URLSearchParams(window.location.search))) setShown(null);
      }}
      title={title}
      busy={busy}
      contentKey={key ?? undefined}
      returnFocus={deepLinked && typeof document !== "undefined" ? document.getElementById(VIEW_HEADING) : undefined}
    >
      {shown && Body && L.sampleLabel && <p className="mb-3 text-[12px] text-ink-2">{L.sampleLabel}</p>}
      {shown && Body && (
        <Body
          key={`${shown.kind}:${shown.value}:${tries}`}
          value={shown.value}
          setTitle={setTitle}
          setBusy={setBusy}
          lead={lead && shown.kind === "night" && lead.date === shown.value ? lead.text : undefined}
          invalid={() => {
            onInvalid();
            dropSheet();
          }}
          retry={() => {
            L.retryData();
            setTries((t) => t + 1);
          }}
        />
      )}
    </Sheet>
  );
}
