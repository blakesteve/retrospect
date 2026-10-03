"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Disclosure, Switch } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { Histogram } from "@/components/Histogram";
import { setShowPValues, useShowPValues } from "@/components/usePValues";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { songIndex } from "../format";
import { SongCard } from "../cards";
import { FlukeMeter, Icon, Jar, SheetFailed, SheetSkeleton, WORD_COLOR } from "../pieces";
import { Rail } from "../rail";

/* A question (spec 8.7.3). Every sentence is the answers payload's. */

/** Pairings show at most 8 in their row; "See all" opens the rest (8.7.3). */
const PAIRINGS_IN_ROW = 8;

const HOW_WE_KNOW =
  "We slide your whole sky calendar along your history by a random amount, 2,000 times, keeping the spacing between stretches, and see how often a swing this big turns up anyway.";

export default function QuestionSheet({ value, setTitle, setBusy, invalid, retry }: SheetBodyProps) {
  const L = useListener();
  const question = QUESTIONS.find((q) => q.id === value);
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const q = answers?.questions.find((x) => x.id === value) ?? null;
  const showMath = useShowPValues();
  const [allPairings, setAllPairings] = useState(false);

  useEffect(() => {
    if (!question) invalid();
    else setTitle(`Question ${question.number} of 12`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);
  useEffect(() => setBusy(!q), [q, setBusy]);

  if (!question) return null;
  const head = (
    <>
      <p className="font-display text-[25px] leading-snug text-ink">{question.question}</p>
      <p className="mt-2 text-[15px] italic leading-relaxed text-ink-2">{question.story}</p>
    </>
  );
  if (!q) {
    return (
      <div>
        {head}
        {L.answers.state === "failed" ? <SheetFailed retry={retry} /> : <SheetSkeleton />}
      </div>
    );
  }

  const tested = q.status === "tested" && !q.updating;
  const early = !q.notChecked && !q.updating && q.status !== "tested";
  const songs = songIndex(L.songs.state === "ready" ? L.songs.data : undefined);
  // Each card wears this question's condition at its first play (8.7.3).
  const pairings = q.pairings.flatMap((p) => {
    const song = songs.get(p.songId);
    return song ? [{ song, chip: p.conditionText }] : [];
  });
  const color = WORD_COLOR[q.word];

  return (
    <div className="pb-4">
      {head}

      {/* Too early, Not checked and Checking replace items 2 to 7 (8.7.3, 6.6a). */}
      {tested && (
        <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
          <p className="font-display text-[44px] leading-none" style={{ color }}>
            {q.word}
          </p>
          <p className="mt-3 text-[16px] leading-relaxed text-ink">{q.phrases.wordLine}</p>
          {q.phrases.likelihood && (
            <div className="mt-4">
              <FlukeMeter likelihood={q.phrases.likelihood} word={q.word} />
            </div>
          )}
        </div>
      )}
      {!tested && !early && <p className="mt-6 text-[16px] leading-relaxed text-ink">{q.phrases.wordLine}</p>}

      {tested && (
        <>
          {q.phrases.range && <p className="mt-4 text-[15px] leading-relaxed text-ink">{q.phrases.range}</p>}

          <h3 className="mt-7 text-[13px] font-semibold uppercase tracking-[0.12em] text-gold">What happened</h3>
          {q.phrases.whatHappened && <p className="mt-2 leading-relaxed text-ink">{q.phrases.whatHappened}</p>}
          {q.eventsNote && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{q.eventsNote}</p>}
          {q.phrases.warmup && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{q.phrases.warmup}</p>}

          <div className="mt-6">
            <Disclosure title="How we know" variant="ghost">
              <p className="leading-relaxed text-ink-2">{HOW_WE_KNOW}</p>
              {q.phrases.frequency && <p className="mt-2 leading-relaxed text-ink">{q.phrases.frequency}</p>}
            </Disclosure>
          </div>

          <div className="mt-4">
            <Switch size="md" label="Show the math" checked={showMath} onChange={(on) => setShowPValues(on)} />
            {showMath && (
              <div className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-2">
                {q.phrases.pValueNote && <p>{q.phrases.pValueNote}</p>}
                {q.phrases.correctionNote && <p>{q.phrases.correctionNote}</p>}
                <Histogram samples={q.nullSamples} observed={q.pct === null ? null : 1 + q.pct / 100} iterations={q.iterations} />
              </div>
            )}
          </div>
        </>
      )}

      {early && (
        <div className="mt-5">
          <div className="flex items-center gap-4">
            <Jar fill={q.status === "too-few-events" ? q.events / 6 : q.inPlays / 500} color="var(--word-early)" width={46} fills />
            <p className="leading-relaxed text-ink">{q.phrases.tooEarly}</p>
          </div>
          {q.phrases.earlyReadRows.length > 0 && (
            <ul className="mt-4 space-y-2 text-[14px] text-ink-2">
              {q.phrases.earlyReadRows.map((row) => (
                <li key={row} className="rounded-xl border border-[var(--line)] px-3 py-2">
                  {row}
                </li>
              ))}
            </ul>
          )}
          {q.phrases.typicalSwing && <p className="mt-3 text-[14px] text-ink-2">{q.phrases.typicalSwing}</p>}
          {q.eventsNote && <p className="mt-2 text-[14px] text-ink-2">{q.eventsNote}</p>}
        </div>
      )}

      {pairings.length > 0 && (
        <section className="mt-8" aria-labelledby="pairings-h">
          {allPairings ? (
            <>
              <PairingsHead action={<SeeAll open onToggle={() => setAllPairings(false)} />} />
              <ul className="mt-3 grid grid-cols-2 gap-3">
                {pairings.map((p) => (
                  <li key={p.song.songId}>
                    <SongCard song={p.song} chip={p.chip} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Rail
              label="Pairings under this sky"
              noun="pairings"
              gutter={20}
              head={(arrows) => (
                <PairingsHead
                  action={
                    <>
                      {pairings.length > PAIRINGS_IN_ROW && <SeeAll open={false} onToggle={() => setAllPairings(true)} />}
                      {arrows}
                    </>
                  }
                />
              )}
            >
              {pairings.slice(0, PAIRINGS_IN_ROW).map((p) => (
                <SongCard key={p.song.songId} song={p.song} chip={p.chip} />
              ))}
            </Rail>
          )}
        </section>
      )}

      {!L.sampleLabel && (
        <div className="mt-8">
          <Button size="lg" variant="outline" startIcon={<Icon name="share" />} onClick={() => L.open({ kind: "share", value: `q:${question.id}` })}>
            Share this answer
          </Button>
        </div>
      )}
    </div>
  );
}

function PairingsHead({ action }: { action: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 id="pairings-h" className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gold">
          Pairings under this sky
        </h3>
        <p className="mt-1 text-[13px] text-ink-2">Facts, not proof: songs you first played under this sky.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  );
}

const SeeAll = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
  <Button size="lg" variant="outline" onClick={onToggle} aria-expanded={open}>
    {open ? "Show fewer" : "See all"}
  </Button>
);
