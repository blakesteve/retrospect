"use client";

import { useEffect, useState } from "react";
import { Button } from "@blakesteve/roster";
import { QUESTIONS } from "@/lib/answers/questions";
import { cardImage, cardRef, nightSays, questionSays, shareLink, songSays } from "@/lib/share/card";
import { useListener } from "../Shell";
import type { SheetBodyProps } from "../SheetHost";
import { nightDateText, songIndex } from "../format";
import { Icon, SheetFailed, SheetSkeleton } from "../pieces";
import { useNight } from "./nightParts";

/* The share sheet (spec 8.7.5): a preview of the card (9:16), what it says
   in plain words, and "Save image", "Copy link" and, where the browser has
   it, "Share…". The words come from the same module as the card's, and the
   link carries the sharer's zone (7.1). */

export default function ShareSheet({ value, setTitle, setBusy, invalid, retry }: SheetBodyProps) {
  const L = useListener();
  const ref = cardRef(value);
  const kind = ref?.kind ?? "song";
  const id = ref ? (ref.kind === "night" ? ref.date : ref.id) : "";
  const [copied, setCopied] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const song = kind === "song" ? songIndex(L.songs.state === "ready" ? L.songs.data : undefined).get(id) : undefined;
  const answers = L.answers.state === "ready" && L.answers.data.status !== "computing" ? L.answers.data : null;
  const question = kind === "q" ? QUESTIONS.find((q) => q.id === id) : undefined;
  // A question being checked again has no word to share yet: the sheet waits for it, as the card does (6.6a).
  const answer = question ? answers?.questions.find((q) => q.id === question.id) : undefined;
  const word = answer && !answer.updating ? answer.word : undefined;
  const nightLoad = useNight(kind === "night" ? id : null);
  const wild = nightLoad.state === "ready" ? nightLoad.night?.wild : null;

  // What the card says (8.7.5): never a word without its question.
  const says =
    kind === "song" && song
      ? songSays(song)
      : kind === "night"
        ? nightSays(nightDateText(id), wild?.title ?? null)
        : question && word
          ? questionSays(question.question, word)
          : null;

  useEffect(() => {
    setTitle(kind === "song" ? "Share this sky" : kind === "night" ? "Share this night" : "Share this answer");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);
  // A card that isn't one, or a song, night or question that isn't in this history: invalid (8.7).
  const missing =
    !ref ||
    (kind === "song" && L.songs.state === "ready" && !song) ||
    (kind === "q" && !question) ||
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
  if (loading || missing || !ref) return <SheetSkeleton />;

  const link = shareLink(window.location.origin, L.username, ref, L.zone);
  const tall = cardImage(L.username, ref, L.zone, "tall");

  const copy = async () => {
    // Cleared first, so a second copy says it again.
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link);
      setTimeout(() => setCopied(true), 50);
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
  const save = async () => {
    setSaveFailed(false);
    setSaving(true);
    try {
      const res = await fetch(tall);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `retrospect-${L.username}-${kind}-${id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-4">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {/* The card itself, 9:16, as "Save image" saves it. Its words are beside it. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- our own rendered PNG, which next/image would only re-encode */}
        <img src={tall} alt="" width={180} height={320} className="h-80 w-[180px] shrink-0 rounded-xl border border-[var(--line)] bg-surface-2" data-card-preview />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gold">The card says</p>
          <p className="mt-2 font-display text-[22px] leading-snug text-ink">{says}</p>
          <p className="mt-3 break-all text-[13px] text-ink-2">{link}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={save} disabled={saving}>
          Save image
        </Button>
        <Button size="lg" variant="outline" startIcon={<Icon name="share" />} onClick={copy}>
          Copy link
        </Button>
        {canShare && (
          <Button size="lg" variant="outline" onClick={share}>
            Share&hellip;
          </Button>
        )}
        <p role="status" aria-live="polite" className="text-sm text-ink-2">
          {copied ? "Link copied." : ""}
        </p>
      </div>
      {/* Mounted from the start, so the failure is announced when it's said (11). */}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink empty:mt-0">
        {saveFailed ? "Couldn’t make the image. Try again." : ""}
      </p>
    </div>
  );
}
