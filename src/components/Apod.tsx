"use client";

import { useEffect, useState } from "react";

interface ApodData {
  date: string;
  requestedDate: string;
  title: string;
  imageUrl: string;
  explanation: string | null;
  copyright: string | null;
}

/**
 * NASA's Astronomy Picture of the Day for a given date (or the nearest day
 * with a working picture — the server walks ±2 days past dead video
 * thumbnails). Renders nothing if NASA has nothing usable.
 */
export function Apod({ date, caption }: { date: string; caption: string }) {
  const [apod, setApod] = useState<ApodData | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/apod?date=${date}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.imageUrl) setApod(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!apod || broken) return null;
  const nearest = apod.date !== apod.requestedDate;

  return (
    <figure className="mt-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote NASA host, unoptimized on purpose */}
      <img
        src={apod.imageUrl}
        alt={apod.title}
        className="w-full rounded-md border border-[var(--hairline)]"
        loading="lazy"
        onError={() => setBroken(true)}
      />
      <figcaption className="text-ink-3 text-xs mt-2 leading-relaxed">
        {caption} NASA&rsquo;s picture of {nearest ? "that week" : "that day"}:{" "}
        &ldquo;{apod.title}&rdquo;
        {apod.copyright ? `, © ${apod.copyright}` : ""}.
        {apod.explanation && (
          <span className="block mt-1 italic">{apod.explanation}</span>
        )}
      </figcaption>
    </figure>
  );
}
