"use client";

import { useEffect, useState } from "react";
import { Button } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { nightDateText, songIndex } from "../format";
import { Icon, SheetFailed, SheetSkeleton } from "../pieces";
import { useNight } from "./nightParts";

/* The share sheet (spec 8.7.5): what the card says in plain words, and the
   link that opens it, carrying the zone. The card's image and "Save image"
   arrive with the share-card rewrite (3d). */

export default function ShareSheet({ value, setTitle, setBusy, invalid, retry }: SheetBodyProps) {
  const L = useListener();
  const [kind, id] = value.split(":") as ["song" | "night" | "q", string];
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const song = kind === "song" ? songIndex(L.songs.state === "ready" ? L.songs.data : undefined).get(id) : undefined;
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const question = kind === "q" ? QUESTIONS.find((q) => q.id === id) : undefined;
  const word = question ? answers?.questions.find((q) => q.id === question.id)?.word : undefined;
  const nightLoad = useNight(kind === "night" ? id : null);
  const wild = nightLoad.state === "ready" ? nightLoad.night?.wild : null;

  // What the card says (8.7.5): never a word without its question.
  const says =
    kind === "song" && song
      ? `The sky the minute I first played ${song.track} by ${song.artist} · ${song.firstPlayTime}, ${song.firstPlayDate}`
      : kind === "night"
        ? `My night of ${nightDateText(id)}${wild ? `: ${wild.title.charAt(0).toLowerCase()}${wild.title.slice(1)}` : ""}`
        : question && word
          ? `${question.question.replace(/you\b/g, "I").replace(/your\b/g, "my")} ${word}.`
          : null;

  useEffect(() => {
    setTitle(kind === "song" ? "Share this sky" : kind === "night" ? "Share this night" : "Share this answer");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);
  // A song, night or question that isn't in this history: invalid (8.7).
  const missing =
    (kind === "song" && L.songs.state === "ready" && !song) ||
    (kind === "night" && nightLoad.state === "ready" && (!nightLoad.night || nightLoad.night.plays === 0));
  const failed =
    (kind === "song" && L.songs.state === "failed") ||
    (kind === "q" && L.answers.state === "failed") ||
    (kind === "night" && nightLoad.state === "failed");
  const loading = !failed && (says === null || (kind === "night" && nightLoad.state === "loading"));
  useEffect(() => {
    if (missing) invalid();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once it's known
  }, [missing]);
  useEffect(() => setBusy(loading), [loading, setBusy]);
  if (failed) return <SheetFailed retry={retry} />;
  if (loading || missing) return <SheetSkeleton />;

  const param = kind === "q" ? "q" : kind;
  const link = `${window.location.origin}/u/${encodeURIComponent(L.username)}?${param}=${encodeURIComponent(id)}&tz=${encodeURIComponent(L.zone)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "Retrospect", text: says ?? undefined, url: link });
    } catch {
      /* a canceled share does nothing (8.7.5) */
    }
  };

  return (
    <div className="pb-4">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gold">The card says</p>
      <p className="mt-2 font-display text-[22px] leading-snug text-ink">{says}</p>
      <p className="mt-3 break-all text-[13px] text-ink-2">{link}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" variant="outline" startIcon={<Icon name="share" />} onClick={copy}>
          Copy link
        </Button>
        {canShare && (
          <Button size="lg" onClick={share}>
            Share&hellip;
          </Button>
        )}
        <p role="status" aria-live="polite" className="text-sm text-ink-2">
          {copied ? "Link copied." : ""}
        </p>
      </div>
    </div>
  );
}
