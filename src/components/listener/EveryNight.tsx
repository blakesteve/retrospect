"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { Button, Carousel, Chip } from "@blakesteve/roster";
import { moonLit, phaseName } from "@/lib/client/moon";
import {
  COVERAGE,
  SKY_FILTERS,
  addDays,
  collapse,
  dockLines,
  doorName,
  monthTitle,
  monthShort,
  monthWeeks,
  monthsNewestFirst,
  pickMonth,
  playsLevel,
  stepNight,
  stepPast,
  type SkyFilterId,
} from "@/lib/client/nights";
import { useListener, VIEW_HEADING } from "./Shell";
import type { Night, Nights, NightsCombo } from "./api";
import { tonightDate } from "./format";
import { comboUrl, isLit, litSelection, nightsCombo, nightsYear, yearRange, type NightsYear } from "./nightsCache";
import { replaceParams } from "./sheetUrl";
import { SheetLink } from "./sheetLink";
import { Chevron, Icon, type IconName } from "./pieces";
import { prefersReducedMotion, useMedia } from "./media";
import { CompareCard, QuestionsGrid } from "./shared";

/* Every night (spec 8.5): the history as a calendar of doors, newest month
   first, a year fetched at a time as its months near the viewport, with
   filters that light the nights a sky condition held and a dock that ties a
   filter to the question that tests it. Lays out what the nights route
   says; the door names and the dock's words are lib/client/nights.ts. */

type YearLoad = { state: "loading" } | { state: "ready"; data: NightsYear } | { state: "failed" };

/** A filter's color (8.9: a lit door and a pressed chip carry it). */
const FILTER_COLOR: Record<SkyFilterId, string> = {
  storm: "var(--aurora)",
  xflare: "var(--flare)",
  eclipse: "var(--moonlight)",
  fullmoon: "var(--moonlight)",
  newmoon: "var(--indigo)",
  firstplay: "var(--gold)",
  wild: "var(--gold)",
  venushome: "var(--home)",
  marshome: "var(--home)",
  moonstrong: "var(--exalt)",
  asteroid: "#d8c7ad",
  fireball: "#ff8c5a",
};
const GENRE_COLOR = "var(--indigo)";
const FILTER_ICON: Partial<Record<SkyFilterId, IconName>> = {
  storm: "storm",
  xflare: "flare",
  eclipse: "eclipse",
  firstplay: "note",
  wild: "sparkle",
  asteroid: "asteroid",
  fireball: "fireball",
};
const FILTER_GLYPH: Partial<Record<SkyFilterId, string>> = { venushome: "♀︎", marshome: "♂︎", moonstrong: "☽︎" };
/** A door's tiny badges (8.5 item 4), in this order. */
const BADGES: { id: "eclipse" | "storm" | "xflare" | "asteroid" | "firstplay"; icon: IconName; color: string }[] = [
  { id: "eclipse", icon: "eclipse", color: "var(--moonlight)" },
  { id: "storm", icon: "storm", color: "var(--aurora)" },
  { id: "xflare", icon: "flare", color: "var(--flare)" },
  { id: "asteroid", icon: "asteroid", color: "#d8c7ad" },
  { id: "firstplay", icon: "note", color: "var(--gold)" },
];
/** The fill's strength for playsLevel 0 to 4: a night above its weekday's usual glows brighter. */
const TINT = [0, 0.07, 0.16, 0.3, 0.48];
const NASA_LINE = "NASA's data didn't load. The Moon and planets are still here.";
/** A year not asked for yet reads as loading; one object, so a month's memo holds. */
const LOADING: YearLoad = { state: "loading" };
const ALL_NIGHTS = "chip-all-nights";

export function EveryNight() {
  const L = useListener();
  const params = useSearchParams();
  const tonight = useMemo(() => tonightDate(L.zone), [L.zone]);
  const oldest = L.sync?.oldestUts;
  // The history's first night: the route's own once a year has come (it
  // leaves out noise plays), the sync's oldest scrobble until then.
  const [serverFirst, setServerFirst] = useState<string | null>(null);
  const first = useMemo(() => {
    const f = serverFirst ?? (oldest != null ? tonightDate(L.zone, oldest * 1000) : tonight);
    return f > tonight ? tonight : f;
  }, [serverFirst, L.zone, oldest, tonight]);
  const months = useMemo(() => monthsNewestFirst(first.slice(0, 7), tonight.slice(0, 7)), [first, tonight]);
  const firstMonth = months[months.length - 1];
  const lastMonth = months[0];
  /** Each year's newest month in the history, where a year that didn't load says so. */
  const newestOfYear = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of months) if (!out.has(m.slice(0, 4))) out.set(m.slice(0, 4), m);
    return out;
  }, [months]);

  /* ---- Years, fetched as their months near the viewport ---- */
  // Keyed by URL, so another zone or another history start is another year.
  const [years, setYears] = useState<Record<string, YearLoad>>({});
  const asked = useRef(new Set<string>());
  const { listenerUrl } = L;
  const yearUrl = useCallback((y: number) => listenerUrl("nights", yearRange(y, lastMonth)), [listenerUrl, lastMonth]);
  const yearLoad = useCallback((y: number): YearLoad => years[yearUrl(y)] ?? LOADING, [years, yearUrl]);
  const want = useCallback(
    (y: number, again = false) => {
      const url = yearUrl(y);
      if (asked.current.has(url) && !again) return;
      asked.current.add(url);
      setYears((s) => ({ ...s, [url]: LOADING }));
      nightsYear(url).then(
        (data) => {
          setYears((s) => ({ ...s, [url]: { state: "ready", data } }));
          if (data.meta.first) setServerFirst(data.meta.first);
        },
        () => setYears((s) => ({ ...s, [url]: { state: "failed" } })),
      );
    },
    [yearUrl],
  );
  const retry = useCallback((y: number) => want(y, true), [want]);
  const yearsNewestFirst = useMemo(() => [...newestOfYear.keys()].map(Number), [newestOfYear]);
  const meta: Nights | null = useMemo(() => {
    for (const y of yearsNewestFirst) {
      const l = yearLoad(y);
      if (l.state === "ready") return l.data.meta;
    }
    return null;
  }, [yearsNewestFirst, yearLoad]);

  // The months near the viewport render their doors (8.5 item 3). While the
  // year strip is dragged, nothing loads: letting go asks for what's near.
  const [near, setNear] = useState<Set<string>>(() => new Set(months.slice(0, 2)));
  const calRef = useRef<HTMLDivElement>(null);
  const io = useRef<IntersectionObserver | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    want(Number(lastMonth.slice(0, 4)));
  }, [want, lastMonth]);
  useEffect(() => {
    const cal = calRef.current;
    if (!cal) return;
    io.current = new IntersectionObserver(
      (entries) => {
        if (dragging.current) return;
        const hit = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.month!);
        if (hit.length === 0) return;
        for (const m of hit) want(Number(m.slice(0, 4)));
        setNear((s) => (hit.every((m) => s.has(m)) ? s : new Set([...s, ...hit])));
      },
      { rootMargin: "800px 0px" },
    );
    for (const el of cal.querySelectorAll("[data-month]")) io.current.observe(el);
    return () => io.current?.disconnect();
  }, [months, want]);
  /** Observing again reports every month's state now: what's near loads. */
  const lookAgain = () => {
    const cal = calRef.current;
    if (!cal || !io.current) return;
    io.current.disconnect();
    for (const el of cal.querySelectorAll("[data-month]")) io.current.observe(el);
  };

  /* ---- Filters, kept in the URL so a shared link and Back keep them ---- */
  const nasaOk = meta?.nasa !== "unavailable";
  const { filter, genre } = litSelection(params, meta);
  const filterDef = filter ? SKY_FILTERS.find((f) => f.id === filter)! : null;
  const filtering = Boolean(filter || genre);
  const color = filter ? FILTER_COLOR[filter] : GENRE_COLOR;

  const [combo, setCombo] = useState<{ key: string; data: NightsCombo | "failed" } | null>(null);
  const [comboTry, setComboTry] = useState(0);
  const comboKey = filter && genre ? comboUrl(L, filter, genre) : null;
  useEffect(() => {
    if (!comboKey) return;
    let live = true;
    nightsCombo(comboKey).then(
      (data) => live && setCombo({ key: comboKey, data }),
      () => live && setCombo({ key: comboKey, data: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [comboKey, comboTry]);
  const comboFailed = Boolean(comboKey && combo?.key === comboKey && combo.data === "failed");
  const comboData = combo && combo.key === comboKey && combo.data !== "failed" ? combo.data : null;

  /** Lit nights per month, for the whole history, or null while unknown. */
  const litMonths = useMemo((): Record<string, number> | null => {
    if (filter && genre) return comboData?.months ?? null;
    if (filter) return meta?.filterMonths?.[filter] ?? (meta?.filterMonths ? {} : null);
    if (genre) return meta?.genreMonths?.[genre] ?? (meta?.genreMonths ? {} : null);
    return null;
  }, [filter, genre, comboData, meta]);
  const litTotal: number | null = !filtering
    ? null
    : filter && genre
      ? (comboData?.count ?? null)
      : filter
        ? (meta?.filterCounts?.[filter] ?? null)
        : (meta?.genreCounts?.[genre!] ?? null);

  // A month's lit count: from its nights once its year is here, else the
  // history's per-month counts. Counted once per change, not per month.
  const loadedLit = useMemo(() => {
    const out = new Map<string, number>();
    if (!filtering) return out;
    for (const y of yearsNewestFirst) {
      const l = yearLoad(y);
      if (l.state !== "ready") continue;
      for (const n of l.data.nights) {
        const m = n.date.slice(0, 7);
        out.set(m, (out.get(m) ?? 0) + (isLit(n, filter, genre) ? 1 : 0));
      }
    }
    return out;
  }, [filtering, yearsNewestFirst, yearLoad, filter, genre]);
  const litIn = useCallback((m: string): number | undefined => loadedLit.get(m) ?? (litMonths ? (litMonths[m] ?? 0) : undefined), [loadedLit, litMonths]);
  const collapsed = useMemo(
    () => (filtering ? collapse(months, filter, litIn) : new Map<string, "nothing" | "coverage" | "hidden">()),
    [filtering, months, filter, litIn],
  );
  /** A night whose month can't draw a door now: folded by the filter, or its year didn't load. */
  const blocked = useCallback(
    (date: string) => collapsed.has(date.slice(0, 7)) || yearLoad(Number(date.slice(0, 4))).state === "failed",
    [collapsed, yearLoad],
  );

  /* ---- The roving door (11) ---- */
  const [active, setActive] = useState(tonight);
  // The calendar's one tab stop: the active night, or, when its month is
  // folded, the nearest night in time that can be a door.
  const tabStop = useMemo(() => {
    if (!blocked(active)) return active;
    for (let d = 1; d < 8000; d++) {
      const before = addDays(active, -d);
      const after = addDays(active, d);
      if (before < first && after > tonight) break;
      if (before >= first && !blocked(before)) return before;
      if (after <= tonight && !blocked(after)) return after;
    }
    return active;
  }, [active, blocked, first, tonight]);
  const pendingFocus = useRef<string | null>(null);
  const focusDoor = useCallback(
    (date: string) => {
      const m = date.slice(0, 7);
      pendingFocus.current = date;
      setActive(date);
      setNear((s) => (s.has(m) ? s : new Set([...s, m])));
      want(Number(m.slice(0, 4)));
    },
    [want],
  );
  useEffect(() => {
    const date = pendingFocus.current;
    if (!date) return;
    const el = calRef.current?.querySelector<HTMLElement>(`[data-door="${date}"]`);
    if (!el) return;
    pendingFocus.current = null;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const door = (e.target as HTMLElement).closest<HTMLElement>("[data-door]");
    if (!door || e.altKey || e.ctrlKey || e.metaKey) return;
    // From the night focus is on its way to, while its month draws: keys
    // pressed faster than a year loads still each move a step (11).
    const from = pendingFocus.current ?? door.dataset.door!;
    if (!stepNight(from, e.key, first, tonight)) return;
    e.preventDefault();
    // Past the months a filter folded, to a night that can be a door, or nowhere.
    const next = stepPast(from, e.key, first, tonight, blocked);
    if (next) focusDoor(next);
  };
  // Focus gone elsewhere: a night still loading doesn't pull it back.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) pendingFocus.current = null;
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const door = (e.target as HTMLElement).closest<HTMLElement>("[data-door]");
    if (!door) return;
    setActive(door.dataset.door!);
    if (door.getAttribute("aria-disabled") === "true") return;
    L.open({ kind: "night", value: door.dataset.door! });
  };

  /* ---- The sticky bar, the dock, and what they cover (10, 11) ---- */
  const barRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // The shell's header sticks above the bar on this view (Shell.tsx): the
  // bar hangs under it, and everything that clears the top clears both.
  const [headH, setHeadH] = useState(0);
  const [barH, setBarH] = useState(0);
  const [dockH, setDockH] = useState(0);
  useEffect(() => {
    const head = document.querySelector<HTMLElement>("[data-listener-head]");
    const ro = new ResizeObserver(() => {
      setHeadH(head?.offsetHeight ?? 0);
      setBarH(barRef.current?.offsetHeight ?? 0);
      setDockH(dockRef.current?.offsetHeight ?? 0);
    });
    if (head) ro.observe(head);
    if (barRef.current) ro.observe(barRef.current);
    if (dockRef.current) ro.observe(dockRef.current);
    return () => ro.disconnect();
  }, [filtering]);
  // A focused door scrolls clear of the header and bar above and the dock below (11).
  useEffect(() => {
    const html = document.documentElement;
    const top = html.style.scrollPaddingTop;
    const bottom = html.style.scrollPaddingBottom;
    html.style.scrollPaddingTop = `${headH + barH + 8}px`;
    if (filtering && dockH) html.style.scrollPaddingBottom = `${dockH + 24}px`;
    return () => {
      html.style.scrollPaddingTop = top;
      html.style.scrollPaddingBottom = bottom;
    };
  }, [headH, barH, dockH, filtering]);

  /* ---- The month in view, for the year strip ---- */
  const [inView, setInView] = useState(lastMonth);
  const [far, setFar] = useState(false);

  // A filter folds the dark months above the one you're reading: keep that
  // month where it was on the screen.
  const anchor = useRef<{ month: string; top: number } | null>(null);
  const setFilters = (next: { filter?: string | null; genre?: string | null }) => {
    const el = document.getElementById(`month-${inView}`);
    anchor.current = el && window.scrollY > 0 ? { month: inView, top: el.getBoundingClientRect().top } : null;
    replaceParams(next);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const el = a && document.getElementById(`month-${a.month}`);
    if (a && el) window.scrollBy({ top: el.getBoundingClientRect().top - a.top, behavior: "instant" });
  }, [filter, genre]);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      // "Back to top" once a screen has gone by.
      setFar(window.scrollY > window.innerHeight);
      const cal = calRef.current;
      if (!cal) return;
      const probe = (barRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      const box = cal.getBoundingClientRect();
      if (box.top > probe) return setInView(lastMonth);
      const hit = document.elementFromPoint(box.left + box.width / 2, probe)?.closest<HTMLElement>("[data-month]");
      if (hit) setInView(hit.dataset.month!);
      else if (box.bottom < probe) setInView(firstMonth);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [lastMonth, firstMonth]);

  /** The strip moved (8.5): the list scrolls to the month; letting go
      settles on its first night and loads what's near. */
  const seek = (m: string, settle: boolean) => {
    dragging.current = !settle;
    setInView(m);
    const el = document.getElementById(`month-${m}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headH - barH - 4, behavior: "instant" });
    if (!settle) return;
    setNear((s) => (s.has(m) ? s : new Set([...s, m])));
    want(Number(m.slice(0, 4)));
    setActive(m === first.slice(0, 7) ? first : `${m}-01`);
    lookAgain();
  };

  /* ---- The dock (8.5 item 5) ---- */
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const q = filterDef?.question && answers ? (answers.questions.find((x) => x.id === filterDef.question) ?? null) : null;
  const counts = L.highlights.state === "ready" ? L.highlights.data.counts : undefined;
  const logged = filter === "storm" ? (counts?.storms ?? null) : filter === "xflare" ? (counts?.xflares ?? null) : null;
  const lines = filtering && litTotal !== null ? dockLines(filter, genre, litTotal, q, logged) : null;
  // Said once when a filter changes: the dock's count (11).
  const live = lines ? `${lines.count} ${lines.what}` : "";

  const randomDoor = async () => {
    if (!litMonths) return;
    const m = pickMonth(litMonths, Math.random());
    if (!m) return;
    const y = Number(m.slice(0, 4));
    want(y);
    try {
      const data = await nightsYear(yearUrl(y));
      const lit = data.nights.filter((n) => n.date.startsWith(m) && isLit(n, filter, genre));
      if (lit.length === 0) return;
      const d = lit[Math.floor(Math.random() * lit.length)].date;
      seek(m, true);
      setActive(d);
      L.open({ kind: "night", value: d });
    } catch {
      /* the year didn't load; its months say so */
    }
  };
  const clear = () => {
    setFilters({ filter: null, genre: null });
    // The dock goes with the filter: focus moves to "All nights", not the page.
    requestAnimationFrame(() => document.getElementById(ALL_NIGHTS)?.focus());
  };

  const loadingBar = !meta;
  const skyChips = SKY_FILTERS.filter((f) => (nasaOk || !f.nasa) && (meta?.filterCounts?.[f.id] ?? 0) > 0);
  const genreChips = Object.entries(meta?.genreCounts ?? {}).filter(([, n]) => n > 0);
  const oldestFirst = useMemo(() => [...months].reverse(), [months]);

  return (
    <div className="mt-4">
      <h1 id={VIEW_HEADING} tabIndex={-1} className="sr-only">
        Every night
      </h1>

      <div
        ref={barRef}
        style={{ top: headH }}
        className="sticky z-20 -mx-4 border-b border-[var(--line)] bg-[rgba(11,16,38,.97)] pt-1 pb-1.5 backdrop-blur-md"
        data-nights-bar
      >
        {loadingBar ? (
          <div className="flex gap-1.5 overflow-hidden px-4 py-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton h-11 w-28 shrink-0 rounded-full" />
            ))}
          </div>
        ) : (
          // A Roster Carousel (10, 12), like every sideways row: a mouse drags
          // it, and where a pointer can hover, arrows over its two ends page
          // it. Overlaid, they take no line of their own: the bar stays under 112px.
          <Carousel
            aria-label="Light up nights"
            gap={6}
            gutter={16}
            snapStrictness="proximity"
            arrowPlacement="overlay"
            prevLabel="Previous filters"
            nextLabel="Next filters"
          >
            <FilterChip
              id={ALL_NIGHTS}
              label="All nights"
              selected={!filtering}
              color="var(--gold)"
              onToggle={() => setFilters({ filter: null, genre: null })}
            />
            {skyChips.map((f) => (
              <FilterChip
                key={f.id}
                label={f.label}
                count={meta.filterCounts![f.id]}
                selected={filter === f.id}
                color={FILTER_COLOR[f.id]}
                icon={FILTER_ICON[f.id]}
                glyph={FILTER_GLYPH[f.id]}
                moon={f.id === "fullmoon" ? 180 : f.id === "newmoon" ? 0 : undefined}
                onToggle={(on) => setFilters({ filter: on ? f.id : null })}
              />
            ))}
            {/* The second group (7.6), named by the item before it. */}
            {genreChips.length > 0 && (
              <span className="flex h-11 items-center border-l border-[var(--line-2)] pl-2.5 text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap text-ink-2 uppercase">
                Your genres
              </span>
            )}
            {genreChips.map(([g, n]) => (
              <FilterChip key={g} label={g} count={n} selected={genre === g} color={GENRE_COLOR} onToggle={(on) => setFilters({ genre: on ? g : null })} />
            ))}
          </Carousel>
        )}
        <YearStrip months={oldestFirst} current={inView} lit={litMonths} color={color} onSeek={seek} loading={loadingBar} />
      </div>
      {meta && !nasaOk && <p className="mt-3 text-[13px] text-ink-2">{NASA_LINE}</p>}
      <p role="status" className="sr-only">
        {live}
      </p>

      <div
        ref={calRef}
        className="nights-cal"
        data-filtering={filtering || undefined}
        style={{ "--fc": color } as CSSProperties}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onBlur={onBlur}
      >
        {months.map((m) => (
          // A stable element per month, for the observer and the year strip, whatever the month shows.
          <div key={m} id={`month-${m}`} data-month={m}>
            <MonthBlock
              month={m}
              load={yearLoad(Number(m.slice(0, 4)))}
              near={near.has(m)}
              fold={collapsed.get(m) ?? null}
              coverage={filter ? (COVERAGE[filter]?.line ?? null) : null}
              firstOfYear={newestOfYear.get(m.slice(0, 4)) === m}
              filter={filter}
              genre={genre}
              active={tabStop.startsWith(m) ? tabStop : null}
              tonight={tonight}
              first={first}
              nasaOk={nasaOk}
              onRetry={retry}
            />
          </div>
        ))}
      </div>

      <div className="mt-12" data-nights-below>
        <QuestionsGrid />
        <CompareCard />
      </div>

      {filtering && (
        <div
          ref={dockRef}
          role="region"
          aria-label="Lit nights"
          data-nights-dock
          className="fixed bottom-[max(10px,env(safe-area-inset-bottom))] left-1/2 z-30 w-[min(420px,calc(100%-20px))] -translate-x-1/2 rounded-2xl border border-[color-mix(in_srgb,var(--fc)_50%,transparent)] bg-[rgba(16,20,46,.96)] p-3 pl-3.5 shadow-[0_16px_40px_rgba(0,0,0,.55)] backdrop-blur-md"
          style={{ "--fc": color } as CSSProperties}
        >
          {lines ? (
            <>
              <p className="flex items-baseline gap-2.5">
                <span className="font-display text-[26px] leading-none text-[var(--fc)] tabular-nums">{lines.count}</span>{" "}
                <span className="text-[14px] leading-snug text-ink">{lines.what}</span>
              </p>
              {lines.noun && <p className="mt-1 text-[12px] leading-snug text-ink-2">{lines.noun}</p>}
              {lines.question && filterDef?.question && (
                <SheetLink
                  to={{ kind: "q", value: filterDef.question }}
                  className="group mt-1 flex min-h-11 items-center justify-between gap-2 text-[13px] leading-snug text-ink"
                >
                  {lines.question}
                  <Chevron />
                </SheetLink>
              )}
              {lines.facts && <p className="mt-1 text-[12px] leading-snug text-ink-2">{lines.facts}</p>}
            </>
          ) : comboFailed ? (
            <p className="flex flex-wrap items-center gap-x-3 text-[14px] text-ink-2">
              <span>The count didn&rsquo;t load.</span>
              <Button
                size="lg"
                variant="link"
                onClick={() => {
                  setCombo(null);
                  setComboTry((t) => t + 1);
                }}
              >
                Try again
              </Button>
            </p>
          ) : (
            <span className="skeleton block h-7 w-3/4" aria-hidden />
          )}
          <div className="mt-1 flex items-center justify-end gap-2">
            <Button size="lg" variant="outline" startIcon={<Icon name="shuffle" />} onClick={() => void randomDoor()} disabled={!litMonths || !litTotal}>
              Random lit door
            </Button>
            <Button size="lg" variant="outline" onClick={clear}>
              Clear
            </Button>
          </div>
        </div>
      )}
      {/* Room to scroll the oldest doors clear of the dock (8.5, 11). */}
      {filtering && <div aria-hidden style={{ height: dockH + 16 }} />}
      <BackToTop shown={far} lift={filtering ? dockH + 10 : 0} />
    </div>
  );
}

/* ---- Back to top (Blake, 3 Oct 2026) --------------------------------------- */

/** Once a screen has gone by, a way back to tonight's month and the filters.
    Built as "Surprise me" is on Tonight: a 56px round button on a phone, a
    labeled one from 640px, in the margin from 1124px; over the dock when a
    filter is on. Focus goes to the view's heading, not the page. */
function BackToTop({ shown, lift }: { shown: boolean; lift: number }) {
  const phone = useMedia("(max-width: 639.98px)");
  const go = () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
    document.getElementById(VIEW_HEADING)?.focus({ preventScroll: true });
  };
  return (
    <div
      style={{ "--lift": `${lift}px` } as CSSProperties}
      className={`fixed right-4 bottom-[calc(16px+var(--lift)+env(safe-area-inset-bottom))] z-30 transition-[opacity,transform] duration-200 motion-reduce:transition-none sm:right-[max(16px,calc((100vw-720px)/2+16px))] min-[1124px]:right-auto min-[1124px]:bottom-[calc(16px+env(safe-area-inset-bottom))] min-[1124px]:left-[calc(50%+376px)] ${
        shown ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
      }`}
      inert={!shown}
      data-back-to-top
    >
      {phone ? (
        <Button
          size="icon"
          variant="outline"
          aria-label="Back to top"
          onClick={go}
          className="!size-14 rounded-full bg-[var(--surface-2)] shadow-[0_10px_30px_rgba(0,0,0,.5)]"
        >
          <Icon name="up" className="size-6" />
        </Button>
      ) : (
        <Button
          size="lg"
          variant="outline"
          startIcon={<Icon name="up" />}
          onClick={go}
          className="rounded-full bg-[var(--surface-2)] shadow-[0_10px_30px_rgba(0,0,0,.5)]"
        >
          Back to top
        </Button>
      )}
    </div>
  );
}

/* ---- A filter chip (8.5 item 2, 11: a toggle with its count in its name) -- */

function FilterChip({
  id,
  label,
  count,
  selected,
  color,
  icon,
  glyph,
  moon,
  onToggle,
}: {
  id?: string;
  label: string;
  count?: number;
  selected: boolean;
  color: string;
  icon?: IconName;
  glyph?: string;
  moon?: number;
  onToggle: (on: boolean) => void;
}) {
  const lead = icon ? (
    <Icon name={icon} className="size-3.5" />
  ) : glyph ? (
    <span className="font-glyph text-[15px] leading-none">{glyph}</span>
  ) : moon !== undefined ? (
    <DoorMoon phase={moon} eclipse={null} className="size-3.5" />
  ) : undefined;
  return (
    <Chip
      id={id}
      size="md"
      variant="outline"
      colorScheme="neutral"
      selected={selected}
      onSelectedChange={onToggle}
      leadingIcon={lead}
      // The count is part of the name (11): "Storm nights, 92".
      aria-label={count === undefined ? undefined : `${label}, ${count.toLocaleString("en-US")}`}
      style={{ "--fc": color } as CSSProperties}
      className="h-11 gap-1.5 border-[var(--line-2)] bg-[rgba(23,28,61,.8)] pr-3 pl-2.5 text-[13px] font-semibold text-ink-2 hover:text-ink aria-pressed:border-[var(--fc)] aria-pressed:bg-[color-mix(in_srgb,var(--fc)_18%,#10142e)] aria-pressed:text-ink aria-pressed:shadow-[0_0_16px_color-mix(in_srgb,var(--fc)_35%,transparent)] [&>span:first-child]:text-[var(--fc)]"
    >
      {label}
      {count !== undefined && (
        <b className="rounded-full bg-[rgba(255,255,255,.06)] px-1.5 text-[11.5px] font-bold text-ink-2 tabular-nums">{count.toLocaleString("en-US")}</b>
      )}
    </Chip>
  );
}

/* ---- The year strip (8.5 item 2, 11: a slider, tap to seek) -------------- */

function YearStrip({
  months,
  current,
  lit,
  color,
  onSeek,
  loading,
}: {
  /** Oldest first. */
  months: string[];
  current: string;
  lit: Record<string, number> | null;
  color: string;
  onSeek: (month: string, settle: boolean) => void;
  loading: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const n = months.length;
  const index = Math.max(0, months.indexOf(current));
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return months[Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)))];
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    // The main button only: a right-click's menu may never send pointerup.
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(at(e.clientX), false);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => dragging.current && onSeek(at(e.clientX), false);
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onSeek(at(e.clientX), true);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12, Home: -n, End: n };
    if (!(e.key in step)) return;
    e.preventDefault();
    onSeek(months[Math.min(n - 1, Math.max(0, index + step[e.key]))], true);
  };
  const max = lit ? Math.max(1, ...months.map((m) => lit[m] ?? 0)) : 1;
  const w = 100 / n;
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2 px-4">
      {/* One line each, whatever the month: two would push the bar past 112px (10). */}
      <p className="font-display text-[17px] leading-tight whitespace-nowrap text-ink" aria-hidden>
        {loading ? <span className="skeleton block h-5 w-20" /> : monthShort(current)}
        {lit && <small className="block font-body text-[11px] text-ink-2">{(lit[current] ?? 0).toLocaleString("en-US")} lit</small>}
      </p>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Month"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={index}
        aria-valuetext={monthTitle(current)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onLostPointerCapture={() => {
          // However a drag ends (canceled, or its capture lost), it lets go: what's near loads.
          if (!dragging.current) return;
          dragging.current = false;
          onSeek(current, true);
        }}
        onKeyDown={key}
        className="relative h-11 cursor-pointer touch-none rounded-lg"
      >
        <svg className="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden>
          <rect x="0" y="34" width="100" height="1" fill="var(--line-2)" />
          {lit &&
            months.map((m, i) =>
              lit[m] ? (
                <rect key={m} x={i * w + w * 0.1} width={w * 0.8} y={34 - (lit[m] / max) * 28} height={(lit[m] / max) * 28} fill={color} opacity={0.85} />
              ) : null,
            )}
          {months.map((m, i) =>
            m.endsWith("-01") || i === 0 ? <rect key={`y${m}`} x={i * w} y="34" width="0.25" height="6" fill="var(--text-muted)" /> : null,
          )}
          <rect
            x={index * w}
            y="2"
            width={Math.max(w, 0.8)}
            height="40"
            rx="0.6"
            fill="none"
            stroke="var(--gold)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

/* ---- A month (8.5 items 3 and 4, and its states) -------------------------- */

const MonthBlock = memo(function MonthBlock({
  month,
  load,
  near,
  fold,
  coverage,
  firstOfYear,
  filter,
  genre,
  active,
  tonight,
  first,
  nasaOk,
  onRetry,
}: {
  month: string;
  load: YearLoad;
  near: boolean;
  fold: "nothing" | "coverage" | "hidden" | null;
  coverage: string | null;
  firstOfYear: boolean;
  filter: SkyFilterId | null;
  genre: string | null;
  active: string | null;
  tonight: string;
  first: string;
  nasaOk: boolean;
  onRetry: (year: number) => void;
}) {
  const headingId = useId();
  const title = monthTitle(month);
  const year = Number(month.slice(0, 4));
  const weeks = useMemo(() => monthWeeks(month), [month]);

  // A year that failed: its months show one line, at its newest month
  // (8.5), whatever a filter would fold.
  if (load.state === "failed") {
    return firstOfYear ? (
      <p className="flex flex-wrap items-center gap-x-3 pt-6 text-ink-2">
        {/* One element: as two flex items, the year and its words read as "2023didn't". */}
        <span>{`${year} didn’t load.`}</span>
        <Button size="lg" variant="link" onClick={() => onRetry(year)}>
          Try again
        </Button>
      </p>
    ) : null;
  }
  if (fold === "hidden") return null;
  if (fold === "coverage" || fold === "nothing") {
    return <p className="pt-4 text-[14px] text-ink-2">{fold === "coverage" ? coverage : `Nothing in ${title}`}</p>;
  }

  const nights = load.state === "ready" ? load.data.nights.filter((n) => n.date.startsWith(month)) : null;
  const byDate = nights ? new Map(nights.map((n) => [n.date, n])) : null;
  const listened = nights?.filter((n) => n.plays > 0) ?? [];
  const plays = listened.reduce((s, n) => s + n.plays, 0);
  const rows = weeks.length;

  return (
    <section aria-labelledby={headingId} className="pt-6">
      <div className="flex min-h-7 items-baseline justify-between gap-2">
        <h2 id={headingId} className="font-display text-[21px] leading-tight text-ink">
          {title}
        </h2>
        <p className="text-right text-[12px] text-ink-2">
          {nights ? (
            listened.length ? (
              `${listened.length.toLocaleString("en-US")} night${listened.length === 1 ? "" : "s"} · ${plays.toLocaleString("en-US")} play${plays === 1 ? "" : "s"}`
            ) : (
              "No listening"
            )
          ) : (
            <span className="skeleton inline-block h-3.5 w-28 align-middle" aria-hidden />
          )}
        </p>
      </div>
      <div className="mt-2.5 mb-1.5 grid grid-cols-7 gap-[5px] text-center text-[10.5px] tracking-[0.1em] text-ink-2 uppercase" aria-hidden>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      {byDate && near ? (
        <div role="grid" aria-labelledby={headingId} className="door-grid">
          {weeks.map((week, r) => (
            <div role="row" key={r}>
              {week.map((date, c) => (
                <div role="gridcell" key={c}>
                  {date && date >= first && (
                    <Door
                      date={date}
                      night={byDate.get(date) ?? null}
                      tonight={date === tonight}
                      future={date > tonight}
                      active={date === active}
                      filter={filter}
                      genre={genre}
                      nasaOk={nasaOk}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        // The month's exact height, so nothing jumps when its doors arrive.
        <div className={`door-ph ${near ? "skeleton" : ""}`} style={{ "--rows": rows } as CSSProperties} aria-hidden />
      )}
    </section>
  );
});

/* ---- A door (8.5 item 4, 11) ---------------------------------------------- */

function Door({
  date,
  night,
  tonight,
  future,
  active,
  filter,
  genre,
  nasaOk,
}: {
  date: string;
  night: Night | null;
  tonight: boolean;
  future: boolean;
  active: boolean;
  filter: string | null;
  genre: string | null;
  nasaOk: boolean;
}) {
  const day = Number(date.slice(8, 10));
  if (future || (!night && !tonight)) {
    // The rest of this month: drawn, dashed, not a door yet (8.5).
    return (
      <span className="door-future" aria-hidden>
        <span className="door-dn">{day}</span>
      </span>
    );
  }
  const plays = night?.plays ?? 0;
  const lit = Boolean(night && (filter || genre) && isLit(night, filter, genre));
  const s = night?.space;
  const badges = night
    ? BADGES.filter((b) =>
        b.id === "eclipse"
          ? Boolean(night.eclipse)
          : b.id === "firstplay"
            ? night.firstPlays.length > 0
            : nasaOk && (b.id === "storm" ? s?.kp != null : b.id === "xflare" ? Boolean(s?.xFlare) : Boolean(s?.asteroid && s.asteroid.ld < 1)),
      )
    : [];
  const phase = night?.moon.phaseAngle ?? 0;
  const name = doorName({
    date,
    plays,
    usual: night?.usualForWeekday ?? null,
    tonight,
    moon: night ? phaseName(phase) : null,
    eclipse: night?.eclipse?.kind ?? null,
    kp: nasaOk ? (s?.kpText ?? null) : null,
    // The class ("X5.8"): xFlare only says the biggest flare was an X.
    flare: nasaOk && s?.xFlare ? s.biggestFlare : null,
    asteroid: nasaOk && Boolean(s?.asteroid && s.asteroid.ld < 1),
    firstHeard: night?.firstPlays ?? [],
    wild: night?.wild?.title ?? null,
    lit,
  });
  const opens = plays > 0 || tonight;
  return (
    <button
      type="button"
      className="door"
      data-door={date}
      data-lit={lit || undefined}
      data-wild={night?.wild ? true : undefined}
      data-tonight={tonight || undefined}
      tabIndex={active ? 0 : -1}
      aria-label={name}
      aria-disabled={opens ? undefined : true}
      aria-haspopup={opens ? "dialog" : undefined}
      style={{ "--t": TINT[playsLevel(plays, night?.usualForWeekday ?? null)] } as CSSProperties}
    >
      <span className="door-dn" aria-hidden>
        {day}
      </span>
      {night && <DoorMoon phase={phase} eclipse={night.eclipse?.kind ?? null} className="door-moon" />}
      {tonight ? (
        <span className="door-tag" aria-hidden>
          Tonight
        </span>
      ) : (
        badges.length > 0 && (
          <span className="door-badges" aria-hidden>
            {badges.map((b) => (
              <span key={b.id} style={{ color: b.color }}>
                <Icon name={b.icon} className="door-badge" />
              </span>
            ))}
          </span>
        )
      )}
    </button>
  );
}

/** A door's Moon at 9 p.m. (8.5, 8.9): its phase, or the eclipse that night. */
function DoorMoon({ phase, eclipse, className }: { phase: number; eclipse: string | null; className: string }) {
  const id = useId();
  const dark = "#1e2448";
  const light = "#ece6cf";
  let body;
  if (eclipse?.endsWith("solar")) {
    // A ring: the Sun's edge around the Moon (8.5).
    body = <circle cx="10" cy="10" r="7.6" fill="#0b1026" stroke="#fbe9a6" strokeWidth="1.6" />;
  } else if (eclipse === "total lunar") {
    body = <circle cx="10" cy="10" r="8" fill="#b4533a" />;
  } else if (eclipse === "partial lunar") {
    body = (
      <>
        <mask id={id}>
          <rect width="20" height="20" fill="white" />
          <circle cx="15" cy="6" r="7" fill="black" />
        </mask>
        <circle cx="10" cy="10" r="8" fill={dark} />
        <circle cx="10" cy="10" r="8" fill={light} mask={`url(#${id})`} />
      </>
    );
  } else if (eclipse === "penumbral lunar") {
    body = <circle cx="10" cy="10" r="8" fill={light} opacity="0.45" />;
  } else {
    const lit = moonLit(phase, 10, 8);
    body = (
      <>
        <circle cx="10" cy="10" r="8" fill={dark} stroke="rgba(242,239,230,.25)" strokeWidth="0.6" />
        {lit === "full" ? <circle cx="10" cy="10" r="8" fill={light} /> : lit !== "none" ? <path d={lit} fill={light} /> : null}
      </>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      {body}
    </svg>
  );
}
