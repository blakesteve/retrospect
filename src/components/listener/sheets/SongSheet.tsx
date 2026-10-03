"use client";

import { useEffect, useState } from "react";
import { Button } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { nightShort, songIndex, weekdayShortAt } from "../format";
import { SheetLink } from "../cards";
import { Icon, SheetFailed, SheetSkeleton } from "../pieces";
import { SkyWheel, WheelKey } from "../sky";
import { Gallery, NightFacts, useNight, useSkyAt } from "./nightParts";

/* The sky of a song (spec 8.7.1). */

export default function SongSheet({ value, setTitle, setBusy, invalid, retry }: SheetBodyProps) {
  const L = useListener();
  const songs = L.songs.state === "ready" ? L.songs.data : null;
  const song = songs ? (songIndex(songs).get(value) ?? null) : undefined;
  const night = useNight(song ? song.firstNight : null);
  const sky = useSkyAt(song ? song.firstPlayUts : null);
  const [tapped, setTapped] = useState<string | null>(null);

  useEffect(() => {
    if (song === null) invalid();
    else if (song) setTitle(song.track);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the songs arrive
  }, [song === undefined, song === null]);
  useEffect(() => setBusy(song === undefined || night.state === "loading"), [song, night.state, setBusy]);

  if (L.songs.state === "failed") return <SheetFailed retry={retry} />;
  if (song === undefined) return <SheetSkeleton />;
  if (!song) return null;

  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  // The first question this sky held, in question order (8.7.1 item 6).
  const heldId = QUESTIONS.find((q) => song.questionsHeld.includes(q.id))?.id;
  const held = heldId ? QUESTIONS.find((q) => q.id === heldId)! : null;
  const heldWord = held ? answers?.questions.find((q) => q.id === held.id)?.word : undefined;
  const since = song.plays - 1;
  const tappedPlanet = sky && sky !== "failed" && tapped ? sky.bodies.find((b) => b.body === tapped) : null;

  return (
    <div className="pb-4">
      {night.state === "ready" && night.night && <Gallery night={night.night} />}

      <p className="mt-4 text-[16px] text-ink-2">
        {song.artist}
        {song.genre ? ` · ${song.genre}` : ""}
      </p>
      <p className="mt-2 text-[14px] text-gold">
        {song.early
          ? `On record since ${song.firstPlayDate}. It was already in your rotation when your history starts.`
          : `First played ${song.firstPlayTime}, ${weekdayShortAt(L.zone, song.firstPlayUts)} ${song.firstPlayDate}`}
      </p>

      <div className="mt-6 flex flex-col items-center">
        {sky && sky !== "failed" ? (
          <>
            <SkyWheel bodies={sky.bodies} size={300} onPlanet={setTapped} aspects={sky.aspects} />
            {/* "Tap any planet." and the halo key, then the tapped planet's line (8.7.1, 8.9). */}
            <WheelKey bodies={sky.bodies} className="mt-2" />
            <p className="mt-1 min-h-11 text-center text-[14px] text-ink" aria-live="polite">
              {tappedPlanet ? (tappedPlanet.detail ?? tappedPlanet.line ?? `${tappedPlanet.body} in ${tappedPlanet.sign}`) : ""}
            </p>
          </>
        ) : sky === "failed" ? (
          <SheetFailed retry={retry} />
        ) : (
          <div className="skeleton size-[300px] rounded-full" aria-hidden />
        )}
      </div>

      <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-[0.12em] text-gold">The night of {nightShort(song.firstNight)}</h3>
      {night.state === "ready" && night.night ? (
        <NightFacts night={night.night} aspects={sky && sky !== "failed" ? sky.aspects : undefined} relativeTo={song.firstPlayUts} />
      ) : night.state === "failed" ? (
        <SheetFailed retry={retry} />
      ) : (
        <div className="skeleton mt-3 h-40" aria-hidden />
      )}

      {since > 0 && (
        <p className="mt-6 text-ink">
          You&rsquo;ve played it {since.toLocaleString("en-US")} time{since === 1 ? "" : "s"} since.
        </p>
      )}

      {held && (
        <p className="mt-4">
          <SheetLink to={{ kind: "q", value: held.id }} className="inline-flex min-h-11 items-center gap-1 text-gold underline underline-offset-4">
            {/* A question is named with its subject, never its number alone (9.2). */}
            {heldWord === "Too early"
              ? `Coincidence or pattern? Question ${held.number}, on ${held.subject}, needs more nights to say.`
              : `Coincidence or pattern? Question ${held.number}, on ${held.subject}, has the answer.`}
          </SheetLink>
        </p>
      )}

      {/* A sample on the landing has no page to share (8.1). */}
      {!L.sampleLabel && (
        <div className="mt-6">
          <Button size="lg" startIcon={<Icon name="share" />} onClick={() => L.open({ kind: "share", value: `song:${song.songId}` })}>
            Share this sky
          </Button>
        </div>
      )}
    </div>
  );
}
