"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Disclosure, Eyebrow, Input } from "@blakesteve/roster";
import { QUESTIONS, type QuestionId } from "@/lib/answers/questions";
import { isValidUsername } from "@/lib/username";
import { ListeningProfile } from "@/components/ListeningProfile";
import { useListener, VIEW_HEADING } from "./Shell";
import { getJson, type Genres, type QuestionPayload } from "./api";
import { nightDateText } from "./format";
import { SheetLink, SkyPill, SongCard, WildCard } from "./cards";
import { AnswerPill, FlukeMeter, Icon, Jar, Row, RowFailed, WORD_COLOR } from "./pieces";
import { DIGNITY_COLOR, MoonDrawing, SkyWheel, planetGlyph } from "./sky";
import { Guide } from "./Guide";

/* Tonight (spec 8.4). Lays out what the routes say; computes nothing. */

/** Rarest first (8.4): retrogrades, then Venus and Mars, then storms and
    flares, then the Moon. */
const RARITY: QuestionId[] = ["mercury", "venusrx", "marsrx", "venushome", "venusmars", "marswater", "venusdet", "storms", "flares", "fullmoon", "newmoon", "moonstrong"];

export function Tonight() {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;

  return (
    <div>
      {/* 2. The sky right now */}
      <section aria-labelledby={VIEW_HEADING} className="mt-6">
        <Eyebrow size="sm" tone="primary">
          Tonight
        </Eyebrow>
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
        {sky?.timeLine && <p className="mt-1 text-[13px] text-ink-2">{sky.timeLine}</p>}

        <div id="tonight-wheel" className="mt-4 flex flex-col items-center">
          {sky ? (
            <SkyWheel bodies={sky.sky.bodies} size={300} onPlanet={(body) => L.open({ kind: "planet", value: body.toLowerCase() })} />
          ) : L.skyNow.state === "failed" ? (
            <RowFailed name="Tonight's sky" />
          ) : (
            <div className="skeleton size-[300px] rounded-full" aria-hidden />
          )}
          {sky?.epic && (
            <figure className="relative -mt-10 w-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- NASA's own CDN, credited */}
              <img
                src={sky.epic.url}
                alt=""
                className="mx-auto h-32 w-full object-cover opacity-90 [mask-image:linear-gradient(90deg,transparent,#000_22%,#000_78%,transparent)]"
              />
              <figcaption className="mt-1 text-center text-[12px] text-ink-2">
                {sky.epic.line} · {sky.epic.credit}
              </figcaption>
            </figure>
          )}
        </div>

        {sky?.moon && (
          <Card padding="none" className="sky-card mt-4 flex items-center gap-3 px-4 py-3">
            <MoonDrawing phaseAngle={sky.sky.moon.phaseAngle} size={44} />
            <p className="text-[14.5px] leading-snug text-ink">{sky.moon.line}</p>
          </Card>
        )}

        {sky?.chips && sky.chips.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="In the sky now">
            {sky.chips.slice(0, 3).map((c) => (
              <li key={c.text}>
                <SkyPill color={c.dignity ? (DIGNITY_COLOR[c.dignity] ?? undefined) : c.kind === "station" ? "var(--gold)" : undefined}>{c.text}</SkyPill>
              </li>
            ))}
          </ul>
        )}

        {sky?.planets && (
          <div className="mt-3">
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
          </div>
        )}
      </section>

      {/* 3. Tonight, for you */}
      <ForYou />

      {/* 4. Rows */}
      <SongsRow />
      <WildRow />
      <ComingUpRow />
      <GenresRow />
      <QuestionsGrid />
      <CompareCard />
      <ListeningProfile username={L.username} zone={L.zone} />

      {/* 5. Surprise me */}
      <Surprise />

      {/* The guide finds its anchors by id (8.10). */}
      {L.guideReady && <Guide anchors={["tonight-wheel", "songs-row", "questions-grid"]} />}
    </div>
  );
}

export function ForYou() {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const a = L.answers.state === "ready" ? L.answers.data : null;
  const answers = a && a.status !== "computing" ? a : null;
  const held = sky ? RARITY.filter((id) => sky.questionsHeld.includes(id)).slice(0, 3) : [];
  const byId = new Map<string, QuestionPayload>(answers?.questions.map((q) => [q.id, q]) ?? []);

  return (
    <section aria-labelledby="foryou-h" className="mt-10">
      <h2 id="foryou-h" className="font-display text-[25px] leading-tight text-ink">
        Tonight, for you
      </h2>
      <Card padding="none" className="sky-card mt-3 px-4 py-2">
        {!answers ? (
          L.answers.state === "failed" ? (
            <p className="py-3 text-ink-2">The 12 questions didn&rsquo;t load. Refresh to try again.</p>
          ) : (
            <p className="py-3 text-ink-2">
              Checking 12 questions against your sky&hellip; {a && "done" in a ? a.done : 0} of 12
            </p>
          )
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {held.map((id) => {
              const q = byId.get(id);
              const meta = QUESTIONS.find((x) => x.id === id)!;
              if (!q) return null;
              return (
                <li key={id} className="flex items-start gap-3 py-3">
                  {/* Not checked and Checking aren't answers: no jar (6.3). */}
                  {q.notChecked || q.updating ? (
                    <span className="w-[22px] shrink-0" aria-hidden />
                  ) : (
                    <Jar fill={q.status === "tested" ? 1 : q.status === "too-few-events" ? q.events / 6 : q.inPlays / 500} color={WORD_COLOR[q.word]} width={22} />
                  )}
                  <p className="min-w-0 text-[15px] leading-relaxed text-ink">
                    {q.phrases.tonightLine}{" "}
                    <SheetLink to={{ kind: "q", value: id }} className="inline-flex min-h-11 items-center text-gold underline underline-offset-4">
                      Question {meta.number}
                    </SheetLink>
                  </p>
                </li>
              );
            })}
            {held.length === 0 && sky?.noneOverhead && <li className="py-3 text-[15px] text-ink">{sky.noneOverhead}</li>}
            {answers.headsUp && (
              <li className="flex items-start gap-3 py-3">
                <span className="mt-1 text-[var(--word-early)]">
                  <Icon name="clock" />
                </span>
                <p className="min-w-0 text-[15px] leading-relaxed text-ink">
                  {answers.headsUp.line}{" "}
                  <SheetLink to={{ kind: "q", value: answers.headsUp.id }} className="inline-flex min-h-11 items-center text-gold underline underline-offset-4">
                    Question {QUESTIONS.find((x) => x.id === answers.headsUp!.id)!.number}
                  </SheetLink>
                </p>
              </li>
            )}
          </ul>
        )}
      </Card>
    </section>
  );
}

function SongsRow() {
  const L = useListener();
  const [all, setAll] = useState(false);
  const songs = L.songs.state === "ready" ? L.songs.data : null;
  const row = songs?.row ?? [];
  const listed = songs?.listed ?? [];
  return (
    <section id="songs-row">
      <Row
        id="songs"
        title="The sky of your songs"
        action={
          listed.length > row.length ? (
            <Button size="lg" variant="outline" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? "Show fewer" : "See all"}
            </Button>
          ) : null
        }
      >
        {L.songs.state === "failed" ? (
          <RowFailed name="The sky of your songs" />
        ) : !songs ? (
          <div className="flex gap-3 overflow-hidden" aria-hidden>
            <div className="skeleton h-72 w-60 shrink-0" />
            <div className="skeleton h-72 w-60 shrink-0" />
          </div>
        ) : songs.state === "too-few-plays" || row.length === 0 ? (
          <p className="text-ink-2">Your songs&rsquo; skies appear once a song has a few plays.</p>
        ) : all ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {listed.map((s) => (
              <SongCard key={s.songId} song={s} fluid />
            ))}
          </ul>
        ) : (
          <ul className="rail" aria-label="Songs">
            {row.map((s) => (
              <SongCard key={s.songId} song={s} />
            ))}
          </ul>
        )}
      </Row>
    </section>
  );
}

function WildRow() {
  const L = useListener();
  const h = L.highlights.state === "ready" ? L.highlights.data : null;
  return (
    <Row id="wild" title="Your wildest nights">
      {L.highlights.state === "failed" ? (
        <RowFailed name="Your wildest nights" />
      ) : !h ? (
        <div className="skeleton h-80 w-72" aria-hidden />
      ) : !h.wild || h.wild.length === 0 ? (
        <p className="text-ink-2">No wild nights yet. The sky&rsquo;s been calm while you listened.</p>
      ) : (
        <ul className="rail" aria-label="Wild nights">
          {h.wild.map((w) => (
            <WildCard key={w.date} night={w} />
          ))}
        </ul>
      )}
    </Row>
  );
}

function ComingUpRow() {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
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
    <Row id="coming" title="Coming up in your sky">
      <ul className="rail" aria-label="Coming up">
        {sky.comingUp.map((c) => {
          const q = c.questions.map((id) => answers?.questions.find((x) => x.id === id)).find(Boolean);
          const meta = q ? QUESTIONS.find((x) => x.id === q.id) : undefined;
          return (
            <li key={`${c.time}-${c.text}`} className="w-[240px] list-none">
              <Card padding="none" className="sky-card h-full p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">{c.date}</p>
                <p className="mt-2 font-display text-[18px] leading-snug text-ink">{c.text}</p>
                <p className="mt-1 text-[12px] text-ink-2">{c.at}</p>
                {q && meta && (
                  <SheetLink to={{ kind: "q", value: q.id }} className="mt-3 flex min-h-11 items-center gap-2">
                    <AnswerPill word={q.word} />
                    <span className="text-[13px] text-ink-2 underline underline-offset-4">Question {meta.number}</span>
                  </SheetLink>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </Row>
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

  return (
    <Row id="genres" title="Your genres">
      {g === "failed" || g?.status === "failed" ? (
        <p className="text-ink-2">Your genres didn&rsquo;t load. They&rsquo;ll try again on your next visit.</p>
      ) : !g ? (
        <div className="skeleton h-40 w-60" aria-hidden />
      ) : g.status === "building" ? (
        <p className="text-ink-2" role="status">
          Reading the liner notes&hellip; {g.done.toLocaleString("en-US")} of {g.total.toLocaleString("en-US")} artists
        </p>
      ) : g.genres.length === 0 ? (
        <p className="text-ink-2">Your genres show up once your artists have a few more plays.</p>
      ) : (
        <ul className="rail" aria-label="Genres">
          {g.genres.map((x) => (
            <li key={x.genre} className="w-[240px] list-none">
              <Card padding="none" className="sky-card h-full p-4">
                <p className="font-display text-[20px] text-ink">{x.genre}</p>
                <p className="mt-1 text-[14px] text-ink-2">{Math.round(x.share * 100)}% of your plays</p>
                <p className="mt-2 text-[13px] text-ink-2">{x.topArtists.join(", ")}</p>
                {x.rising && <p className="mt-2 text-[13px] text-gold">Rising in your rotation</p>}
                <SheetLink to={{ kind: "night", value: x.peakNight.date }} className="mt-2 inline-flex min-h-11 items-center text-[13px] text-ink underline underline-offset-4">
                  Your biggest {x.genre} night: {nightDateText(x.peakNight.date)}
                </SheetLink>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

export function QuestionsGrid() {
  const L = useListener();
  const a = L.answers.state === "ready" ? L.answers.data : null;
  const answers = a && a.status !== "computing" ? a : null;
  return (
    <section id="questions-grid">
      <Row id="questions" title="Does the sky move you?">
        {L.answers.state === "failed" ? (
          <RowFailed name="The 12 questions" />
        ) : !answers ? (
          <p className="text-ink-2" role="status">
            Checking 12 questions against your sky&hellip; {a?.done ?? 0} of 12
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2.5">
              {answers.questions.map((q) => (
                <li key={q.id}>
                  <SheetLink to={{ kind: "q", value: q.id }} className="block h-full rounded-[18px]">
                    <Card padding="none" className="sky-card flex h-full flex-col gap-1.5 p-2.5">
                      <span className="text-[11px] text-ink-2">{q.number}</span>
                      <span className="min-h-[2.5em] text-[12.5px] leading-tight text-ink">{q.shortName}</span>
                      <AnswerPill word={q.word} className="self-start !px-2 !text-[12px]" />
                      {q.status === "tested" && q.phrases.likelihood && (
                        <>
                          <FlukeMeter likelihood={q.phrases.likelihood} word={q.word} labels={false} />
                          <span className="sr-only">{q.phrases.likelihood}</span>
                        </>
                      )}
                    </Card>
                  </SheetLink>
                </li>
              ))}
            </ul>
          </>
        )}
      </Row>
    </section>
  );
}

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
              /* Roster's Input is Headless UI's field, which sets aria-invalid
                 from its own `invalid` and overwrites one passed directly. */
              {...{ invalid: Boolean(error) }}
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

function Surprise() {
  const L = useListener();
  const last = useRef<string | null>(null);
  const pool = L.highlights.state === "ready" ? (L.highlights.data.surprise ?? []) : [];
  if (pool.length === 0) return null;
  const go = () => {
    // Never the same item twice in a row (7.5).
    const choices = pool.length > 1 ? pool.filter((p) => p.id !== last.current) : pool;
    const item = choices[Math.floor(Math.random() * choices.length)];
    last.current = item.id;
    if (item.kind === "song" && item.songId) L.open({ kind: "song", value: item.songId });
    else if (item.date) L.open({ kind: "night", value: item.date }, item.kind === "fact" ? item.text : undefined);
  };
  return (
    <div className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] right-4 z-40 sm:right-[max(16px,calc((100vw-720px)/2+16px))]">
      <Button size="lg" startIcon={<Icon name="sparkle" />} onClick={go} className="rounded-full shadow-[0_10px_30px_rgba(0,0,0,.5),0_0_24px_rgba(212,175,55,.35)]">
        Surprise me
      </Button>
    </div>
  );
}
