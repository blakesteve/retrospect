"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { forYouRows, type ForYouRow } from "@/lib/client/forYou";
import { useListener } from "./Shell";
import type { Planet, QuestionPayload } from "./api";
import { SheetLink } from "./cards";
import { AnswerPill, Chevron, Icon, RowFailed } from "./pieces";
import { DIGNITY_COLOR, planetGlyph } from "./sky";
import type { SheetRef } from "./sheetUrl";

/* "Tonight, for you" (spec 8.4 item 3): Tonight's list, the landing's
   Tonight sample and the Sky view's (8.6 item 6) share it. Its own module,
   so a view that shows it doesn't carry the rest of Tonight. */

/** The answers once they're computed, else null. */
export function useAnswers() {
  const L = useListener();
  const a = L.answers.state === "ready" ? L.answers.data : null;
  return a && a.status !== "computing" ? a : null;
}

/** The "for you" rows, from the sky now and the answers (8.4 item 3). */
export function useForYouRows(): ForYouRow[] {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const answers = useAnswers();
  return useMemo(
    () =>
      sky
        ? forYouRows({
            held: sky.questionsHeld,
            skyLines: sky.skyLines ?? {},
            noneOverhead: sky.noneOverhead ?? null,
            skyFacts: sky.skyFacts ?? [],
            headsUp: answers ? (answers.headsUp ?? null) : undefined,
          })
        : [],
    [sky, answers],
  );
}

/** A row's glyph: the planet in its dignity color now, or the storm or flare. */
function RowGlyph({ row, bodies }: { row: ForYouRow; bodies: Planet[] }) {
  const id = row.kind === "held" || row.kind === "headsUp" ? row.id : null;
  if (id === "storms") return <Icon name="storm" className="size-5 text-[var(--aurora)]" />;
  if (id === "flares") return <Icon name="flare" className="size-5 text-[var(--flare)]" />;
  if (row.bodies.length === 0) return <Icon name="clock" className="size-5 text-ink-2" />;
  return (
    <span aria-hidden className="font-glyph flex text-[20px] leading-none">
      {row.bodies.map((b) => {
        const dignity = bodies.find((p) => p.body === b)?.dignity ?? "neutral";
        return (
          <span key={b} style={{ color: DIGNITY_COLOR[dignity] ?? "var(--text-secondary)" }}>
            {planetGlyph(b)}
          </span>
        );
      })}
    </span>
  );
}

/** What a row tells the list as the pointer or focus comes and goes. */
type RowSignal = (key: string, how: "hover" | "focus", on: boolean) => void;

function ForYouItem({
  row,
  rowKey,
  bodies,
  byId,
  checking,
  signal,
}: {
  row: ForYouRow;
  rowKey: string;
  bodies: Planet[];
  byId: Map<string, QuestionPayload>;
  checking: boolean;
  signal?: RowSignal;
}) {
  let to: SheetRef | null = null;
  let sky = "";
  let second: ReactNode = null;
  // Its accessible name ends with the question, never a bare number (9.2).
  let question: string | null = null;
  const named = (id: string) => {
    const meta = QUESTIONS.find((q) => q.id === id)!;
    return `Question ${meta.number}: ${meta.shortName}`;
  };
  if (row.kind === "held" || row.kind === "headsUp") {
    const q = byId.get(row.id);
    to = { kind: "q", value: row.id };
    sky = row.skyLine || QUESTIONS.find((x) => x.id === row.id)!.shortName;
    question = named(row.id);
    // Answers computing: "Checking…", silent (8.4, 11).
    const line = row.kind === "headsUp" ? row.line : q?.phrases.tonightLine;
    second =
      q && line ? (
        <>
          <AnswerPill word={q.word} className="mr-2 !px-2 !py-0 !text-[12px]" />
          <span className="sr-only">: </span>
          {line}
        </>
      ) : checking ? (
        "Checking…"
      ) : null;
  } else if (row.kind === "none") {
    sky = row.line;
    if (row.next) {
      to = { kind: "q", value: row.next.id };
      second = row.next.line;
      question = named(row.next.id);
    }
  } else {
    to = { kind: "planet", value: row.fact.planet };
    sky = row.fact.line;
  }

  const handlers = signal
    ? {
        onPointerEnter: () => signal(rowKey, "hover", true),
        onPointerLeave: () => signal(rowKey, "hover", false),
        onFocus: () => signal(rowKey, "focus", true),
        onBlur: () => signal(rowKey, "focus", false),
      }
    : {};
  const inner = (
    <>
      <span className="flex w-7 shrink-0 justify-center pt-0.5">
        <RowGlyph row={row} bodies={bodies} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug text-ink">{sky}</span>
        {/* Spoken as sentences: "Venus is in Scorpio, in her detriment. No: While…. Question 10: Venus in detriment" */}
        {second && <span className="sr-only">. </span>}
        {second && <span className="mt-1 block text-[14px] leading-relaxed text-ink-2">{second}</span>}
        {question && <span className="sr-only"> {question}</span>}
      </span>
      {to && <Chevron className="self-center" />}
    </>
  );
  return (
    <li>
      {to ? (
        <SheetLink to={to} className="group flex min-h-11 items-start gap-3 rounded-[14px] px-3 py-3 hover:bg-[rgba(242,239,230,.04)]" {...handlers}>
          {inner}
        </SheetLink>
      ) : (
        <div className="flex items-start gap-3 px-3 py-3">{inner}</div>
      )}
    </li>
  );
}

/** "Tonight, for you": one list, each row the sky and what your listening
    did under it (8.4 item 3). The landing's Tonight sample shows it too. */
export function ForYou({ rows, onHighlight }: { rows?: ForYouRow[]; onHighlight?: (b: readonly string[] | null) => void }) {
  const L = useListener();
  const own = useForYouRows();
  const list = rows ?? own;
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const answers = useAnswers();
  const byId = useMemo(() => new Map<string, QuestionPayload>(answers?.questions.map((q) => [q.id, q]) ?? []), [answers]);
  const keyOf = (r: ForYouRow) => (r.kind === "fact" ? `fact-${r.fact.body}` : r.kind === "none" ? "none" : `${r.kind}-${r.id}`);
  // A row lights its planet while it's hovered or focused (8.11 item 2): the
  // hovered row first, else the focused one, so leaving one never clears the other.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const signal: RowSignal = (key, how, on) => {
    const set = how === "hover" ? setHovered : setFocused;
    set((cur) => (on ? key : cur === key ? null : cur));
  };
  const lit = hovered ?? focused;
  const litBodies = lit ? (list.find((r) => keyOf(r) === lit)?.bodies ?? null) : null;
  const litKey = litBodies ? litBodies.join(",") : "";
  useEffect(() => {
    onHighlight?.(litBodies);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the bodies lit, not the array's identity
  }, [litKey, onHighlight]);

  return (
    <section aria-labelledby="foryou-h" className="mt-6">
      <h2 id="foryou-h" className="font-display text-[25px] leading-tight text-ink">
        Tonight, for you
      </h2>
      {L.skyNow.state === "failed" ? (
        <div className="mt-3">
          <RowFailed name="Tonight, for you" />
        </div>
      ) : !sky ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
        </div>
      ) : (
        <Card padding="none" className="sky-card mt-3 p-1">
          <ul className="divide-y divide-[var(--line)]">
            {list.map((r) => (
              <ForYouItem
                key={keyOf(r)}
                rowKey={keyOf(r)}
                row={r}
                bodies={sky.sky.bodies}
                byId={byId}
                checking={L.answers.state !== "failed"}
                signal={onHighlight ? signal : undefined}
              />
            ))}
          </ul>
          {L.answers.state === "failed" && <p className="px-3 py-3 text-[14px] text-ink-2">The 12 questions didn&rsquo;t load. Refresh to try again.</p>}
        </Card>
      )}
    </section>
  );
}
