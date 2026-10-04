"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import dynamic from "next/dynamic";
/* Loaded with the host, not with each sheet: a sheet loads on demand
   (13), and Turbopack copies any module its parent hasn't loaded into that
   sheet's own chunk. Without this, the Carousel the sheets' rows use was
   copied into every sheet's chunk, 10 copies of about 12 kB in all. */
import "@/components/listener/rail";
import { useSearchParams } from "next/navigation";
import { Button, Sheet } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { ListenerContext, type Listener, type Load } from "@/components/listener/Shell";
import type { SheetBodyProps } from "@/components/listener/SheetHost";
import { closeSheets, dropSheet, finishClose, openSheet, sheetDepth, sheetFrom, type SheetRef } from "@/components/listener/sheetUrl";
import type { AnswersPayload, Highlights, SkyNow, Songs, SyncStatus } from "@/components/listener/api";
import { isNightDate, songIndex, tonightDate } from "@/components/listener/format";
import { outsideTheSky, planetSheetValue } from "@/lib/client/planetSheet";
import { OUTSIDE_THE_SKY } from "@/components/invalidLink";
import { SheetSkeleton } from "@/components/listener/pieces";
import { dropSample, LANDING_HEADING, SAMPLE_LABEL, SAMPLE_SHEETS, SAMPLE_USER, SAMPLE_ZONE, sampleFile, sampleFrom, type SampleSheet } from "./sampleUrls";
import { loadSkyNow } from "./skyNow";

/* The landing's samples (spec 8.1): the made-up listener committed under
   `public/samples/`, standing in for a listener so the real sheets open on
   it, plus the landing's own two (the Tonight sample and the 12 answers).
   One sheet at a time, driven by the URL like a listener's (4, 8.7), and
   every one says it's a sample. Loaded only once a sample opens. */

export interface SampleHostProps {
  /** A sheet parameter that points at nothing in the sample (8.7). */
  onInvalid: (message?: string) => void;
  onValid: () => void;
}

type Open = SheetRef | { kind: "sample"; value: string };
type BodyKind = Exclude<SheetRef["kind"], "share" | "chart"> | SampleSheet;

const Skeleton = SheetSkeleton;

const BODIES: Record<BodyKind, ComponentType<SheetBodyProps>> = {
  song: dynamic(() => import("@/components/listener/sheets/SongSheet"), { loading: Skeleton }),
  night: dynamic(() => import("@/components/listener/sheets/NightSheet"), { loading: Skeleton }),
  q: dynamic(() => import("@/components/listener/sheets/QuestionSheet"), { loading: Skeleton }),
  planet: dynamic(() => import("@/components/listener/sheets/PlanetSheet"), { loading: Skeleton }),
  tonight: dynamic(() => import("./TonightSample"), { loading: Skeleton }),
  answers: dynamic(() => import("./AnswersSample"), { loading: Skeleton }),
};

const PROVISIONAL: Record<BodyKind, string> = {
  song: "The sky of a song",
  night: "A night",
  q: "A question",
  planet: "A planet",
  tonight: "Tonight",
  answers: "12 honest answers",
};

function openFrom(params: URLSearchParams): Open | null {
  const ref = sheetFrom(params);
  if (ref) return ref;
  const sample = sampleFrom(params);
  return sample === null ? null : { kind: "sample", value: sample };
}

const bodyOf = (o: Open): BodyKind | null =>
  o.kind === "sample" ? (SAMPLE_SHEETS.includes(o.value as SampleSheet) ? (o.value as SampleSheet) : null) : o.kind === "share" || o.kind === "chart" ? null : o.kind;

/** What can be refused before anything loads. Sharing a sample has no link
    to give (the made-up listener has no page), so a share sheet is refused,
    and the birth chart belongs to the Sky view, which the landing hasn't. */
function obviouslyInvalid(o: Open): boolean {
  switch (o.kind) {
    case "q":
      return !QUESTIONS.some((q) => q.id === o.value);
    case "planet":
      return planetSheetValue(o.value) === null;
    case "night":
      return !isNightDate(o.value) || o.value > tonightDate(SAMPLE_ZONE);
    case "song":
      return false;
    case "share":
    case "chart":
      return true;
    case "sample":
      return bodyOf(o) === null;
  }
}

interface Core {
  answers: AnswersPayload;
  songs: Songs;
  status: SyncStatus;
}
type MonthLoad = "ready" | "missing" | "failed";

async function getFile<T>(route: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(sampleFile(route), { signal });
  if (!res.ok) throw new Error(`${route}: ${res.status}`);
  return (await res.json()) as T;
}

export default function SampleHost({ onInvalid, onValid }: SampleHostProps) {
  const params = useSearchParams();
  const [attempt, setAttempt] = useState(0);
  const [core, setCore] = useState<Load<Core>>({ state: "loading" });
  const [highlights, setHighlights] = useState<Load<Highlights>>({ state: "loading" });
  const [sky, setSky] = useState<Load<SkyNow>>({ state: "loading" });
  const [months, setMonths] = useState<Record<string, MonthLoad>>({});

  // The sample, fetched now that a sample has opened (8.1), never before.
  useEffect(() => {
    const ac = new AbortController();
    Promise.all([getFile<AnswersPayload>("answers", ac.signal), getFile<Songs>("songs", ac.signal), getFile<SyncStatus>("status", ac.signal)])
      .then(([answers, songs, status]) => setCore({ state: "ready", data: { answers, songs, status } }))
      .catch(() => !ac.signal.aborted && setCore({ state: "failed" }));
    getFile<Highlights>("highlights", ac.signal)
      .then((data) => setHighlights({ state: "ready", data }))
      .catch(() => !ac.signal.aborted && setHighlights({ state: "failed" }));
    let live = true;
    loadSkyNow().then(
      (data) => live && setSky({ state: "ready", data }),
      () => live && setSky({ state: "failed" }),
    );
    return () => {
      live = false;
      ac.abort();
    };
  }, [attempt]);

  const open = openFrom(params);
  const kind = open ? bodyOf(open) : null;
  const refused = open !== null && obviouslyInvalid(open);

  // A night's month is part of what a night needs: a month the sample doesn't
  // ship is a night outside its history.
  const month = open?.kind === "night" && !refused ? open.value.slice(0, 7) : null;
  const asking = useRef(new Set<string>());
  useEffect(() => {
    if (!month || months[month] || asking.current.has(month)) return;
    asking.current.add(month);
    const settle = (load: MonthLoad) => {
      asking.current.delete(month);
      setMonths((m) => ({ ...m, [month]: load }));
    };
    fetch(sampleFile("nights", `&from=${month}&to=${month}`))
      .then((res) => settle(res.ok ? "ready" : res.status === 404 ? "missing" : "failed"))
      .catch(() => settle("failed"));
  }, [month, months]);

  /** Whether what an open sheet needs is here: loading, failed, ready, or
      not in the sample at all. */
  const needs = (o: Open): "loading" | "failed" | "ready" | "invalid" => {
    if (core.state !== "ready") return core.state;
    if (o.kind === "song" && !songIndex(core.data.songs).has(o.value)) return "invalid";
    if (o.kind === "night") {
      const m = months[o.value.slice(0, 7)];
      if (m === "missing") return "invalid";
      if (m !== "ready") return m ?? "loading";
    }
    if (o.kind === "sample" && o.value === "tonight" && sky.state !== "ready") return sky.state;
    return "ready";
  };
  const status = open && !refused ? needs(open) : null;
  const invalid = refused || status === "invalid";
  const key = open && !invalid ? `${open.kind}:${open.value}` : null;

  useEffect(() => {
    if (!invalid) return;
    onInvalid(open?.kind === "planet" && outsideTheSky(open.value) ? OUTSIDE_THE_SKY : undefined);
    dropSheet();
    dropSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per bad parameter
  }, [invalid]);

  // What the sheet shows, kept through the leave so it never slides out empty.
  const [shown, setShown] = useState<{ open: Open; kind: BodyKind } | null>(null);
  const [title, setTitle] = useState<ReactNode>("");
  const [bodyBusy, setBodyBusy] = useState(true);
  const [deepLinked, setDeepLinked] = useState(false);
  // What opened the sheet, read as it opens from closed: the first sheet
  // mounts this host already open, and Headless UI only restores focus to
  // an element it saw before opening, so a mouse-opened first sheet would
  // otherwise close onto the body (11).
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (key !== lastKey) {
    setLastKey(key);
    if (open && key && kind) {
      if (lastKey === null && typeof document !== "undefined") {
        const active = document.activeElement;
        setOpener(active instanceof HTMLElement && active !== document.body ? active : null);
      }
      setShown({ open, kind });
      setTitle(PROVISIONAL[kind]);
      setBodyBusy(true);
      setDeepLinked(typeof window !== "undefined" && sheetDepth() === 0);
    }
  }
  useEffect(() => {
    if (key) onValid();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per sheet
  }, [key]);

  // The close button closes the whole stack (4). A deep-linked `?sample=`
  // goes too, which `sheetUrl.ts` doesn't know about.
  const closingAll = useRef(false);
  const close = useCallback(() => {
    if (sheetDepth() === 0) {
      dropSheet();
      dropSample();
      return;
    }
    closingAll.current = true;
    closeSheets();
  }, []);
  useEffect(() => {
    const onPop = () => {
      finishClose();
      if (closingAll.current) {
        closingAll.current = false;
        if (sheetDepth() === 0) dropSample();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openRef = useCallback((ref: SheetRef) => {
    // A sample has no page to share (see `obviouslyInvalid`).
    if (ref.kind === "share") return;
    openSheet(ref);
  }, []);

  /** Fetch the sample again: "Try again" on the sample, or on a sheet (8.1, 8.7). */
  const retryData = useCallback(() => {
    setCore({ state: "loading" });
    setSky({ state: "loading" });
    setMonths((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== "failed")));
    setAttempt((a) => a + 1);
  }, []);
  const [tries, setTries] = useState(0);

  const listener = useMemo<Listener>(
    () => ({
      username: SAMPLE_USER,
      zone: SAMPLE_ZONE,
      sync: core.state === "ready" ? core.data.status : null,
      answers: core.state === "ready" ? { state: "ready", data: core.data.answers } : core,
      songs: core.state === "ready" ? { state: "ready", data: core.data.songs } : core,
      highlights,
      skyNow: sky,
      sampleLabel: SAMPLE_LABEL,
      listenerUrl: sampleFile,
      open: openRef,
      close,
      replayReveal: () => {},
      guideReady: false,
      revealOpen: false,
      retryData,
      serverFellBack: false,
    }),
    [core, highlights, sky, openRef, close, retryData],
  );

  const shownStatus = shown ? needs(shown.open) : null;
  const Body = shown ? BODIES[shown.kind] : null;
  return (
    <ListenerContext.Provider value={listener}>
      <Sheet
        isOpen={key !== null}
        onClose={close}
        onAfterClose={() => {
          if (!openFrom(new URLSearchParams(window.location.search))) setShown(null);
        }}
        title={title}
        busy={shownStatus !== "ready" || bodyBusy}
        contentKey={key ?? undefined}
        returnFocus={deepLinked && typeof document !== "undefined" ? document.getElementById(LANDING_HEADING) : (opener ?? undefined)}
      >
        {shown && (
          <>
            <p className="mb-3 text-[12px] text-ink-2">{SAMPLE_LABEL}</p>
            {shownStatus === "failed" ? (
              <div className="py-6">
                <p className="text-ink">The sample didn&rsquo;t load.</p>
                <Button size="lg" variant="outline" className="mt-3" onClick={retryData}>
                  Try again
                </Button>
              </div>
            ) : shownStatus === "ready" && Body ? (
              <Body
                key={`${shown.open.kind}:${shown.open.value}:${tries}`}
                value={shown.open.value}
                setTitle={setTitle}
                setBusy={setBodyBusy}
                invalid={() => {
                  onInvalid();
                  dropSheet();
                  dropSample();
                }}
                retry={() => {
                  retryData();
                  setTries((t) => t + 1);
                }}
              />
            ) : (
              <Skeleton />
            )}
          </>
        )}
      </Sheet>
    </ListenerContext.Provider>
  );
}
