"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { openSheet } from "@/components/listener/sheetUrl";
import { preloadSamples } from "./SampleMount";

/* The hero (spec 8.1 item 2): Earth from DSCOVR on Apr 8, 2024, the Moon's
   shadow on it, and a ring on the shadow that opens the sample night. Since
   2 Oct 2026 it follows the username card as the example, and its caption
   says what the photo is and what the sample listener played that minute. */

/** NASA's EPIC image of that day, public domain, committed to `public/`. */
const PHOTO = "/landing/earth-2024-04-08.jpg";
/** When DSCOVR took it: 18:32:50 UTC, in the sample listener's zone. */
const PHOTO_TIME = "1:32 p.m. CDT";
/**
 * Where the shadow's dark core sits in the square photo, in percent from its
 * top left: the darkest 9 by 9 window of the committed frame (NASA EPIC,
 * epic_1b_20240408183250, 18:32:50 UTC, the umbra over Texas), measured on a
 * canvas. Another frame puts it elsewhere. The drawn fallback puts its shadow
 * here too.
 */
const SHADOW = { x: 48.1, y: 40.3 };

const RING_GLOW = { boxShadow: "0 0 14px rgba(212,175,55,.7)" };
const FADE = { maskImage: "radial-gradient(circle closest-side, #000 88%, transparent)", WebkitMaskImage: "radial-gradient(circle closest-side, #000 88%, transparent)" };

/** A night sky with a drawn Earth and the shadow on it: what shows when the
    photo can't load, so the hero never looks broken. */
function DrawnEarth() {
  const stars = [
    [8, 12, 0.9], [22, 6, 0.6], [81, 9, 0.8], [93, 22, 0.5], [6, 71, 0.6], [12, 88, 0.8],
    [88, 79, 0.7], [95, 58, 0.5], [70, 4, 0.5], [40, 3, 0.6], [3, 40, 0.5], [97, 93, 0.6],
  ];
  return (
    <svg viewBox="0 0 100 100" className="size-full" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="hero-earth" cx="40%" cy="36%" r="70%">
          <stop offset="0" stopColor="#5f8fc9" />
          <stop offset=".45" stopColor="#2c5c99" />
          <stop offset=".85" stopColor="#11305e" />
          <stop offset="1" stopColor="#0a1b3a" />
        </radialGradient>
        <radialGradient id="hero-shadow">
          <stop offset="0" stopColor="#03050c" stopOpacity=".92" />
          <stop offset=".55" stopColor="#060a18" stopOpacity=".6" />
          <stop offset="1" stopColor="#060a18" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hero-glow">
          <stop offset=".8" stopColor="#7487ea" stopOpacity=".28" />
          <stop offset="1" stopColor="#7487ea" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="#070a1c" />
      {stars.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r * 0.35} fill="#f2efe6" opacity={0.55} />
      ))}
      <circle cx="50" cy="50" r="45" fill="url(#hero-glow)" />
      <circle cx="50" cy="50" r="40" fill="url(#hero-earth)" />
      <ellipse cx="44" cy="30" rx="15" ry="3.2" fill="#e6eefa" opacity=".1" />
      <ellipse cx="60" cy="62" rx="12" ry="2.6" fill="#e6eefa" opacity=".08" />
      <ellipse cx="34" cy="68" rx="9" ry="2" fill="#e6eefa" opacity=".07" />
      <circle cx={SHADOW.x} cy={SHADOW.y} r="5.5" fill="url(#hero-shadow)" />
    </svg>
  );
}

export function Hero({ night, song }: { night: string; song: { name: string; time: string } }) {
  const [photo, setPhoto] = useState(true);
  const img = useRef<HTMLImageElement>(null);
  const ring = useRef<HTMLAnchorElement>(null);
  // The ring pings once it's on screen: below the username card it starts
  // under the fold on a phone, where pings at load would play unseen.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ring.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { threshold: 1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // An image that failed before hydration fired its error with no listener
  // attached yet: check once on mount.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setPhoto(false);
  }, []);

  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    preloadSamples();
    openSheet({ kind: "night", value: night });
  };

  return (
    <figure className="relative -mx-4 mt-10 sm:mx-0">
      {/* One-off geometry in inline styles: they cost the shared stylesheet nothing (13). */}
      {/* Space fades into the page from just outside Earth's edge (the disc
          is 88% of the frame's half-height), so the photo's black square
          never shows. */}
      <div className="relative mx-auto max-w-[560px] overflow-hidden" style={{ aspectRatio: "1 / 0.84", ...FADE }}>
        <div className="absolute inset-x-0 top-0 aspect-square" style={{ transform: "translateY(-7%)", containerType: "inline-size" }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- one committed photo, sized by CSS; next/image would add client JS to the landing
            <img
              ref={img}
              src={PHOTO}
              alt="Earth from a million miles out on Apr 8, 2024, with the Moon's dark shadow on it"
              width={1080}
              height={1080}
              fetchPriority="high"
              onError={() => setPhoto(false)}
              className="size-full object-cover"
            />
          ) : (
            <DrawnEarth />
          )}
          <a
            ref={ring}
            href={`/?night=${night}`}
            onClick={open}
            onPointerEnter={preloadSamples}
            onFocus={preloadSamples}
            onTouchStart={preloadSamples}
            className="absolute z-10 flex h-11 w-11 items-center justify-center rounded-full"
            style={{ left: `calc(${SHADOW.x}% - 22px)`, top: `calc(${SHADOW.y}% - 22px)` }}
          >
            <span aria-hidden className="absolute inset-2 rounded-full border-2 border-gold" style={RING_GLOW} />
            {/* Three pings, then still: never more than 5 seconds of motion (2.2.2), none under reduced motion. */}
            {seen && (
              <span aria-hidden className="absolute inset-2 rounded-full border-2 border-gold motion-safe:animate-ping" style={{ animationIterationCount: 3 }} />
            )}
            <span
              className="absolute left-full ml-1 w-max rounded-full border border-[var(--hairline)] bg-[rgba(7,10,28,.78)] px-2.5 py-1 text-[11.5px] leading-tight text-ink"
              // Wraps rather than running off the photo on a narrow screen.
              style={{ maxWidth: `calc(${100 - SHADOW.x}cqw - 30px)` }}
            >
              See this night<span className="sr-only">, Apr 8, 2024</span>
            </span>
          </a>
        </div>
      </div>
      <figcaption className="mx-auto max-w-[560px] px-4 text-[14.5px] leading-relaxed text-ink-2 sm:px-0">
        <span className="text-ink">Apr 8, 2024, {PHOTO_TIME}:</span>{" "}
        the Moon&rsquo;s shadow over Texas during the total eclipse, seen from a million miles out. At {song.time}, our sample
        listener first played {song.name}.
        {photo && <span className="mt-1 block text-[11px] text-ink-3">Photo: NASA EPIC team</span>}
      </figcaption>
    </figure>
  );
}
