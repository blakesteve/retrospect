"use client";

import { Children, forwardRef, type ReactNode } from "react";
import { Carousel, type CarouselHandle, type CarouselPerView } from "@blakesteve/roster";
import { RowHead } from "./pieces";

/* Every sideways row is a Roster `Carousel` (spec 10, 12): a mouse drags it,
   the arrows page it, the next card always peeks. Fluid, sized by cards per
   view so the peek holds at every width (10). */

/** Songs, coming up, genres and pairings: about 1.45 a view under 640px, 2.6 from 640px. */
export const CARDS_PER_VIEW: CarouselPerView = { base: 1.45, sm: 2.6 };
/** Wild nights' larger cards: about 1.25 and 2.3. */
export const WILD_PER_VIEW: CarouselPerView = { base: 1.25, sm: 2.3 };

/** The page's side gutter, so a snapped card lines up with the text above it. */
const GUTTER = 16;

export interface RailProps {
  /** The row's name for its list ("Songs"), and the arrows' noun ("Next songs"). */
  label: string;
  noun: string;
  perView?: CarouselPerView;
  /** The heading line the arrows join. Without one, the arrows sit on their own line. */
  head?: (arrows: ReactNode) => ReactNode;
  children: ReactNode;
  className?: string;
  /** One per view, with "2 of 5" (a gallery). */
  gallery?: boolean;
  /** The container's own side padding: the page's 16px, or a sheet's. */
  gutter?: number;
}

/** The arrows' place in a row's heading line, where any pointer can hover
    and so a row that overflows shows them (`Rail`'s arrows): their box, two
    44px buttons 8px apart, so a long title wraps (or doesn't) as it will
    beside them; it held their height alone, and "Coming up in your sky" and
    "The sky of your songs" took a second line when the row came, at 375px.
    A row too short to page keeps it too, as its skeleton does. */
const ArrowsSpace = () => <span aria-hidden className="hidden h-11 w-24 [@media(any-hover:hover)]:block" />;

/** A row of cards with its arrows in the heading line (10, 11). */
export const Rail = forwardRef<CarouselHandle, RailProps>(function Rail({ label, noun, perView = CARDS_PER_VIEW, head, children, className = "", gallery = false, gutter = GUTTER }, ref) {
  return (
    <Carousel
      ref={ref}
      aria-label={label}
      perView={gallery ? 1 : perView}
      gap={12}
      gutter={gutter}
      bleed
      oneAtATime={gallery}
      showPosition={gallery && Children.count(children) > 1}
      prevLabel={`Previous ${noun}`}
      nextLabel={`Next ${noun}`}
      className={className}
      listClassName="pb-3"
      renderArrows={
        head
          ? ({ prev, next, position }) => (
              <div className="mb-2">
                {head(
                  prev || next || position ? (
                    <>
                      {position}
                      {prev}
                      {next}
                    </>
                  ) : (
                    <ArrowsSpace />
                  ),
                )}
              </div>
            )
          : undefined
      }
    >
      {children}
    </Carousel>
  );
});

/** A titled row whose body is a `Rail`, or a line in its place (a state). */
export function RailRow({
  id,
  title,
  level = 2,
  sub,
  action,
  rail,
  loading,
  children,
}: {
  id: string;
  title: ReactNode;
  level?: 2 | 3;
  sub?: ReactNode;
  /** "See all", beside the arrows. */
  action?: ReactNode;
  /** The row's cards. Absent while the row shows a state instead (`children`). */
  rail?: Omit<RailProps, "head">;
  /** Still loading: the heading, holding its arrows' place, or the box of
      the action it will have (`hold`), over skeleton cards on the row's own
      carousel. */
  loading?: { skeleton: ReactNode; hold?: ReactNode };
  children?: ReactNode;
}) {
  const head = (arrows: ReactNode) => (
    <RowHead
      id={id}
      title={title}
      level={level}
      sub={sub}
      action={
        action || arrows ? (
          <>
            {action}
            {arrows}
          </>
        ) : undefined
      }
    />
  );
  return (
    <section aria-labelledby={`${id}-h`} aria-busy={loading ? true : undefined} className="mt-10">
      {rail ? (
        <Rail {...rail} head={head} />
      ) : loading ? (
        <>
          {/* As `Rail` lays its heading out: the arrows' line, then the cards. */}
          <div className="mb-2">
            {head(
              loading.hold ? (
                <>
                  <span aria-hidden>{loading.hold}</span>
                  <ArrowsSpace />
                </>
              ) : (
                <ArrowsSpace />
              ),
            )}
          </div>
          {loading.skeleton}
        </>
      ) : (
        <>
          {head(null)}
          <div className="mt-3">{children}</div>
        </>
      )}
    </section>
  );
}
