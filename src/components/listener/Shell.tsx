"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button, EmptyState, LiquidNav, type LiquidNavLinkProps } from "@blakesteve/roster";
import { SyncScreen } from "@/components/SyncScreen";
import { NoScrobbles } from "@/components/NoScrobbles";
import { RemoveDataLink } from "@/components/RemoveDataLink";
import { Wordmark } from "@/components/Wordmark";
import { toVisitorErrorCode, visitorError, visitorErrorCodeOf, apiError, type VisitorErrorCode } from "@/lib/visitorErrors";
import { getJson, userUrl, type AnswersPayload, type ComputingPayload, type Highlights, type SkyNow, type Songs, type SyncStatus } from "./api";
import { SheetHost } from "./SheetHost";
import { closeSheets, finishClose, openSheet, sheetFrom, type SheetRef } from "./sheetUrl";
import { Reveal } from "./Reveal";

/* The listener shell (spec 8.2), shared by the three views from
   `app/u/[username]/layout.tsx`, so switching views never restarts the
   polling or the sheet host. */

export type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "failed" };

export interface Listener {
  username: string;
  /** The zone the page sends: the URL's when shared, else the browser's (7.1). */
  zone: string;
  sync: SyncStatus | null;
  answers: Load<AnswersPayload | ComputingPayload>;
  songs: Load<Songs>;
  highlights: Load<Highlights>;
  skyNow: Load<SkyNow>;
  /** Set on the landing's samples: "Sample · a made-up listener, the real sky" (8.1). */
  sampleLabel?: string;
  /** Where a listener route lives: the real one, or a committed sample (8.1). */
  listenerUrl: (route: string, extra?: string) => string;
  open: (ref: SheetRef, lead?: string) => void;
  close: () => void;
  replayReveal: () => void;
  /** The first-visit guide may start (8.10): after the reveal, not on a shared link. */
  guideReady: boolean;
  /** The reveal is up, or about to be: Tonight's motion waits for it (8.11). */
  revealOpen: boolean;
  /** Fetch the listener's data again, for a sheet's "Try again" (8.7). */
  retryData: () => void;
  /** The server read the history in UTC: the browser's zone was rejected (7.1). */
  serverFellBack: boolean;
}

/** Exported so the landing's samples can stand in for a listener (8.1). */
export const ListenerContext = createContext<Listener | null>(null);

export function useListener(): Listener {
  const v = useContext(ListenerContext);
  if (!v) throw new Error("useListener outside the listener shell");
  return v;
}

/** The view's heading, where focus returns when a deep-linked sheet closes. */
export const VIEW_HEADING = "view-heading";

/** The views, in the switcher's order. Every night and Sky join as they're
    built (3b, 3c); `route` is the path after `/u/{name}`. */
export const VIEWS: { id: string; label: string; route: string }[] = [{ id: "tonight", label: "Tonight", route: "" }];

/** With one view there's no switcher: a lone gold item reads as a button
    that does nothing (8.4 item 1, 10). The view then names itself. */
export const HAS_SWITCHER = VIEWS.length > 1;

/** Query strings the report used; ignored and dropped on arrival (4). */
const OLD_PARAMS = ["body", "metric", "from", "to", "noise", "threshold", "level"];

function validZone(z: string | null): string | null {
  if (!z) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: z }).resolvedOptions().timeZone ? z : null;
  } catch {
    return null;
  }
}

function browserZone(): string | null {
  try {
    return validZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
  } catch {
    return null;
  }
}

const seenKey = (username: string) => `retrospect:reveal-seen:${username.toLowerCase()}`;
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private window: the reveal shows again next time, which is harmless */
  }
};

/** Retry a route that says it's still computing. */
async function settle<T extends { status?: string }>(url: string, signal: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    const data = await getJson<T>(url, { signal });
    if (data.status !== "computing" || i > 60) return data;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** `next/link` for LiquidNav, without the `to` it would pass through to the `<a>`. */
function NextNavLink(props: LiquidNavLinkProps) {
  const { href, className, children, onClick } = props;
  return (
    <NextLink href={href} className={className} onClick={onClick} aria-current={props["aria-current"]} data-tab-id={props["data-tab-id"]}>
      {children}
    </NextLink>
  );
}

export function ListenerShell({ username, children }: { username: string; children: ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const urlTz = validZone(params.get("tz"));
  const [browser] = useState(() => (typeof window === "undefined" ? null : browserZone()));
  const zone = urlTz ?? browser ?? "UTC";

  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [fatal, setFatal] = useState<VisitorErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<Listener["answers"]>({ state: "loading" });
  const [songs, setSongs] = useState<Listener["songs"]>({ state: "loading" });
  const [highlights, setHighlights] = useState<Listener["highlights"]>({ state: "loading" });
  const [skyNow, setSkyNow] = useState<Listener["skyNow"]>({ state: "loading" });
  const [revealing, setRevealing] = useState<boolean | null>(null);
  const [dataAttempt, setDataAttempt] = useState(0);
  const retryData = useCallback(() => {
    setAnswers({ state: "loading" });
    setSongs({ state: "loading" });
    setHighlights({ state: "loading" });
    setDataAttempt((a) => a + 1);
  }, []);
  const [guideReady, setGuideReady] = useState(false);

  // Old report query strings go on arrival, without a history entry.
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const k of OLD_PARAMS)
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k);
        changed = true;
      }
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const onPop = () => finishClose();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The sky right now doesn't wait for the history.
  useEffect(() => {
    const ac = new AbortController();
    getJson<SkyNow>(`/api/sky/now?tz=${encodeURIComponent(zone)}`, { signal: ac.signal })
      .then((data) => setSkyNow({ state: "ready", data }))
      .catch(() => !ac.signal.aborted && setSkyNow({ state: "failed" }));
    return () => ac.abort();
  }, [zone]);

  // Sync: each status call reads one budgeted chunk of the history.
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        while (!stopped) {
          const res = await fetch(`/api/user/${encodeURIComponent(username)}/status`);
          if (!res.ok) throw await apiError(res);
          const s = (await res.json()) as SyncStatus;
          if (stopped) return;
          setSync(s);
          if (s.status === "error") {
            setFatal(toVisitorErrorCode(s.code));
            return;
          }
          if (s.status === "ready") {
            if (s.newestUts === null) setFatal("no-scrobbles");
            else {
              // The reveal: once per username per browser, never on a shared link (8.2, 8.3).
              const shared = sheetFrom(new URLSearchParams(window.location.search)) !== null;
              const seen = read(seenKey(username)) !== null;
              setRevealing((r) => r ?? (!shared && !seen));
              setGuideReady(!shared && seen);
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (err) {
        if (!stopped) setFatal(visitorErrorCodeOf(err));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [username, attempt]);

  const ready = sync?.status === "ready" && sync.newestUts !== null && !fatal;

  // The listener's data, once the history is read. Answers computing for the
  // first time take seconds; songs and highlights the same.
  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    const load = <T extends { status?: string }>(route: string, set: (l: Load<T>) => void, tries = 8) => {
      settle<T>(userUrl(username, route, zone), ac.signal)
        .then((data) => {
          set({ state: "ready", data });
          // Stored data being refreshed: the new ones swap in without a
          // notice (8.4), so look again until they have.
          if (tries > 0 && data.status === "updating") setTimeout(() => !ac.signal.aborted && load(route, set, tries - 1), 8000);
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const code = visitorErrorCodeOf(err);
          if (code === "no-scrobbles") setFatal(code);
          else set({ state: "failed" });
        });
    };
    load<AnswersPayload | ComputingPayload>("answers", setAnswers);
    load<Songs>("songs", setSongs);
    load<Highlights>("highlights", setHighlights);
    return () => ac.abort();
  }, [ready, username, zone, attempt, dataAttempt]);

  const endReveal = useCallback(
    (seen = true) => {
      if (seen) write(seenKey(username), "1");
      setRevealing(false);
      setGuideReady(true);
      // Focus lands on the view, not the body; the guide moves it on if it shows.
      requestAnimationFrame(() => document.getElementById(VIEW_HEADING)?.focus({ preventScroll: true }));
    },
    [username],
  );
  const replayReveal = useCallback(() => {
    window.scrollTo({ top: 0 });
    setRevealing(true);
  }, []);

  const [invalidLink, setInvalidLink] = useState(false);
  // A fact from "Surprise me" leads the night sheet it opens (7.5).
  const [lead, setLead] = useState<{ date: string; text: string } | null>(null);
  const listenerUrl = useCallback((route: string, extra = "") => userUrl(username, route, zone, extra), [username, zone]);
  const open = useCallback((ref: SheetRef, leadText?: string) => {
    setInvalidLink(false);
    setLead(leadText && ref.kind === "night" ? { date: ref.value, text: leadText } : null);
    openSheet(ref);
  }, []);
  const value = useMemo<Listener>(
    () => ({
      username,
      zone,
      sync,
      answers,
      songs,
      highlights,
      skyNow,
      listenerUrl,
      open,
      close: closeSheets,
      replayReveal,
      guideReady,
      revealOpen: revealing === true,
      retryData,
      serverFellBack: skyNow.state === "ready" && skyNow.data.zoneFellBack && !urlTz && zone !== "UTC",
    }),
    [username, zone, sync, answers, songs, highlights, skyNow, listenerUrl, open, replayReveal, guideReady, revealing, retryData, urlTz],
  );

  const restart = () => {
    setFatal(null);
    setSync(null);
    setAnswers({ state: "loading" });
    setSongs({ state: "loading" });
    setHighlights({ state: "loading" });
    setRevealing(null);
    setAttempt((a) => a + 1);
  };

  // The reveal waits for everything its cards show (8.3), so they never
  // reshuffle under the reader.
  const revealShown = Boolean(ready && revealing && answers.state === "ready" && songs.state !== "loading" && highlights.state !== "loading");

  const header = (
    <header className="pt-5">
      <div className="flex items-center justify-between gap-3">
        <Wordmark />
        <span className="min-w-0 truncate text-sm text-ink-2" title={username}>
          {username}
        </span>
      </div>
      {/* The views (4, 11), once there are two (8.4 item 1). */}
      {HAS_SWITCHER && (
        <LiquidNav
          aria-label="Views"
          size="lg"
          fullWidth
          className="mt-3"
          linkComponent={NextNavLink}
          activeTab={VIEWS.find((v) => v.route && pathname?.endsWith(v.route))?.id ?? VIEWS[0].id}
          items={VIEWS.map((v) => ({
            id: v.id,
            label: v.label,
            href: `/u/${encodeURIComponent(username)}${v.route}${urlTz ? `?tz=${encodeURIComponent(urlTz)}` : ""}`,
          }))}
        />
      )}
      <ZoneLine urlTz={urlTz} browser={browser} serverFellBack={value.serverFellBack} />
    </header>
  );

  let body: ReactNode;
  if (fatal === "no-scrobbles") {
    body = <NoScrobbles username={username} onFound={restart} onError={(c) => setFatal(c)} sky={skyNow} />;
  } else if (fatal) {
    body = <Fatal code={fatal} username={username} onRetry={restart} />;
  } else if (!ready) {
    body = <SyncScreen username={username} sync={sync} />;
  } else if (revealing && (answers.state === "loading" || songs.state === "loading" || highlights.state === "loading")) {
    // A first visit: the reveal needs the answers. The checking step (8.2).
    body = <SyncScreen username={username} sync={sync} checking />;
  } else if (revealing && answers.state === "failed") {
    // A failure while checking: server's copy, and a way to check again (8.2).
    body = <Fatal code="server" username={username} onRetry={restart} />;
  } else {
    body = children;
  }

  return (
    <ListenerContext.Provider value={value}>
      <div className="mx-auto w-full max-w-[720px] px-4 pb-32" inert={revealShown}>
        {header}
        {/* An invalid sheet parameter opens nothing and says so (8.7). */}
        <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-2 empty:hidden">
          {invalidLink ? "That link points to something that isn't in this history." : ""}
        </p>
        <main>{body}</main>
        <footer className="mt-12 border-t border-[var(--line)] pt-5 text-xs text-ink-2">
          <p>Sky computed with astronomy-engine. Space weather, asteroids and photos from NASA and JPL.</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5">
            {ready && (
              <Button size="lg" variant="link" onClick={replayReveal}>
                Replay the reveal
              </Button>
            )}
            <RemoveDataLink username={username} />
          </div>
        </footer>
      </div>
      {revealShown && <Reveal onDone={endReveal} />}
      {ready && <SheetHost onInvalid={() => setInvalidLink(true)} lead={lead} />}
    </ListenerContext.Provider>
  );
}

/** A page-level fatal state (8.2): Roster's `EmptyState` as the page's h1,
    focusable so a closed deep-linked sheet returns focus to it. */
function Fatal({ code, username, onRetry }: { code: VisitorErrorCode; username: string; onRetry: () => void }) {
  const v = visitorError(code, username);
  return (
    <EmptyState
      id={VIEW_HEADING}
      tabIndex={-1}
      headingLevel={1}
      variant="simple"
      title={v.title}
      description={v.body}
      action={
        code === "server" ? (
          <Button size="lg" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
      className="py-16 font-[family-name:var(--font-body)] outline-none [&_h1]:font-[family-name:var(--font-display)] [&_h1]:text-3xl [&_h1]:font-normal [&_h1]:text-ink [&_p]:mx-auto [&_p]:mt-3 [&_p]:max-w-md [&_p]:text-base [&_p]:text-ink-2"
    />
  );
}

/** Which zone the times are in, when it isn't simply the browser's (7.1). */
function ZoneLine({ urlTz, browser, serverFellBack }: { urlTz: string | null; browser: string | null; serverFellBack: boolean }) {
  if (urlTz) {
    const drop = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("tz");
      window.location.assign(`${url.pathname}${url.search}`);
    };
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-2">
        Times in {urlTz}, as shared.
        <Button size="lg" variant="link" onClick={drop}>
          Use my time zone
        </Button>
      </p>
    );
  }
  // A browser that shared no zone, or one the server couldn't read (7.1).
  if ((typeof window !== "undefined" && !browser) || serverFellBack) {
    return <p className="mt-2 text-[13px] text-ink-2">Times are in UTC because your browser didn&rsquo;t share a time zone.</p>;
  }
  return null;
}
