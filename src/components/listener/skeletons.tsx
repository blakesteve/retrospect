"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Carousel, type CarouselPerView } from "@blakesteve/roster";
import { SkySkeleton } from "./pieces";
import { CARDS_PER_VIEW } from "./rail";

/* What each part of the listener's page looks like while it loads (8.4): the
   content's own boxes and line boxes, drawn as Roster skeletons, so each
   thing lands at its skeleton's size where its size follows the layout
   (`e2e/skeletons.spec.ts` measures those; ROADMAP's "Loading shifts that
   follow the data" lists the rest).
   The text sizes and spacing below mirror the components they stand in for;
   change one, change both. */

/** A row's cards on the row's own carousel (the same cards per view, gap and
    gutter as `Rail`), hidden and out of reach, so each card lands where its
    skeleton was. */
export function RailSkeleton({ perView = CARDS_PER_VIEW, card, count = 3 }: { perView?: CarouselPerView; card: ReactNode; count?: number }) {
  return (
    <div aria-hidden inert>
      <Carousel aria-label="Loading" perView={perView} gap={12} gutter={16} bleed arrows="none" listClassName="pb-3">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="h-full">
            {card}
          </div>
        ))}
      </Carousel>
    </div>
  );
}

/** A song card (`SongCard`): its art, the title on two lines, the artist and the date. */
export const SongCardSkeleton = (
  <div className="border border-transparent">
    <SkySkeleton shape="block" height="auto" className="aspect-[1/0.8]" />
    <div className="px-3.5 pt-3 pb-3.5">
      {/* The title on two lines on a phone's narrower card, one from 640px. */}
      <p className="font-display text-[19px] leading-tight">
        <SkySkeleton shape="line" size="inherit" />
        <span className="block sm:hidden">
          <SkySkeleton shape="line" size="inherit" width="60%" />
        </span>
      </p>
      <p className="mt-1 text-[13px]">
        <SkySkeleton shape="line" size="inherit" width="60%" />
      </p>
      <p className="mt-1 text-[12px]">
        <SkySkeleton shape="line" size="inherit" width="45%" />
      </p>
    </div>
  </div>
);

/** A wild-night card (`WildCard`): a fixed 360px. */
export const WildCardSkeleton = <SkySkeleton shape="block" height={360} />;

/** A coming-up card: its date, two lines of event, the time, the button and the question link. */
export const ComingUpCardSkeleton = (
  <div className="flex h-full flex-col border border-transparent p-4">
    <p className="text-[11px] font-semibold tracking-[0.14em] uppercase">
      <SkySkeleton shape="line" size="inherit" width="35%" />
    </p>
    <p className="mt-2 font-display text-[18px] leading-snug">
      <SkySkeleton shape="line" size="inherit" lines={2} />
    </p>
    <p className="mt-1 text-[12px]">
      <SkySkeleton shape="line" size="inherit" width="45%" />
    </p>
    <div className="mt-3">
      <SkySkeleton shape="block" height={44} width="11rem" radius="full" />
    </div>
    <div className="mt-auto flex min-h-11 items-center pt-3 text-[13px]">
      <SkySkeleton shape="line" size="inherit" width="70%" />
    </div>
  </div>
);

/** A genre card: the genre, its share, two lines of artists and the night link. */
export const GenreCardSkeleton = (
  <div className="flex h-full flex-col border border-transparent p-4">
    <p className="font-display text-[20px]">
      <SkySkeleton shape="line" size="inherit" width="55%" />
    </p>
    <p className="mt-1 text-[14px]">
      <SkySkeleton shape="line" size="inherit" width="45%" />
    </p>
    <p className="mt-2 text-[13px]">
      <SkySkeleton shape="line" size="inherit" lines={2} />
    </p>
    <div className="mt-auto flex min-h-11 items-center pt-2 text-[13px]">
      <SkySkeleton shape="line" size="inherit" width="80%" />
    </div>
  </div>
);

/** "Tonight, for you" (`ForYou`): its card of rows, each a glyph, the sky line and a line under it. */
export function ForYouSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="mt-3 border border-transparent p-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`flex min-h-11 items-start gap-3 px-3 py-3 ${i > 0 ? "border-t border-transparent" : ""}`}>
          <span className="flex w-7 shrink-0 justify-center pt-0.5">
            <SkySkeleton shape="block" height={20} width={20} radius="full" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-snug">
              <SkySkeleton shape="line" size="inherit" width="70%" />
            </span>
            <span className="mt-1 block text-[14px] leading-relaxed">
              <SkySkeleton shape="line" size="inherit" width="90%" />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Tonight's wheel (280px, 300px from 400px wide) and the key line under it. */
export const WheelSkeleton = (
  <div aria-hidden className="flex flex-col items-center">
    <SkySkeleton shape="block" radius="full" height="var(--wheel)" width="var(--wheel)" className="[--wheel:280px] min-[400px]:[--wheel:300px]" />
    <p className="mt-2 text-[13px]">
      <SkySkeleton shape="line" size="inherit" width="13rem" />
    </p>
  </div>
);

/** The rest of tonight's sky (`RestOfTonight`): the Moon's card, its drawing
    and two lines, then the seven's disclosure. Earth from NASA's camera lands
    between them on a day there's a picture. */
export const RestOfTonightSkeleton = (
  <div aria-hidden className="mt-4 space-y-4">
    <div className="flex min-h-11 items-center gap-3 border border-transparent px-4 py-3">
      <SkySkeleton shape="block" height={44} width={44} radius="full" className="shrink-0" />
      <span className="min-w-0 flex-1 text-[14.5px] leading-snug">
        <SkySkeleton shape="line" size="inherit" lines={2} />
      </span>
    </div>
    <SkySkeleton shape="block" height={44} />
  </div>
);

const noChange = () => () => {};
/** Whether the browser has its own share sheet, as `ShareSheet` asks; false on
    the server, so the skeleton hydrates as it rendered. */
const useCanShare = () => useSyncExternalStore(noChange, () => typeof navigator.share === "function", () => false);

/** The share sheet (`ShareSheet`): the 9:16 card, what it says beside it (two
    lines of words, and the link, which breaks onto two), and the buttons
    under them: "Save image", "Copy link" and, where the browser can share,
    "Share…", at the buttons' widths (measured 15 Oct), so they wrap where
    the buttons do. */
export function ShareSheetSkeleton() {
  const canShare = useCanShare();
  return (
    <div aria-hidden className="pb-4">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <SkySkeleton shape="block" height={320} width={180} radius="xl" className="shrink-0" />
        <div className="w-full min-w-0">
          <p className="text-[13px]">
            <SkySkeleton shape="line" size="inherit" width="8rem" />
          </p>
          <p className="mt-2 font-display text-[22px] leading-snug">
            <SkySkeleton shape="line" size="inherit" lines={2} />
          </p>
          <p className="mt-3 text-[13px]">
            <SkySkeleton shape="line" size="inherit" lines={2} />
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SkySkeleton shape="block" height={44} width="8.875rem" radius="full" />
        <SkySkeleton shape="block" height={44} width="9.4375rem" radius="full" />
        {canShare && <SkySkeleton shape="block" height={44} width="7.25rem" radius="full" />}
        {/* The row's empty "Link copied." line, which wraps as the buttons do. */}
        <span />
      </div>
    </div>
  );
}
