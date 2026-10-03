"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Card, Eyebrow } from "@blakesteve/roster";
import { openSheet, type SheetRef } from "@/components/listener/sheetUrl";
import type { Planet } from "@/components/listener/api";
import { SkyWheel } from "@/components/listener/sky";
import { Jar, WORD_COLOR } from "@/components/listener/jar";
import type { AnswerWord } from "@/lib/answers/words";
import type { TileFacts } from "./tileFacts";
import { openSample, type SampleSheet } from "./sampleUrls";
import { loadSkyNow } from "./skyNow";
import { preloadSamples } from "./SampleMount";

/* "What you get" (spec 8.1 item 5): four tiles, each opening a working
   sample in a sheet. Each is a link with a real `href`, so it opens in a new
   tab too, and a pushState on a plain click (4). The art is decoration: the
   title and line are the link's name. Each tile wears its own "Sample"
   badge, and the sheet it opens carries the full label: one label under the
   heading read as the product being a made-up listener (2 Oct 2026). */

function Tile({
  href,
  onOpen,
  title,
  line,
  art,
}: {
  href: string;
  onOpen: () => void;
  title: string;
  line: string;
  art: ReactNode;
}) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    preloadSamples();
    onOpen();
  };
  return (
    <li className="min-w-0">
      <a
        href={href}
        onClick={click}
        onPointerEnter={preloadSamples}
        onFocus={preloadSamples}
        onTouchStart={preloadSamples}
        className="group block h-full rounded-[18px]"
      >
        <Card padding="none" className="sky-card flex h-full flex-col overflow-hidden transition-transform group-hover:-translate-y-0.5">
          <span aria-hidden className="relative block overflow-hidden bg-[var(--deep)]" style={{ aspectRatio: "1 / 0.86" }}>
            {art}
            <span className="absolute left-2 top-2 rounded-full bg-[#1b2148] px-2 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.12em] text-gold">
              Sample
            </span>
          </span>
          <span className="block px-3 pb-3.5 pt-2.5">
            <span className="block font-display text-[17px] leading-tight text-ink">{title}</span>
            <span className="mt-1.5 block text-[13px] leading-snug text-ink-2">{line}</span>
          </span>
        </Card>
      </a>
    </li>
  );
}

/** A label over the art, as the sample's own chips read: a fact, so a
    solid fill and no border (8.9). */
function ArtCaption({ title, chip }: { title: string; chip: string | null }) {
  return (
    <span className="absolute inset-x-2 bottom-2 flex flex-col items-start gap-1">
      <span className="font-display text-[15px] leading-tight text-ink" style={{ textShadow: "0 1px 8px rgba(0,0,0,.8)" }}>
        {title}
      </span>
      {chip && (
        <span className="max-w-full truncate rounded-full bg-[#1b2148] px-2 py-1 text-[11px] leading-none text-ink">{chip}</span>
      )}
    </span>
  );
}

const fade = (
  <span className="absolute inset-0" style={{ background: "linear-gradient(180deg,transparent 40%,rgba(7,10,28,.85))" }} />
);

export function Tiles({ facts }: { facts: TileFacts }) {
  const [planets, setPlanets] = useState<Planet[]>([]);
  // Today's real sky on the Tonight tile; until it loads, or if it can't,
  // the wheel is drawn empty, with no error on the landing (8.1).
  useEffect(() => {
    let live = true;
    loadSkyNow().then(
      (sky) => live && setPlanets(sky.sky.bodies),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const sheet = (ref: SheetRef) => () => openSheet(ref);
  const sample = (s: SampleSheet) => () => openSample(s);

  return (
    <section aria-labelledby="goods-h" className="mt-9">
      <Eyebrow as="h2" id="goods-h" size="sm" tone="primary">
        What you get
      </Eyebrow>
      <p className="mt-1 text-[13px] text-ink-2">Tap one to try it on a made-up listener&rsquo;s history.</p>
      <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          href={`/?song=${encodeURIComponent(facts.song.id)}`}
          onOpen={sheet({ kind: "song", value: facts.song.id })}
          title="The sky of every song"
          line="Planets, the Moon, storms and flares the first time you played it."
          art={
            <>
              {/* A total eclipse: the Moon's disc in the Sun's corona, up and to the
                  right, clear of the badge and a two-line caption. */}
              <span
                className="absolute rounded-full"
                style={{
                  width: "27%",
                  aspectRatio: "1",
                  right: "12%",
                  top: "9%",
                  background: "#04050c",
                  boxShadow: "0 0 0 2px rgba(255,236,190,.85), 0 0 18px 6px rgba(255,214,140,.55), 0 0 46px 16px rgba(255,190,110,.22)",
                }}
              />
              {fade}
              <ArtCaption title={facts.song.name} chip={facts.song.chip} />
            </>
          }
        />
        <Tile
          href={`/?night=${facts.night.date}`}
          onOpen={sheet({ kind: "night", value: facts.night.date })}
          title="Your wildest nights"
          line="Eclipses, the strongest storm in about 20 years, a 140 m asteroid, and what you played."
          art={
            <>
              {/* Aurora over a dark horizon. */}
              <span
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(120% 60% at 30% 20%, rgba(93,226,176,.45), transparent 60%), radial-gradient(90% 50% at 75% 35%, rgba(116,135,234,.4), transparent 65%), radial-gradient(70% 40% at 55% 10%, rgba(168,97,127,.35), transparent 70%), var(--deep)",
                }}
              />
              {fade}
              <ArtCaption title="May 10, 2024" chip={facts.night.chip} />
            </>
          }
        />
        <Tile
          href="/?sample=tonight"
          onOpen={sample("tonight")}
          title="Tonight"
          line="Today’s real sky, and how your listening went under skies like it."
          art={
            <span className="absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(80% 80% at 50% 45%, #1a2152, #070a1c)" }}>
              <SkyWheel bodies={planets} size={140} className="h-auto w-[86%]" />
            </span>
          }
        />
        <Tile
          href="/?sample=answers"
          onOpen={sample("answers")}
          title="12 honest answers"
          line="Does the sky move you? Mostly no, said kindly and precisely."
          art={
            <span
              className="absolute inset-0 flex items-end justify-center gap-1.5 px-1 pb-4"
              style={{ background: "radial-gradient(80% 70% at 50% 60%, rgba(116,135,234,.14), transparent)" }}
            >
              {facts.words.map(({ word, count }) => (
                <span key={word} className="flex w-10 flex-col items-center gap-1 text-center text-[10px] leading-tight text-ink-2">
                  <Jar fill={word === "Too early" ? 1 / 6 : 1} color={WORD_COLOR[word as AnswerWord] ?? "var(--word-quiet)"} width={26} />
                  <span>{word}</span>
                  <span className="text-ink">{count}</span>
                </span>
              ))}
            </span>
          }
        />
      </ul>
    </section>
  );
}
