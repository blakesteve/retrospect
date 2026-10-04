"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input, Sheet, Spinner } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import type { AnswersPayload, ComputingPayload, QuestionPayload } from "@/lib/answers/payload";
import { isValidUsername } from "@/lib/username";
import { apiError, toVisitorErrorCode, visitorError, visitorErrorCodeOf, type VisitorErrorCode } from "@/lib/visitorErrors";
import { sayInvalidLink } from "@/components/invalidLink";
import { AnswerPill, Chevron } from "@/components/listener/pieces";
import { closeSheets, dropSheet, finishClose, openSheet } from "@/components/listener/sheetUrl";

/* Compare (spec 8.8): two listeners on the same 12 questions, each side's
   words from its own stored answers, corrected across its own tested
   questions (6.6). Rows of the 12 with both words side by side and the swing
   under each. No winner and no score: two people's results, mostly chance,
   aren't a contest. Whatever happens to one side (still reading, Too early,
   private, missing, empty, failed) is said in that side's column, and the
   other side stands. */

type Side =
  | { state: "syncing"; progress: string }
  | { state: "checking"; done: number }
  | { state: "ready"; answers: AnswersPayload }
  | { state: "error"; code: VisitorErrorCode };

class SideError extends Error {
  constructor(readonly code: VisitorErrorCode) {
    super(code);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** One side: its history read (as today), then its stored answers, computed
    if it has none (6.6). Answers being refreshed ("updating") swap in without
    a notice, as on the listener's own page: look again every 8 seconds, up
    to 8 times. */
function useSide(name: string, skip: boolean): Side {
  const [side, setSide] = useState<Side>({ state: "syncing", progress: "starting" });
  useEffect(() => {
    if (skip) return;
    let live = true;
    const set = (s: Side) => live && setSide(s);
    (async () => {
      for (;;) {
        const res = await fetch(`/api/user/${encodeURIComponent(name)}/status`);
        if (!res.ok) throw new SideError((await apiError(res)).code);
        const s = await res.json();
        if (s.status === "error") throw new SideError(toVisitorErrorCode(s.code));
        if (s.status === "ready") break;
        set({
          state: "syncing",
          progress:
            s.totalPages > 0
              ? `${Math.min(s.pagesDone * 200, s.totalScrobbles).toLocaleString("en-US")} of ${s.totalScrobbles.toLocaleString("en-US")} scrobbles`
              : "starting",
        });
        await sleep(800);
        if (!live) return;
      }
      set({ state: "checking", done: 0 });
      const zone = browserZone();
      let fresh = 0;
      let shown = false;
      for (let i = 0; i < 90 && live; i++) {
        // Once answers are shown, a look again that fails leaves them standing.
        const res = await fetch(`/api/user/${encodeURIComponent(name)}/answers?tz=${encodeURIComponent(zone)}`).catch((err) => {
          if (shown) return null;
          throw err;
        });
        if (!res || (!res.ok && shown)) return;
        if (!res.ok) throw new SideError((await apiError(res)).code);
        const data = (await res.json()) as AnswersPayload | ComputingPayload;
        if (data.status !== "computing") {
          set({ state: "ready", answers: data as AnswersPayload });
          shown = true;
          if (data.status === "updating" && fresh < 8) {
            fresh++;
            await sleep(8000);
            continue;
          }
          return;
        }
        if (!shown) set({ state: "checking", done: data.done });
        await sleep(shown ? 8000 : 2000);
      }
      // Still computing after three minutes; an answer already shown stands.
      if (live && !shown) throw new SideError("network");
    })().catch((err) => set({ state: "error", code: err instanceof SideError ? err.code : visitorErrorCodeOf(err) }));
    return () => {
      live = false;
    };
  }, [name, skip]);
  return side;
}

/** The newest of a changing value, at most every `ms` (11: progress is
    announced at most every 3 seconds). */
function useEvery(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const t = setTimeout(
      () => {
        last.current = Date.now();
        setShown(value);
      },
      Math.max(0, last.current + ms - Date.now()),
    );
    return () => clearTimeout(t);
  }, [value, ms]);
  return shown;
}

/** "{a}: 12,000 of 40,000 scrobbles", "Checking {a}: 4 of 12" (8.8). */
function sideProgress(name: string, side: Side): string | null {
  if (side.state === "syncing") return `${name}: ${side.progress}`;
  if (side.state === "checking") return `Checking ${name}: ${side.done} of 12`;
  return null;
}

export function Compare({ a, b }: { a: string; b: string }) {
  const same = a.trim().toLowerCase() === b.trim().toLowerCase();
  const sideA = useSide(a, same);
  const sideB = useSide(b, same);
  const params = useSearchParams();
  const open = params.get("q");

  useEffect(() => {
    const onPop = () => finishClose();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A question that isn't one of the 12 opens nothing and says so (8.7).
  const invalid = Boolean(open) && !QUESTIONS.some((q) => q.id === open);
  useEffect(() => {
    if (!invalid) return;
    dropSheet();
    sayInvalidLink();
  }, [invalid]);

  const progress = [sideProgress(a, sideA), sideProgress(b, sideB)].filter(Boolean).join(" · ");
  const spoken = useEvery(progress, 3000);

  if (same) return <SameTwice a={a} b={b} />;

  const qA = (id: string) => (sideA.state === "ready" ? sideA.answers.questions.find((q) => q.id === id) : undefined);
  const qB = (id: string) => (sideB.state === "ready" ? sideB.answers.questions.find((q) => q.id === id) : undefined);
  const sheetQ = open ? QUESTIONS.find((q) => q.id === open) : undefined;

  return (
    <div>
      <header className="text-center">
        <h1 className="font-display text-[34px] leading-tight text-ink sm:text-[42px]">Same sky, different people.</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          {a} and {b}, on the same 12 questions. Each answer is checked against its own listener&rsquo;s history.
        </p>
      </header>

      {progress && (
        <div className="mt-6 flex items-center justify-center gap-3 text-[14px] text-ink-2" data-progress>
          <Spinner size="sm" variant="primary" />
          <span aria-hidden>{progress}</span>
        </div>
      )}
      {/* The same words for a screen reader, at most every 3 seconds (11). */}
      <p role="status" aria-live="polite" className="sr-only">
        {progress ? spoken : ""}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 border-b border-[var(--line)] pb-3" data-columns>
        <ColumnHead name={a} side={sideA} />
        <ColumnHead name={b} side={sideB} />
      </div>

      <ol className="divide-y divide-[var(--line)]" data-rows>
        {QUESTIONS.map((question) => {
          const left = qA(question.id);
          const right = qB(question.id);
          const differs = Boolean(left && right && left.word !== right.word);
          const label = `Question ${question.number}: ${question.shortName}`;
          return (
            <li key={question.id} className="py-3" data-row={question.id}>
              {differs ? (
                <button
                  type="button"
                  onClick={() => openSheet({ kind: "q", value: question.id })}
                  className="group flex min-h-11 items-center gap-1 text-left text-[15px] text-gold underline decoration-dotted underline-offset-4"
                >
                  {label}
                  <Chevron />
                </button>
              ) : (
                <p className="flex min-h-11 items-center text-[15px] text-ink">{label}</p>
              )}
              <div className="mt-1 grid grid-cols-2 gap-3">
                <Cell q={left} side={sideA} />
                <Cell q={right} side={sideB} />
              </div>
            </li>
          );
        })}
      </ol>

      <Sheet isOpen={Boolean(sheetQ)} onClose={closeSheets} title={sheetQ ? `Question ${sheetQ.number} of 12` : "A question"}>
        {sheetQ && (
          <div className="pb-4">
            <p className="font-display text-[22px] leading-snug text-ink">{sheetQ.question}</p>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:gap-6" data-sheet-columns>
              <SheetColumn name={a} q={qA(sheetQ.id)} side={sideA} />
              <SheetColumn name={b} q={qB(sheetQ.id)} side={sideB} />
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function ColumnHead({ name, side }: { name: string; side: Side }) {
  if (side.state !== "error") return <p className="truncate font-display text-[20px] text-ink">{name}</p>;
  // Today's visitor-error copy, in this side's column only (8.8).
  const message = visitorError(side.code, name);
  return (
    <div data-side-error>
      <p className="truncate font-display text-[20px] text-ink">{name}</p>
      <p className="mt-1 text-[14px] text-ink">{message.title}</p>
      <p className="mt-0.5 text-[13px] text-ink-2">{message.body}</p>
    </div>
  );
}

/** One side's answer: its word, and under it the swing, or why there's no word yet. */
function Cell({ q, side }: { q: QuestionPayload | undefined; side: Side }) {
  if (side.state === "error") return <div />;
  if (!q) return <div className="skeleton h-12 rounded-lg" aria-hidden />;
  const under = q.status === "tested" && !q.updating ? q.phrases.swing : q.phrases.tonightLine;
  return (
    <div data-cell data-word={q.word}>
      <AnswerPill word={q.word} />
      {under && <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{under}</p>}
    </div>
  );
}

/** One listener's answer in the sheet, or the skeleton while it's still on its way (8.7). */
function SheetColumn({ name, q, side }: { name: string; q: QuestionPayload | undefined; side: Side }) {
  return (
    <section aria-label={name} className="min-w-0">
      <h3 className="truncate font-display text-[19px] text-ink">{name}</h3>
      {!q && side.state !== "error" ? (
        <div className="mt-2 space-y-2" aria-hidden>
          <div className="skeleton h-8 w-24 rounded-full" />
          <div className="skeleton h-24" />
        </div>
      ) : q ? (
        <>
          <div className="mt-2">
            <AnswerPill word={q.word} />
          </div>
          <p className="mt-2 leading-relaxed text-ink">{q.phrases.wordLine}</p>
          {q.phrases.range && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{q.phrases.range}</p>}
        </>
      ) : (
        <p className="mt-2 text-ink-2">No answer to show.</p>
      )}
    </section>
  );
}

/** The same listener twice (8.8): say so, with the two fields. */
function SameTwice({ a, b }: { a: string; b: string }) {
  const router = useRouter();
  const [first, setFirst] = useState(a);
  const [second, setSecond] = useState(b);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const x = first.trim();
    const y = second.trim();
    if (!isValidUsername(x) || !isValidUsername(y)) return setError("That doesn't look like a Last.fm username.");
    if (x.toLowerCase() === y.toLowerCase()) return setError("That's the same listener twice.");
    router.push(`/vs/${encodeURIComponent(x)}/${encodeURIComponent(y)}`);
  };
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="font-display text-[34px] leading-tight text-ink">That&rsquo;s the same listener twice.</h1>
      <Card padding="none" className="sky-card mt-6 p-4 text-left">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            size="lg"
            variant="outline"
            label="First listener"
            value={first}
            onChange={(e) => (setFirst(e.target.value), setError(null))}
            autoComplete="off"
          />
          <Input
            size="lg"
            variant="outline"
            label="Second listener"
            value={second}
            onChange={(e) => (setSecond(e.target.value), setError(null))}
            aria-invalid={error ? true : undefined}
            errorMessage={error ?? undefined}
            autoComplete="off"
          />
          <Button size="lg" type="submit">
            Compare
          </Button>
        </form>
      </Card>
    </div>
  );
}
