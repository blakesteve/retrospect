"use client";

import type { MouseEvent, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Pill } from "@blakesteve/roster";
import { AlbumArt } from "@/components/AlbumArt";
import { useListener } from "./Shell";
import type { SongEntry, WildNight } from "./api";
import type { SheetRef } from "./sheetUrl";
import { Icon } from "./pieces";
import { MoonDrawing } from "./sky";

/** A link that opens a sheet: a real `href` (so it can open in a new tab),
    a pushState on a plain click (4). */
export function SheetLink({
  to,
  children,
  className = "",
  lead,
  ...rest
}: {
  to: SheetRef;
  children: ReactNode;
  className?: string;
  lead?: string;
  "aria-label"?: string;
}) {
  const L = useListener();
  // Keeps a shared `tz` in force, as the view switcher does (7.1).
  const tz = useSearchParams().get("tz");
  const href = `?${tz ? `tz=${encodeURIComponent(tz)}&` : ""}${to.kind}=${encodeURIComponent(to.value)}`;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    L.open(to, lead);
  };
  return (
    <a href={href} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}

/** A starry square standing in for missing art (8.4: "album art or the drawn sky"). */
function DrawnSky({ phase = 60 }: { phase?: number }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(1px 1px at 20% 30%, rgba(242,239,230,.5) 0, transparent 100%), radial-gradient(1px 1px at 70% 22%, rgba(242,239,230,.4) 0, transparent 100%), radial-gradient(1.5px 1.5px at 84% 64%, rgba(242,239,230,.35) 0, transparent 100%), radial-gradient(1px 1px at 42% 80%, rgba(242,239,230,.4) 0, transparent 100%), radial-gradient(90% 90% at 50% 40%, rgba(116,135,234,.18), transparent), var(--deep)",
      }}
    >
      <div className="absolute right-3 top-3">
        <MoonDrawing phaseAngle={phase} size={30} />
      </div>
    </div>
  );
}

/** A song card (8.4, 10): 240px, title on two lines at most, artist on one. */
export function SongCard({ song, width = 240, fluid = false }: { song: SongEntry; width?: number; fluid?: boolean }) {
  return (
    <li style={fluid ? undefined : { width }} className="list-none">
      <SheetLink to={{ kind: "song", value: song.songId }} className="group block rounded-[18px]">
        <Card padding="none" className="sky-card overflow-hidden transition-transform group-hover:-translate-y-0.5">
          <div className="relative aspect-[1/0.8]">
            <DrawnSky />
            <AlbumArt artist={song.artist} track={song.track} alt="" className="absolute inset-0 h-full w-full rounded-none border-0" />
            {song.highlight && (
              <Pill size="sm" className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate bg-[rgba(7,10,28,.78)] text-ink">
                {song.highlight}
              </Pill>
            )}
          </div>
          <div className="px-3.5 pb-3.5 pt-3">
            <p className="clamp-2 font-display text-[19px] leading-tight text-ink">{song.track}</p>
            <p className="mt-1 truncate text-[13px] text-ink-2">{song.artist}</p>
            <p className="mt-1 text-[12px] text-ink-2">
              {song.early ? "On record since your first weeks" : `${song.firstPlayTime}, ${song.firstPlayDate}`}
            </p>
          </div>
        </Card>
      </SheetLink>
    </li>
  );
}

const KIND_ICON = { eclipse: "eclipse", storm: "storm", flare: "flare", asteroid: "asteroid" } as const;

/** A wild-night card (8.4, 10): 280px, the night's photo or a drawn sky. */
export function WildCard({ night }: { night: WildNight }) {
  return (
    <li style={{ width: 280 }} className="list-none">
      <SheetLink to={{ kind: "night", value: night.date }} className="group block rounded-[18px]">
        <Card padding="none" className="sky-card relative h-[360px] overflow-hidden">
          <DrawnSky phase={180} />
          {night.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- NASA's own CDN, credited below
            <img src={night.photo.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: "linear-gradient(180deg,rgba(7,10,28,.15),transparent 30%,rgba(7,10,28,.6) 58%,rgba(7,10,28,.96) 88%)" }}
          />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
              {night.kind && <Icon name={KIND_ICON[night.kind]} />}
              {night.dateLine ?? night.date}
            </p>
            <p className="mt-1.5 font-display text-[22px] leading-tight text-ink">{night.title}</p>
            {night.line && <p className="mt-1.5 text-[13px] text-ink-2">{night.line}</p>}
            {night.photo?.credit && <p className="mt-1 text-[11px] text-ink-2">{night.photo.credit}</p>}
          </div>
        </Card>
      </SheetLink>
    </li>
  );
}

/** A static sky chip, highlight chip or flare class (12: Pill, 28px). */
export function SkyPill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <Pill
      size="md"
      className="border bg-[rgba(242,239,230,.06)] text-ink"
      style={color ? { borderColor: color, boxShadow: `0 0 14px color-mix(in srgb, ${color} 30%, transparent)` } : { borderColor: "var(--line-2)" }}
    >
      {children}
    </Pill>
  );
}
