"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { getJson, type Nights } from "../api";
import { genreMix, nightTitle, nightWeekday, songIndex, tonightDate, utsAtLocal } from "../format";
import { SheetLink } from "../cards";
import { sheetFrom } from "../sheetUrl";
import { AnswerPill, Icon, SheetFailed, SheetSkeleton, Terms } from "../pieces";
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
    // Outside the history, in the future, or a night with no plays (8.7).
    if (!load.night || load.night.plays === 0) invalid();
    else setTitle(nightTitle(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once it loads
  }, [load.state]);
  useEffect(() => setBusy(load.state === "loading"), [load.state, setBusy]);

  if (load.state === "failed") return <SheetFailed retry={retry} />;
  if (load.state === "loading") return <SheetSkeleton />;
  if (!night || night.plays === 0) return null;

  // Previous and next night with listening, crossing months as needed.
  const step = async (dir: 1 | -1) => {
    if (stepping || load.state !== "ready") return;
    setStepping(true);
    try {
      let month = value.slice(0, 7);
      let list = load.month;
      for (let i = 0; i < 13; i++) {
        const candidates = list.filter((n) => n.plays > 0 && (dir > 0 ? n.date > value : n.date < value));
        const next = dir > 0 ? candidates[0] : candidates[candidates.length - 1];
        if (next) {
          // The sheet may have closed while a month loaded.
          if (sheetFrom(new URLSearchParams(window.location.search))?.value === value) L.open({ kind: "night", value: next.date });
          return;
        }
        month = shiftMonth(month, dir);
        if (dir > 0 && month > tonight.slice(0, 7)) return;
        const data = await getJson<Nights>(L.listenerUrl("nights", `&from=${month}&to=${month}`));
        list = data.nights ?? [];
      }
    } catch {
      /* the arrows just don't move */
    } finally {
      setStepping(false);
    }
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
      <Terms names={["A night"]} />
      <p className="mt-2 text-[17px] text-ink">
        {night.plays.toLocaleString("en-US")} play{night.plays === 1 ? "" : "s"}
        {sofar}
        {night.usualForWeekday !== null ? ` · a usual ${nightWeekday(night.date)} is ${night.usualForWeekday.toLocaleString("en-US")}` : ""}
      </p>
      {night.afterMidnight > 0 && (
        <p className="mt-1 text-ink-2">
          {night.afterMidnight.toLocaleString("en-US")} after midnight{sofar}
        </p>
      )}
      {mix && <p className="mt-1 text-ink-2">{mix}</p>}
      {night.firstPlays.length > 0 && (
        <ul className="mt-3 space-y-2">
          {night.firstPlays.map((fp) => (
            <li key={fp.songId}>
              {songs.has(fp.songId) ? (
                <SheetLink to={{ kind: "song", value: fp.songId }} className="block rounded-xl border border-[var(--hairline)] px-3 py-2.5 hover:border-[var(--gold)]">
                  <span className="block text-ink">
                    First heard {fp.track} by {fp.artist}
                  </span>
                  {fp.pairing && <span className="mt-1 block text-[14px] text-ink-2">{fp.pairing}</span>}
                </SheetLink>
              ) : (
                <div className="rounded-xl border border-[var(--line)] px-3 py-2.5">
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
      <p className="mt-1 text-[13px] text-ink-2">At 9 p.m. that night.</p>
      <div className="mt-3 flex justify-center">
        {sky === "failed" ? (
          <SheetFailed retry={retry} />
        ) : sky ? (
          <SkyWheel bodies={sky.bodies} size={260} />
        ) : (
          <div className="skeleton size-[260px] rounded-full" aria-hidden />
        )}
      </div>
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
                  <SheetLink to={{ kind: "q", value: q.id }} className="flex min-h-11 items-center justify-between gap-3 py-2.5">
                    <span className="text-[15px] text-ink">
                      Question {q.number}: {q.shortName}
                    </span>
                    {a && <AnswerPill word={a.word} />}
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
