"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
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
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "children" | "className">) {
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

/** A starry square standing in for missing art (8.4: "album art or the
    drawn sky"), with the Moon only at that minute's or night's real phase,
    or no Moon at all (8.9). */
function DrawnSky({ phase }: { phase?: number | null }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(1px 1px at 20% 30%, rgba(242,239,230,.5) 0, transparent 100%), radial-gradient(1px 1px at 70% 22%, rgba(242,239,230,.4) 0, transparent 100%), radial-gradient(1.5px 1.5px at 84% 64%, rgba(242,239,230,.35) 0, transparent 100%), radial-gradient(1px 1px at 42% 80%, rgba(242,239,230,.4) 0, transparent 100%), radial-gradient(90% 90% at 50% 40%, rgba(116,135,234,.18), transparent), var(--deep)",
      }}
    >
      {typeof phase === "number" && (
        <div className="absolute right-3 top-3">
          <MoonDrawing phaseAngle={phase} size={30} />
        </div>
      )}
    </div>
  );
}

/** A label that states a fact (8.9): a solid fill, no border and no glow,
    so it never looks like a control. 4.5:1 or better on its fill (11). */
export function FactLabel({ children, tone, size = "md", className = "" }: { children: ReactNode; tone?: string; size?: "sm" | "md"; className?: string }) {
  return (
    <Pill
      size={size}
      className={`border-0 text-ink ${className}`}
      style={{ backgroundColor: tone ? `color-mix(in srgb, ${tone} 26%, #10142e)` : "#1b2148" }}
    >
      {children}
    </Pill>
  );
}

/** A song card (8.4, 10): its width comes from the row; the title on two
    lines at most, the artist on one. `chip` replaces the song's own
    highlight, as a question's pairings do (8.7.3). */
export function SongCard({ song, chip }: { song: SongEntry; chip?: string }) {
  const label = chip ?? song.highlight;
  return (
    <SheetLink to={{ kind: "song", value: song.songId }} className="group block h-full rounded-[18px]">
      <Card padding="none" className="sky-card h-full overflow-hidden transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none">
        <div className="relative aspect-[1/0.8]">
          <DrawnSky phase={song.moonPhase} />
          <AlbumArt artist={song.artist} track={song.track} alt="" className="absolute inset-0 h-full w-full rounded-none border-0" />
          {label && (
            <FactLabel size="sm" className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate">
              {label}
            </FactLabel>
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
  );
}

const KIND_ICON = { eclipse: "eclipse", storm: "storm", flare: "flare", asteroid: "asteroid" } as const;

/** A wild-night card (8.4, 10): the night's photo or a drawn sky. */
export function WildCard({ night }: { night: WildNight }) {
  return (
    <SheetLink to={{ kind: "night", value: night.date }} className="group block h-full rounded-[18px]">
      <Card padding="none" className="sky-card relative h-[360px] overflow-hidden transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none">
        <DrawnSky phase={night.photo ? null : night.moonPhase} />
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
  );
}
