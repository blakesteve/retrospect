"use client";

import { useEffect, useState } from "react";

/**
 * Album art for a track, via our /api/art proxy. Renders nothing until (and
 * unless) art actually exists — no broken-image placeholders.
 */
export function AlbumArt({
  artist,
  track,
  alt,
  className = "w-20 h-20",
}: {
  artist: string;
  track: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ artist, track });
    fetch(`/api/art?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.imageUrl) setUrl(data.imageUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artist, track]);

  if (!url) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote Last.fm CDN, unoptimized on purpose
    <img
      src={url}
      alt={alt}
      className={`${className} rounded-md border border-[var(--hairline)] object-cover shrink-0`}
      loading="lazy"
      onError={() => setUrl(null)}
    />
  );
}
