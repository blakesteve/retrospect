"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Disclosure, Eyebrow, Input } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { forYouRows, namesMoonSign, type ForYouRow } from "@/lib/client/forYou";
import { isValidUsername } from "@/lib/username";
import { ListeningProfile } from "@/components/ListeningProfile";
import { HAS_SWITCHER, useListener, VIEW_HEADING } from "./Shell";
import { getJson, type ComingUpItem, type Genres, type Planet, type QuestionPayload, type SkyNow } from "./api";
import { nightDateText } from "./format";
import { SheetLink, SongCard, WildCard } from "./cards";
import { AnswerPill, Chevron, Icon, Row, RowFailed } from "./pieces";
import { RailRow, WILD_PER_VIEW } from "./rail";
import { DIGNITY_COLOR, MoonDrawing, SkyWheel, WheelKey, planetGlyph, type SkyWheelProps } from "./sky";
import { sheetFrom, type SheetRef } from "./sheetUrl";
import { useWheelTravel, type WheelMoment, type WheelTravel } from "./wheelTravel";
import { REDUCED_MOTION, prefersReducedMotion, useMedia, useOnScreen, usePauseWhenHidden } from "./media";
import { Guide } from "./Guide";

/* Tonight (spec 8.4). Lays out what the routes say; computes nothing. Two
   halves: tonight's sky and what it holds for you, then "{Length} under the
   sky", the history. */

/** The wheel arrives once a visit, and the heads-up planet pulses once
    (8.11 items 2 and 4): not again on a return from a sheet or a view. */
let wheelArrived = false;
let headsUpPulsed = false;
/** The arrival's length: 60ms apart for seven planets, 800ms each. */
const ARRIVE_MS = 1200;

/** "Oct 3" for a date this year, "Jan 4, 2027" for one in the next. */
const shortDate = (date: string) => (date.endsWith(`, ${new Date().getFullYear()}`) ? date.replace(/, \d{4}$/, "") : date);

/** Resolves once a smooth scroll has settled, or after 700ms. */
const scrollSettled = () =>
  new Promise<void>((resolve) => {
    const end = () => {
      window.removeEventListener("scrollend", end);
      resolve();
    };
    window.addEventListener("scrollend", end);
    setTimeout(end, 700);
  });

export function Tonight() {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const rows = useForYouRows();
  const nowSky = useMemo(() => (sky ? { bodies: sky.sky.bodies, uts: Math.floor(Date.parse(sky.sky.at) / 1000) } : null), [sky]);
  const wheel = useWheelTravel(nowSky);
  const [hover, setHover] = useState<readonly string[] | null>(null);
  const [live, setLive] = useState("");
  const forYouEnd = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const focusBack = useRef(false);
  const [headsUpOff, setHeadsUpOff] = useState(false);
  usePauseWhenHidden();

  // Focus moves to "Back to now" once the wheel sets off (8.11 item 1, 11).
  const moment = wheel?.moment ?? null;
  useEffect(() => {
    if (moment && focusBack.current) {
      focusBack.current = false;
      backRef.current?.focus({ preventScroll: true });
    }
  }, [moment]);

  const show = async (c: ComingUpItem, button: HTMLElement) => {
    if (!wheel) return;
    returnTo.current = button;
    setHeadsUpOff(true);
    const el = document.getElementById("tonight-wheel");
    let ready: Promise<void> | undefined;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        const instant = prefersReducedMotion();
        el.scrollIntoView({ block: "center", behavior: instant ? "auto" : "smooth" });
        if (!instant) ready = scrollSettled();
      }
    }
    const when = `${shortDate(c.date)}, ${c.at}`;
    const m: WheelMoment = { uts: c.time, label: `${when}: ${c.text}`, when, body: c.body ?? null };
    focusBack.current = true;
    try {
      // Only the last press speaks: a trip a newer press took over says nothing.
      if (await wheel.goTo(m, ready)) setLive(`The wheel shows ${when}.`);
    } catch {
      focusBack.current = false;
      setLive("The wheel couldn't go there. Try again.");
    }
  };

  const back = async () => {
    if (!wheel || !(await wheel.back())) return;
    setLive("The wheel shows the sky right now.");
    returnTo.current?.focus();
  };

  return (
    <div>
      <SkyRightNow sky={sky} wheel={wheel} rows={rows} hover={hover} live={live} backRef={backRef} onBack={back} headsUpOff={headsUpOff} />
      <ForYou rows={rows} onHighlight={setHover} />
      {/* "Surprise me" waits until the list has scrolled above it (8.4 item 7). */}
      <div ref={forYouEnd} aria-hidden className="h-px" />
      <RestOfTonight sky={sky} rows={rows} />
      <ComingUpRow onShow={show} />
      <History />
      <CompareCard />
      <Surprise after={forYouEnd} />

      {/* The guide finds its anchors by id, in the page's order (8.10). */}
      {L.guideReady && <Guide anchors={["tonight-wheel", "questions-grid", "songs-row"]} />}
    </div>
  );
}

/* ---- The sky right now (8.4 item 2) --------------------------------------- */

function SkyRightNow({
  sky,
  wheel,
  rows,
  hover,
  live,
  backRef,
  onBack,
  headsUpOff,
}: {
  sky: SkyNow | null;
  wheel: WheelTravel | null;
  rows: ForYouRow[];
  hover: readonly string[] | null;
  live: string;
  backRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  headsUpOff: boolean;
}) {
  const L = useListener();
  const wheelRef = useRef<HTMLDivElement>(null);
  const reduced = useMedia(REDUCED_MOTION);
  // The arrival plays on a visit's first paint the visitor can see: not
  // under the reveal, not under a sheet that opened the page, not again on a
  // return from a sheet or a view (8.11 item 4).
  const [eligible] = useState(() => !wheelArrived && typeof window !== "undefined" && sheetFrom(new URLSearchParams(window.location.search)) === null);
  const [arrived, setArrived] = useState(false);
  const arrive = eligible && !arrived && !reduced && Boolean(sky) && !L.revealOpen;
  const arrivedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!arrive) return;
    wheelArrived = true;
    arrivedAt.current = performance.now();
  }, [arrive]);

  // The heads-up planet pulses three times when the wheel is first on
  // screen and visible, after the arrival, then holds still (8.11 item 2).
  const onScreen = useOnScreen(wheelRef, Boolean(sky));
  const headsUp = rows.find((r) => r.kind === "headsUp");
  const headsUpId = headsUp?.kind === "headsUp" ? headsUp.id : null;
  const [huPulse, setHuPulse] = useState<{ bodies: readonly string[]; delayMs: number } | null>(null);
  useEffect(() => {
    if (!onScreen || !headsUp || headsUpPulsed || reduced || L.revealOpen) return;
    headsUpPulsed = true;
    const since = arrivedAt.current === null ? ARRIVE_MS : performance.now() - arrivedAt.current;
    setHuPulse({ bodies: headsUp.bodies, delayMs: Math.max(0, Math.round(ARRIVE_MS - since)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, by the heads-up's question
  }, [onScreen, headsUpId, reduced, L.revealOpen]);

  const pulse: SkyWheelProps["pulse"] = wheel?.arrived?.moment.body
    ? { bodies: [wheel.arrived.moment.body], times: 1, key: `m${wheel.arrived.n}` }
    : huPulse && !headsUpOff && !wheel?.moment
      ? { bodies: huPulse.bodies, times: 3, key: "heads-up", delayMs: huPulse.delayMs, onEnd: () => setHuPulse(null) }
      : null;

  return (
    <section aria-labelledby={VIEW_HEADING} className="mt-6">
      {/* The view's name, once: while there's no switcher to say it (8.4). */}
      {!HAS_SWITCHER && (
        <Eyebrow size="sm" tone="primary">
          Tonight
        </Eyebrow>
      )}
      {sky?.heading ? (
        <h1 id={VIEW_HEADING} tabIndex={-1} className="mt-1 font-display text-[34px] leading-tight text-ink outline-none [text-wrap:balance]">
          {sky.heading}
        </h1>
      ) : (
        <h1 id={VIEW_HEADING} tabIndex={-1} className="mt-1 font-display text-[34px] leading-tight text-ink outline-none">
          {L.skyNow.state === "loading" && <span className="skeleton inline-block h-9 w-56 align-middle" aria-hidden />}
          <span className="sr-only">Tonight</span>
        </h1>
      )}
      {/* The time line, or the moment the wheel went to with the way back.
          Its height is kept, so the wheel never jumps (8.11). */}
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
        {wheel?.moment ? (
          <>
            <p className="text-[13px] text-ink">{wheel.moment.label}</p>
            <Button ref={backRef} size="lg" variant="outline" onClick={onBack}>
              Back to now
            </Button>
          </>
        ) : (
          sky?.timeLine && <p className="text-[13px] text-ink-2">{sky.timeLine}</p>
        )}
      </div>

      <div id="tonight-wheel" ref={wheelRef} className="mt-1 flex flex-col items-center">
        {sky && wheel ? (
          <>
            <SkyWheel
              bodies={wheel.bodies}
              size={280}
              className="size-[280px] min-[400px]:size-[300px]"
              onPlanet={(body) => L.open({ kind: "planet", value: body.toLowerCase() })}
              highlight={hover}
              pulse={pulse}
              arrive={arrive}
              onArrived={() => setArrived(true)}
              moving={wheel.moving}
              glyphs={wheel.glyphs}
            />
            <WheelKey bodies={wheel.bodies} className="mt-2" />
          </>
        ) : L.skyNow.state === "failed" ? (
          <RowFailed name="Tonight's sky" />
        ) : (
          <div className="skeleton size-[280px] rounded-full min-[400px]:size-[300px]" aria-hidden />
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </section>
  );
}

/* ---- Tonight, for you (8.4 item 3) ---------------------------------------- */

function useAnswers() {
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

/* ---- The rest of tonight's sky (8.4 item 4) ------------------------------- */

function RestOfTonight({ sky, rows }: { sky: SkyNow | null; rows: ForYouRow[] }) {
  if (!sky) return null;
  // A row above that names her sign leaves it off here (8.4 item 4).
  const moonLine = sky.moon ? (namesMoonSign(rows) ? (sky.moon.lineNoSign ?? sky.moon.line) : sky.moon.line) : null;
  return (
    <div className="mt-4 space-y-4">
      {moonLine && (
        <SheetLink
          to={{ kind: "planet", value: "moon" }}
          className="group sky-card flex min-h-11 items-center gap-3 px-4 py-3 transition-transform hover:-translate-y-0.5 motion-reduce:transition-none"
        >
          <MoonDrawing phaseAngle={sky.sky.moon.phaseAngle} size={44} />
          <span className="min-w-0 flex-1 text-[14.5px] leading-snug text-ink">
            <span className="sr-only">The Moon: </span>
            {moonLine}
          </span>
          <Chevron />
        </SheetLink>
      )}

      {sky.epic && (
        <figure className="sky-card flex items-center gap-4 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- NASA's own CDN, credited */}
          <img src={sky.epic.url} alt="" loading="lazy" className="size-20 shrink-0 rounded-full bg-[var(--deep)] object-cover" />
          <figcaption className="min-w-0 text-[14px] leading-snug text-ink">
            {sky.epic.line}
            <span className="mt-1 block text-[12px] text-ink-2">{sky.epic.credit}</span>
          </figcaption>
        </figure>
      )}

      {sky.planets && (
        <Disclosure title="All seven, and a note for practitioners" variant="ghost">
          <ul className="divide-y divide-[var(--line)]">
            {sky.planets.map((p) => (
              <li key={p.body} className="flex items-center gap-3 py-2">
                <span aria-hidden className="font-glyph w-6 text-center text-xl" style={{ color: DIGNITY_COLOR[p.dignity] ?? "var(--text-secondary)" }}>
                  {planetGlyph(p.body)}
                </span>
                <span className="text-[14px] text-ink">
                  {p.line ?? `${p.body} in ${p.sign}`}
                  <span className="block text-[12px] text-ink-2">
                    {p.degreeText ?? `${p.degree}°${String(p.minute).padStart(2, "0")}′`} {p.sign}
                    {p.retrograde ? " · retrograde" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {sky.receptions?.map((r) => (
            <p key={r} className="mt-2 text-[13.5px] text-ink-2">
              {r}
            </p>
          ))}
        </Disclosure>
      )}
    </div>
  );
}

function ComingUpRow({ onShow }: { onShow: (c: ComingUpItem, button: HTMLElement) => void }) {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const answers = useAnswers();
  if (L.skyNow.state === "failed") {
    return (
      <Row id="coming" title="Coming up in your sky">
        <RowFailed name="Coming up in your sky" />
      </Row>
    );
  }
  // Nothing in 45 days: the row is left out (8.4).
  if (!sky || sky.comingUp.length === 0) return null;
  return (
    <RailRow
      id="coming"
      title="Coming up in your sky"
      rail={{
        label: "Coming up",
        noun: "events",
        children: sky.comingUp.map((c) => {
          const q = c.questions.map((id) => answers?.questions.find((x) => x.id === id)).find(Boolean);
          const meta = q ? QUESTIONS.find((x) => x.id === q.id) : undefined;
          const date = shortDate(c.date);
          return (
            // A card, not a link: the button and the question link are its own (11).
            <Card key={`${c.time}-${c.text}`} padding="none" className="sky-card flex h-full flex-col p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">{date}</p>
              <p className="mt-2 font-display text-[18px] leading-snug text-ink">{c.text}</p>
              <p className="mt-1 text-[12px] text-ink-2">{c.at}</p>
              <Button size="lg" variant="outline" className="mt-3 self-start !px-4" aria-label={`Show ${date}, ${c.text}, on the wheel`} onClick={(e) => onShow(c, e.currentTarget)}>
                Show on the wheel
              </Button>
              {q && meta && (
                <SheetLink to={{ kind: "q", value: q.id }} className="group mt-auto flex min-h-11 items-center gap-2 pt-3">
                  <span className="text-[13px] text-ink underline underline-offset-4">Does it move you?</span>
                  <AnswerPill word={q.word} className="!px-2 !py-0 !text-[12px]" />
                  <span className="sr-only">
                    . Question {meta.number}: {meta.shortName}
                  </span>
                  <Chevron className="ml-auto" />
                </SheetLink>
              )}
            </Card>
          );
        }),
      }}
    />
  );
}

/* ---- {Length} under the sky (8.4 item 5) ---------------------------------- */

function History() {
  const L = useListener();
  const h = L.highlights.state === "ready" ? L.highlights.data : null;
  return (
    <section aria-labelledby="history-h" className="mt-14 border-t border-[var(--line)] pt-8">
      <h2 id="history-h" className="font-display text-[30px] leading-tight text-ink">
        {h?.length ? (
          `${h.length} under the sky`
        ) : L.highlights.state === "loading" ? (
          <>
            <span className="skeleton inline-block h-8 w-64 align-middle" aria-hidden />
            <span className="sr-only">Your history under the sky</span>
          </>
        ) : (
          "Your history under the sky"
        )}
      </h2>
      <QuestionsGrid level={3} />
      <SongsRow />
      <WildRow />
      <GenresRow />
      <ListeningProfile username={L.username} zone={L.zone} level={3} />
    </section>
  );
}

export function QuestionsGrid({ level = 2 }: { level?: 2 | 3 }) {
  const L = useListener();
  const a = L.answers.state === "ready" ? L.answers.data : null;
  const answers = a && a.status !== "computing" ? a : null;
  return (
    <section id="questions-grid">
      <Row id="questions" title="Does the sky move you?" level={level}>
        {L.answers.state === "failed" ? (
          <RowFailed name="The 12 questions" />
        ) : !answers ? (
          // The one announced progress line on Tonight (8.4, 11).
          <p className="text-ink-2" role="status">
            Checking 12 questions against your sky&hellip; {a?.done ?? 0} of 12
          </p>
        ) : (
          // No fluke meter on the tiles: unlabeled, it read backwards (8.9).
          <ul className="grid grid-cols-3 gap-2.5">
            {answers.questions.map((q) => (
              <li key={q.id}>
                <SheetLink to={{ kind: "q", value: q.id }} className="group block h-full rounded-[18px]">
                  <Card
                    padding="none"
                    className="sky-card flex h-full flex-col gap-1.5 p-2.5 transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none"
                  >
                    <span className="text-[11px] text-ink-2">
                      <span className="sr-only">Question </span>
                      {q.number}
                      <span className="sr-only">:</span>
                    </span>
                    <span className="min-h-[2.5em] text-[12.5px] leading-tight text-ink">{q.shortName}</span>
                    <AnswerPill word={q.word} className="self-start !px-2 !text-[12px]" />
                  </Card>
                </SheetLink>
              </li>
            ))}
          </ul>
        )}
      </Row>
    </section>
  );
}

function SongsRow() {
  const L = useListener();
  const [all, setAll] = useState(false);
  const songs = L.songs.state === "ready" ? L.songs.data : null;
  const row = songs?.row ?? [];
  const listed = songs?.listed ?? [];
  const state =
    L.songs.state === "failed" ? (
      <RowFailed name="The sky of your songs" />
    ) : !songs ? (
      <div className="flex gap-3 overflow-hidden" aria-hidden>
        <div className="skeleton h-72 w-60 shrink-0" />
        <div className="skeleton h-72 w-60 shrink-0" />
      </div>
    ) : songs.state === "too-few-plays" || row.length === 0 ? (
      <p className="text-ink-2">Your songs&rsquo; skies appear once a song has a few plays.</p>
    ) : null;
  const seeAll =
    !state && listed.length > row.length ? (
      <Button size="lg" variant="outline" onClick={() => setAll((v) => !v)} aria-expanded={all}>
        {all ? "Show fewer" : "See all"}
      </Button>
    ) : null;
  return (
    <div id="songs-row">
      <RailRow
        id="songs"
        level={3}
        title="The sky of your songs"
        action={seeAll}
        rail={!state && !all ? { label: "Songs", noun: "songs", children: row.map((s) => <SongCard key={s.songId} song={s} />) } : undefined}
      >
        {state ?? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {listed.map((s) => (
              <li key={s.songId}>
                <SongCard song={s} />
              </li>
            ))}
          </ul>
        )}
      </RailRow>
    </div>
  );
}

function WildRow() {
  const L = useListener();
  const h = L.highlights.state === "ready" ? L.highlights.data : null;
  const wild = h?.wild ?? [];
  return (
    <RailRow
      id="wild"
      level={3}
      title="Your wildest nights"
      rail={wild.length > 0 ? { label: "Wild nights", noun: "wild nights", perView: WILD_PER_VIEW, children: wild.map((w) => <WildCard key={w.date} night={w} />) } : undefined}
    >
      {L.highlights.state === "failed" ? (
        <RowFailed name="Your wildest nights" />
      ) : !h ? (
        <div className="skeleton h-80 w-72" aria-hidden />
      ) : (
        <p className="text-ink-2">No wild nights yet. The sky&rsquo;s been calm while you listened.</p>
      )}
    </RailRow>
  );
}

function GenresRow() {
  const { listenerUrl } = useListener();
  const [g, setG] = useState<Genres | "failed" | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        // Each call reads one chunk of the artists' tags; poll while building (7.6).
        for (let i = 0; i < 200 && !stop; i++) {
          const data = await getJson<Genres>(listenerUrl("genres"));
          if (stop) return;
          setG(data);
          if (data.status !== "building") return;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch {
        if (!stop) setG("failed");
      }
    })();
    return () => {
      stop = true;
    };
  }, [listenerUrl]);

  const ready = g && g !== "failed" && g.status === "ready" && g.genres.length > 0 ? g.genres : null;
  return (
    <RailRow
      id="genres"
      level={3}
      title="Your genres"
      rail={
        ready
          ? {
              label: "Genres",
              noun: "genres",
              children: ready.map((x) => (
                <Card key={x.genre} padding="none" className="sky-card flex h-full flex-col p-4">
                  <p className="font-display text-[20px] text-ink">{x.genre}</p>
                  <p className="mt-1 text-[14px] text-ink-2">{Math.round(x.share * 100)}% of your plays</p>
                  <p className="mt-2 text-[13px] text-ink-2">{x.topArtists.join(", ")}</p>
                  {x.rising && <p className="mt-2 text-[13px] text-gold">Rising in your rotation</p>}
                  <SheetLink
                    to={{ kind: "night", value: x.peakNight.date }}
                    className="mt-auto inline-flex min-h-11 items-center pt-2 text-[13px] text-ink underline underline-offset-4"
                  >
                    Your biggest {x.genre} night: {nightDateText(x.peakNight.date)}
                  </SheetLink>
                </Card>
              )),
            }
          : undefined
      }
    >
      {g === "failed" || g?.status === "failed" ? (
        <p className="text-ink-2">Your genres didn&rsquo;t load. They&rsquo;ll try again on your next visit.</p>
      ) : !g ? (
        <div className="skeleton h-40 w-60" aria-hidden />
      ) : g.status === "building" ? (
        <p className="text-ink-2" role="status">
          Reading the liner notes&hellip; {g.done.toLocaleString("en-US")} of {g.total.toLocaleString("en-US")} artists
        </p>
      ) : (
        <p className="text-ink-2">Your genres show up once your artists have a few more plays.</p>
      )}
    </RailRow>
  );
}

/* ---- Compare, and Surprise me (8.4 items 6 and 7) ------------------------- */

function CompareCard() {
  const L = useListener();
  const router = useRouter();
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = other.trim();
    if (!isValidUsername(name)) {
      setError("That doesn't look like a Last.fm username.");
      return;
    }
    if (name.toLowerCase() === L.username.toLowerCase()) {
      setError("That's the same listener twice.");
      return;
    }
    router.push(`/vs/${encodeURIComponent(L.username)}/${encodeURIComponent(name)}`);
  };
  return (
    <Row id="compare" title="Compare with a friend">
      <Card padding="none" className="sky-card p-4">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              size="lg"
              variant="outline"
              label="Their Last.fm username"
              value={other}
              onChange={(e) => {
                setOther(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              errorMessage={error ?? undefined}
              autoComplete="off"
            />
          </div>
          <Button size="lg" type="submit">
            Compare
          </Button>
        </form>
      </Card>
    </Row>
  );
}

/** "Surprise me" (8.4 item 7, 8.11 item 5): from 640px a labeled button from
    the start; under 640px a 56px round one that fades in once "Tonight, for
    you" has scrolled above it, so it never sits on a "for you" row. From
    1124px it sits in the margin beside the column, where it covers nothing. */
function Surprise({ after }: { after: RefObject<HTMLDivElement | null> }) {
  const L = useListener();
  const last = useRef<string | null>(null);
  const phone = useMedia("(max-width: 639.98px)");
  const [past, setPast] = useState(false);
  const pool = L.highlights.state === "ready" ? (L.highlights.data.surprise ?? []) : [];
  useEffect(() => {
    const el = after.current;
    if (!el) return;
    // The band the button sits in: 16px plus its 56px, plus room to breathe.
    const io = new IntersectionObserver(([e]) => setPast(e.boundingClientRect.top < (e.rootBounds?.bottom ?? window.innerHeight)), {
      rootMargin: "0px 0px -88px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [after]);
  if (pool.length === 0) return null;
  const go = () => {
    // Never the same item twice in a row (7.5).
    const choices = pool.length > 1 ? pool.filter((p) => p.id !== last.current) : pool;
    const item = choices[Math.floor(Math.random() * choices.length)];
    last.current = item.id;
    if (item.kind === "song" && item.songId) L.open({ kind: "song", value: item.songId });
    else if (item.date) L.open({ kind: "night", value: item.date }, item.kind === "fact" ? item.text : undefined);
  };
  const shown = !phone || past;
  return (
    <div
      className={`fixed bottom-[calc(16px+env(safe-area-inset-bottom))] right-4 z-40 transition-[opacity,transform] duration-200 motion-reduce:transition-none sm:right-[max(16px,calc((100vw-720px)/2+16px))] min-[1124px]:left-[calc(50%+376px)] min-[1124px]:right-auto ${
        shown ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
      }`}
      inert={!shown}
    >
      {phone ? (
        <Button
          size="icon"
          aria-label="Surprise me"
          onClick={go}
          className="!size-14 rounded-full shadow-[0_10px_30px_rgba(0,0,0,.5),0_0_24px_rgba(212,175,55,.35)]"
        >
          <Icon name="sparkle" className="size-6" />
        </Button>
      ) : (
        <Button size="lg" startIcon={<Icon name="sparkle" />} onClick={go} className="rounded-full shadow-[0_10px_30px_rgba(0,0,0,.5),0_0_24px_rgba(212,175,55,.35)]">
          Surprise me
        </Button>
      )}
    </div>
  );
}
