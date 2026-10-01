"use client";

import { useEffect, useState } from "react";
import { Link } from "@blakesteve/roster";

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
 * Renders nothing when NASA has no entry for the day.
 */
export function Apod({ date, caption }: { date: string; caption: string }) {
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
    <p className="text-ink-3 text-xs mt-4 leading-relaxed">
      {caption} NASA&rsquo;s picture of that day was{" "}
      <Link href={apod.link} underline="always" className="font-normal">
        &ldquo;{apod.title}&rdquo;
        {/* Roster opens it in a new tab behind an icon screen readers skip. */}
        <span className="sr-only"> (opens in a new tab)</span>
      </Link>
      {apod.credit ? `, by ${apod.credit}` : ""}. The picture belongs to its creator, so we link to it.
    </p>
  );
}
