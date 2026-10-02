"use client";

import { useEffect, useState } from "react";

interface ApodData {
  date: string;
  title: string;
  credit: string;
  link: string;
}

/**
 * NASA's Astronomy Picture of the Day for a given date, as words and a link,
 * never the picture: NASA's APOD source no longer says which pictures are
 * public domain, so Retrospect links to every one (architect, 1 Oct 2026).
 * A plain link rather than Roster's `Link`, which brings Font Awesome (spec
 * 12). Renders nothing when NASA has no entry for the day (14).
 */
export function Apod({ date, caption = "" }: { date: string; caption?: string }) {
  const [apod, setApod] = useState<ApodData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/apod?date=${date}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.title && data?.link) setApod(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (!apod) return null;
  return (
    <p className="text-sm leading-relaxed text-ink-2">
      {caption ? `${caption} ` : ""}NASA&rsquo;s picture of that day was{" "}
      <a href={apod.link} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4 hover:text-gold">
        &ldquo;{apod.title}&rdquo;<span className="sr-only"> (opens in a new tab)</span>
      </a>
      {apod.credit ? `, by ${apod.credit}` : ""}. The picture belongs to its creator, so we link to it.
    </p>
  );
}
