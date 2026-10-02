"use client";

import { useEffect, useState } from "react";
import { QUESTIONS } from "@/lib/answers/questions";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { getJson, type Dignity } from "../api";
import type { PlanetSheet as PlanetSheetData } from "@/lib/sky/planet";
import { SheetLink } from "../cards";
import { AnswerPill, SheetFailed, SheetSkeleton, Terms } from "../pieces";
import { DIGNITY_COLOR, planetGlyph, signGlyph } from "../sky";

/* A planet (spec 8.7.4), from /api/sky/planet. */

// Type only: the module itself reads the sky data, which stays server-side (13).
type PlanetData = PlanetSheetData & { zone: string; zoneFellBack: boolean };

const NIGHT_DIGNITY: Record<string, Dignity> = { h: "home", x: "exalted", d: "detriment", f: "fall", n: "neutral" };

/** The strip's runs: segments for the planets, merged nights for the Moon. */
function stripRuns(path: NonNullable<PlanetData["path"]>): { key: string; share: number; dignity: Dignity }[] {
  if (path.kind === "segments") {
    const span = Math.max(1, path.end - path.start);
    return path.segments.map((s) => ({ key: String(s.start), share: (s.end - s.start) / span, dignity: s.dignity }));
  }
  const runs: { key: string; share: number; dignity: Dignity }[] = [];
  const n = path.nights.length;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && path.nights[j] === path.nights[i]) j++;
    runs.push({ key: String(i), share: (j - i) / n, dignity: NIGHT_DIGNITY[path.nights[i]] ?? "neutral" });
    i = j;
  }
  return runs;
}

/** 9.3: at home, exalted, in detriment, in her, his or its fall, a neutral sign. */
const dignityWord = (d: Dignity, his: string) =>
  ({ home: "At home", exalted: "Exalted", detriment: "In detriment", fall: `In ${his} fall`, neutral: "A neutral sign" })[d];
const H3 = "mt-8 text-[13px] font-semibold uppercase tracking-[0.12em] text-gold";

export default function PlanetSheet({ value, setTitle, setBusy, invalid, retry }: SheetBodyProps) {
  const L = useListener();
  const [data, setData] = useState<PlanetData | null | "failed">(null);
  const name = value.charAt(0).toUpperCase() + value.slice(1);

  // The history's span: the sync's oldest play, else the first scrobble the
  // songs route names (an older sync state has no `oldestUts`).
  const songs = L.songs.state === "ready" ? L.songs.data : null;
  const firstScrobble = songs?.row?.find((s) => s.firstScrobble)?.firstPlayUts ?? null;
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const to = L.sync?.newestUts ?? now;
  const from = L.sync?.oldestUts ?? firstScrobble ?? (L.songs.state === "loading" ? null : to);

  useEffect(() => {
    setTitle(value === "moon" || value === "sun" ? `The ${name} tonight` : `${name} tonight`);
    if (from === null) return;
    const ac = new AbortController();
    getJson<PlanetData>(`/api/sky/planet?body=${value}&from=${from}&to=${to}&tz=${encodeURIComponent(L.zone)}`, { signal: ac.signal })
      .then(setData)
      .catch((err) => {
        if (ac.signal.aborted) return;
        if ((err as { code?: string }).code === "invalid") invalid();
        else setData("failed");
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per planet and span
  }, [value, L.zone, from, to]);
  useEffect(() => setBusy(data === null), [data, setBusy]);

  if (data === "failed") return <SheetFailed retry={retry} />;
  if (!data) return <SheetSkeleton />;

  const t = data.tonight;
  const possessive = value === "venus" || value === "moon" ? "her" : value === "mercury" ? "its" : "his";
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const about = QUESTIONS.filter((q) => data.questions.includes(q.number));
  const rx = value === "venus" ? "venusrx" : value === "mars" ? "marsrx" : null;
  const rxAnswer = rx ? answers?.questions.find((q) => q.id === rx) : undefined;

  return (
    <div className="pb-4">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="font-glyph flex size-16 items-center justify-center rounded-full text-4xl"
          style={{ boxShadow: `0 0 0 2px ${DIGNITY_COLOR[t.dignity] ?? "var(--line-2)"}`, color: "var(--text-primary)" }}
        >
          {planetGlyph(name)}
        </span>
        <div>
          <p className="font-display text-[20px] leading-snug text-ink">{t.plain}</p>
          <p className="mt-1 text-[13px] text-ink-2">
            {t.term} · {t.degreeText}
          </p>
        </div>
      </div>

      <h3 className={H3}>Where {name === "Venus" || name === "Moon" ? "she's" : name === "Mercury" ? "it's" : "he's"} strong and weak</h3>
      <Terms names={["At home", "Exalted", "Detriment", "Fall", "Neutral sign"]} />
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {data.dignityMap.map((d) => (
          <li
            key={d.sign}
            className="rounded-xl border px-2 py-2 text-center"
            style={{ borderColor: DIGNITY_COLOR[d.dignity] ?? "var(--line)", background: DIGNITY_COLOR[d.dignity] ? `color-mix(in srgb, ${DIGNITY_COLOR[d.dignity]} 14%, transparent)` : undefined }}
          >
            <span aria-hidden className="font-glyph block text-lg text-ink">
              {signGlyph(d.sign)}
            </span>
            <span className="block text-[12px] text-ink">{d.sign}</span>
            <span className="block text-[11px] text-ink-2">{dignityWord(d.dignity, possessive)}</span>
          </li>
        ))}
      </ul>

      {data.path && (
        <>
          <h3 className={H3}>Through your history</h3>
          <div aria-hidden className="mt-3 flex h-5 overflow-hidden rounded-md bg-surface-2">
            {stripRuns(data.path).map((r) => (
              <span key={r.key} style={{ width: `${r.share * 100}%`, background: DIGNITY_COLOR[r.dignity] ?? "var(--surface-2)" }} />
            ))}
          </div>
          <p className="mt-1 flex justify-between text-[12px] text-ink-2">
            <span>{data.path.startLabel}</span>
            <span>{data.path.endLabel}</span>
          </p>
          <p className="sr-only">
            The strip colors each stretch by {name}&rsquo;s dignity: gold at home, sea green exalted, plum in detriment, rust in fall.
          </p>
        </>
      )}

      {about.length > 0 && (
        <>
          <h3 className={H3}>In your 12 questions</h3>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {about.map((q) => {
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

      {rxAnswer && rxAnswer.status === "too-few-events" && (
        <>
          <h3 className={H3}>{name === "Venus" ? "Her" : "His"} retrograde, an early read</h3>
          {rxAnswer.phrases.tooEarly && <p className="mt-2 leading-relaxed text-ink">{rxAnswer.phrases.tooEarly}</p>}
          <ul className="mt-2 space-y-1.5 text-[14px] text-ink-2">
            {rxAnswer.phrases.earlyReadRows.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {rxAnswer.phrases.typicalSwing && <p className="mt-2 text-[14px] text-ink-2">{rxAnswer.phrases.typicalSwing}</p>}
        </>
      )}

      {(data.next.station || data.next.signChange) && (
        <>
          <h3 className={H3}>Next</h3>
          <Terms names={["Retrograde", "Station"]} />
          <ul className="mt-2 space-y-1.5 text-[15px] text-ink">
            {data.next.station && (
              <li>
                {data.next.station.text}
                {data.next.station.detail && <span className="block text-[13px] text-ink-2">{data.next.station.detail}</span>}
              </li>
            )}
            {data.next.signChange && (
              <li>
                {data.next.signChange.text}
                {data.next.signChange.detail && <span className="block text-[13px] text-ink-2">{data.next.signChange.detail}</span>}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
