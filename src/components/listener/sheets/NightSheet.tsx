"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { getJson, type Night, type Nights } from "../api";
import { comboUrl, historySpan, isLit, litSelection, nightsCombo, nightsYear, yearUrl } from "../nightsCache";
import { genreMix, nightTitle, nightWeekday, songIndex, tonightDate, utsAtLocal } from "../format";
import { SheetLink } from "../cards";
import { sheetFrom } from "../sheetUrl";
import { AnswerPill, Chevron, Icon, SheetFailed, SheetSkeleton, Term } from "../pieces";
import { DIGNITY_COLOR, SkyWheel, planetGlyph } from "../sky";
import { Gallery, NightFacts, useNight, useSkyAt } from "./nightParts";

/* A night, and a wild night (spec 8.7.2). */

const H3 = "mt-8 text-[13px] font-semibold uppercase tracking-[0.12em] text-gold";

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export default function NightSheet({ value, setTitle, setBusy, invalid, lead, retry }: SheetBodyProps) {
  const L = useListener();
  const load = useNight(value);
  const night = load.state === "ready" ? load.night : null;
  const nine = night ? utsAtLocal(night.date, 21, L.zone) : null;
  const sky = useSkyAt(nine);
  const [stepping, setStepping] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const tonight = tonightDate(L.zone);

  useEffect(() => {
    if (load.state !== "ready") return;
    // Outside the history, in the future, or a past night with no plays
    // (8.7). Tonight opens before its first play (8.5).
    if (!load.night || (load.night.plays === 0 && load.night.date !== tonight)) invalid();
    else setTitle(nightTitle(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once it loads
  }, [load.state]);
  useEffect(() => setBusy(load.state === "loading"), [load.state, setBusy]);

  if (load.state === "failed") return <SheetFailed retry={retry} />;
  if (load.state === "loading") return <SheetSkeleton />;
  if (!night || (night.plays === 0 && night.date !== tonight)) return null;

  // The previous and next night with listening (or tonight), or, with Every
  // night's filters on, the previous and next lit night (8.5, 8.7.2 item 7).
  const step = async (dir: 1 | -1) => {
    if (stepping || load.state !== "ready") return;
    setStepping(true);
    try {
      const next = await stepFrom(dir);
      // The sheet may have closed while a month or a year loaded.
      if (next && sheetFrom(new URLSearchParams(window.location.search))?.value === value) L.open({ kind: "night", value: next });
    } catch {
      /* the arrows just don't move */
    } finally {
      setStepping(false);
    }
  };
  /** The nearest night that way in a list that passes, or null. */
  const nearest = (list: Night[], dir: 1 | -1, ok: (n: Night) => boolean) => {
    const c = list.filter((n) => ok(n) && (dir > 0 ? n.date > value : n.date < value));
    return (dir > 0 ? c[0] : c[c.length - 1])?.date ?? null;
  };
  const stepFrom = async (dir: 1 | -1): Promise<string | null> => {
    const params = new URLSearchParams(window.location.search);
    // No filter: the nearest night with listening, month by month, as the
    // landing's samples are served.
    const byMonth = async () => {
      const listened = (n: Night) => n.plays > 0 || n.date === tonight;
      let month = value.slice(0, 7);
      let list = load.month;
      for (let i = 0; i < 13; i++) {
        const next = nearest(list, dir, listened);
        if (next) return next;
        month = shiftMonth(month, dir);
        if (dir > 0 && month > tonight.slice(0, 7)) return null;
        list = (await getJson<Nights>(L.listenerUrl("nights", `&from=${month}&to=${month}`))).nights ?? [];
      }
      return null;
    };
    if (!params.get("filter") && !params.get("genre")) return byMonth();
    // Filtered: the filters the calendar applies, checked the same way, and
    // the months they light (the whole history), so a dark year is skipped.
    const here = await nightsYear(yearUrl(L, Number(value.slice(0, 4))));
    // The route's own first night, not the sync's (see SheetHost).
    const firstMonth = (here.meta.first ?? historySpan(L).first).slice(0, 7);
    const { lastMonth } = historySpan(L);
    const { filter, genre } = litSelection(params, here.meta);
    if (!filter && !genre) return byMonth();
    const ok = (n: Night) => isLit(n, filter, genre);
    const inMonth = nearest(load.month, dir, ok);
    if (inMonth) return inMonth;
    const counts =
      filter && genre ? (await nightsCombo(comboUrl(L, filter, genre))).months : filter ? here.meta.filterMonths?.[filter] : here.meta.genreMonths?.[genre!];
    const month = value.slice(0, 7);
    let candidates: string[];
    if (counts) {
      candidates = Object.keys(counts)
        .filter((m) => counts[m] > 0 && (dir > 0 ? m > month : m < month))
        .sort();
      if (dir < 0) candidates.reverse();
    } else {
      // No monthly counts (a record being rebuilt): every month that way.
      candidates = [];
      for (let m = shiftMonth(month, dir); m >= firstMonth && m <= lastMonth; m = shiftMonth(m, dir)) candidates.push(m);
    }
    for (const m of candidates) {
      const year = await nightsYear(yearUrl(L, Number(m.slice(0, 4))));
      const next = nearest(year.nights.filter((n) => n.date.startsWith(m)), dir, ok);
      if (next) return next;
    }
    return null;
  };

  const onPointerDown = (e: PointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(e.clientY - s.y)) void step(dx < 0 ? 1 : -1);
  };

  const sofar = night.date === tonight ? " so far" : "";
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const songs = songIndex(L.songs.state === "ready" ? L.songs.data : undefined);
  const mix = genreMix(night.genres);
  const conditions = QUESTIONS.filter((q) => night.conditions.includes(q.id));

  return (
    <div className="pb-4" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      {(lead || night.wild) && (
        <div className="mb-4">
          {night.wild && <p className="font-display text-[22px] leading-snug text-gold">{night.wild.title}</p>}
          {night.wild && <p className="mt-1 leading-relaxed text-ink">{night.wild.story}</p>}
          {lead && <p className="mt-2 leading-relaxed text-ink">{lead}</p>}
        </div>
      )}

      <Gallery night={night} />

      <h3 className={H3}>Your night</h3>
      {/* "39 plays that night · a usual Friday is 46", with "that night" (or
          "tonight", "so far") as the term (8.7.2, 9.4). */}
      <p className="mt-2 text-[17px] text-ink">
        {night.plays.toLocaleString("en-US")} play{night.plays === 1 ? "" : "s"}{" "}
        <Term name="A night" label={sofar ? "tonight" : "that night"} className="text-inherit" />
        {sofar}
        {night.usualForWeekday !== null ? ` · a usual ${nightWeekday(night.date)} is ${night.usualForWeekday.toLocaleString("en-US")}` : ""}
      </p>
      {night.afterMidnight > 0 && (
        <p className="mt-1 text-ink-2">
          {night.afterMidnight.toLocaleString("en-US")} of them after midnight{sofar}
        </p>
      )}
      {mix && <p className="mt-1 text-ink-2">{mix}</p>}
      {night.firstPlays.length > 0 && (
        <ul className="mt-3 space-y-2">
          {night.firstPlays.map((fp) => (
            <li key={fp.songId}>
              {songs.has(fp.songId) ? (
                <SheetLink to={{ kind: "song", value: fp.songId }} className="group flex items-center gap-3 rounded-xl bg-[rgba(242,239,230,.04)] px-3 py-2.5 hover:bg-[rgba(242,239,230,.08)]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-ink">
                      First heard {fp.track} by {fp.artist}
                    </span>
                    {fp.pairing && <span className="mt-1 block text-[14px] text-ink-2">{fp.pairing}</span>}
                  </span>
                  <Chevron />
                </SheetLink>
              ) : (
                <div className="rounded-xl px-3 py-2.5">
                  <span className="block text-ink">
                    First heard {fp.track} by {fp.artist}
                  </span>
                  {fp.pairing && <span className="mt-1 block text-[14px] text-ink-2">{fp.pairing}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className={H3}>The sky</h3>
      <p className="mt-1 text-[13px] text-ink-2">At 9 p.m. {sofar ? "tonight" : "that night"}.</p>
      <div className="mt-3 flex justify-center">
        {sky === "failed" ? (
          <SheetFailed retry={retry} />
        ) : sky ? (
          <SkyWheel bodies={sky.bodies} size={260} />
        ) : (
          <div className="skeleton size-[260px] rounded-full" aria-hidden />
        )}
      </div>
      {/* The wheel shows one minute and the night lasts 24 hours, so every
          sign change and station in it is named, with its time (8.7.2). */}
      {night.changes && night.changes.length > 0 && (
        <ul className="mt-3 space-y-1 text-center text-[14px] text-ink">
          {night.changes.map((c) => (
            <li key={`${c.time}-${c.body}`}>{c.text}</li>
          ))}
        </ul>
      )}
      {sky && sky !== "failed" && (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {sky.bodies.map((b) => (
            <li key={b.body} className="flex items-center gap-3 py-2">
              <span aria-hidden className="font-glyph w-6 text-center text-xl" style={{ color: DIGNITY_COLOR[b.dignity] ?? "var(--text-secondary)" }}>
                {planetGlyph(b.body)}
              </span>
              <span className="text-[15px] text-ink">{b.line ?? `${b.body} in ${b.sign} · ${b.dignityPhrase}`}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className={H3}>Space weather and visitors</h3>
      <NightFacts night={night} aspects={sky && sky !== "failed" ? sky.aspects : undefined} sofar={Boolean(sofar)} />

      {conditions.length > 0 && (
        <>
          <h3 className={H3}>Does this kind of night move you?</h3>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {conditions.map((q) => {
              const a = answers?.questions.find((x) => x.id === q.id);
              return (
                <li key={q.id}>
                  <SheetLink to={{ kind: "q", value: q.id }} className="group flex min-h-11 items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 text-[15px] text-ink">
                      Question {q.number}: {q.shortName}
                      {night.conditionNotes?.[q.id] ? <span className="text-ink-2"> · {night.conditionNotes[q.id]}</span> : null}
                    </span>
                    {a && <AnswerPill word={a.word} />}
                    <Chevron />
                  </SheetLink>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button size="lg" variant="outline" onClick={() => void step(-1)} disabled={stepping} aria-label="Previous night">
          <span aria-hidden>&larr;</span>
        </Button>
        {L.sampleLabel ? (
          <span />
        ) : (
          <Button size="lg" startIcon={<Icon name="share" />} onClick={() => L.open({ kind: "share", value: `night:${night.date}` })}>
            Share this night
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={() => void step(1)} disabled={stepping} aria-label="Next night">
          <span aria-hidden>&rarr;</span>
        </Button>
      </div>
    </div>
  );
}
