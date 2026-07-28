"use client";

import { useEffect, useState } from "react";
import type { ListeningProfile as ProfileData } from "@/lib/profile";

const fmtHour = (h: number) => {
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${h < 12 ? "am" : "pm"}`;
};

/**
 * "What actually runs your listening" — the guaranteed payoff. Sky or no
 * sky, these are real fingerprints from real data, always interesting even
 * (especially) when every celestial trial comes back innocent.
 */
export function ListeningProfile({
  username,
  excludeNoise,
}: {
  username: string;
  excludeNoise: boolean;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ tzm: String(-new Date().getTimezoneOffset()) });
    if (excludeNoise) params.set("noise", "exclude");
    fetch(`/api/user/${encodeURIComponent(username)}/profile?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && !data.error) setProfile(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username, excludeNoise]);

  if (!profile) return null;
  const p = profile;
  const maxShare = Math.max(...p.hourShares);

  return (
    <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
      <h3 className="text-ink text-sm font-medium mb-1">
        Sky aside: what actually runs your listening
      </h3>
      <p className="text-ink-3 text-xs mb-4 max-w-xl leading-relaxed">
        The planets may plead innocent, but your habits leave fingerprints. These are
        yours, computed from every play, no horoscope required.
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        {p.archetypes.map((a) => (
          <div
            key={a.label}
            className="rounded-md bg-surface-2 border border-gold/30 p-3"
          >
            <p className="text-gold text-sm font-medium">
              {a.emoji} {a.label}
            </p>
            <p className="text-ink-3 text-xs mt-1.5 leading-relaxed">{a.why}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-center">
        <MiniTile
          label="golden hour"
          value={`${fmtHour(p.goldenHour.startHour)}–${fmtHour(p.goldenHour.endHour)}`}
          sub={`${Math.round(p.goldenHour.share * 100)}% of all plays`}
        />
        <MiniTile
          label="your day"
          value={`${p.topWeekday.day}s`}
          sub={`${Math.round(p.topWeekday.share * 100)}% of your listening`}
        />
        <MiniTile
          label="loudest month"
          value={p.topMonth.month}
          sub={`${p.topMonth.delta >= 0 ? "+" : ""}${Math.round(p.topMonth.delta * 100)}% vs average`}
        />
        <MiniTile
          label="pace"
          value={`${Math.round(p.playsPerDay)}/day`}
          sub={`best streak: ${p.longestStreakDays} days straight`}
        />
      </div>

      {/* Hour-of-day rhythm */}
      <div className="flex items-end gap-[3px] h-14" aria-label="Your listening by hour of day" role="img">
        {p.hourShares.map((share, h) => {
          const inGolden =
            p.goldenHour.endHour > p.goldenHour.startHour
              ? h >= p.goldenHour.startHour && h < p.goldenHour.endHour
              : h >= p.goldenHour.startHour || h < p.goldenHour.endHour;
          return (
            <span
              key={h}
              title={`${fmtHour(h)}: ${(share * 100).toFixed(1)}%`}
              className="flex-1 rounded-t-[3px]"
              style={{
                height: `${Math.max(4, (share / maxShare) * 100)}%`,
                background: inGolden ? "var(--accent-mark)" : "var(--series-1)",
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-ink-3 tabular mt-1">
        <span>midnight</span>
        <span>6am</span>
        <span>noon</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </div>
  );
}

function MiniTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md bg-surface-2 border border-[var(--hairline)] p-3">
      <p className="text-ink-3 text-[10px] uppercase tracking-[0.15em]">{label}</p>
      <p className="font-display text-lg text-ink mt-1">{value}</p>
      <p className="text-ink-3 text-[11px] mt-0.5">{sub}</p>
    </div>
  );
}
