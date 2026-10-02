"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Sheet } from "@blakesteve/roster";
import { useListener, VIEW_HEADING } from "./Shell";
import { dropSheet, sheetDepth, sheetFrom, type SheetKind, type SheetRef } from "./sheetUrl";
import { QUESTIONS } from "@/lib/answers/questions";
import { isNightDate, songIndex, tonightDate } from "./format";
import { SheetSkeleton } from "./pieces";

const PLANETS = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];

/** What can be refused before anything loads (8.7: the sheet doesn't open). */
function obviouslyInvalid(ref: SheetRef, L: ReturnType<typeof useListener>): boolean {
  switch (ref.kind) {
    case "q":
      return !QUESTIONS.some((q) => q.id === ref.value);
    case "planet":
      return !PLANETS.includes(ref.value);
    case "night":
      // Not a date, in the future, or before the history's first night.
      return (
        !isNightDate(ref.value) ||
        ref.value > tonightDate(L.zone) ||
        (L.sync?.oldestUts != null && ref.value < tonightDate(L.zone, L.sync.oldestUts * 1000))
      );
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
  /** Refines the provisional title once the content knows it. */
  setTitle: (title: string) => void;
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
};

const PROVISIONAL: Record<SheetKind, string> = {
  song: "The sky of a song",
  night: "A night",
  q: "A question",
  planet: "A planet",
  share: "Share",
};

export function SheetHost({ onInvalid, lead }: { onInvalid: () => void; lead: { date: string; text: string } | null }) {
  const params = useSearchParams();
  const ref = sheetFrom(params);
  const L = useListener();
  // What the sheet shows, kept through the leave so it never slides out empty.
  const [shown, setShown] = useState<SheetRef | null>(ref);
  const [title, setTitle] = useState(ref ? PROVISIONAL[ref.kind] : "");
  const [busy, setBusy] = useState(true);
  // A sheet the app didn't push arrived by a link: focus returns to the
  // view's heading when it closes (8.7, Roster's returnFocus).
  const [deepLinked, setDeepLinked] = useState(false);
  const [tries, setTries] = useState(0);

  const rejected = ref !== null && obviouslyInvalid(ref, L);
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
