"use client";

import { useEffect, useState } from "react";
import type { ListeningProfile as ProfileData } from "@/lib/profile";
import { pendingHabitsSentence } from "@/lib/readiness";

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
  /* Set when the history is too small for a profile at all. Without it the
     panel just didn't appear, and a brand-new visitor had no way to know it
     was coming. */
  const [tooFew, setTooFew] = useState<{ have: number; needed: number } | null>(null);
  // Read once: whether a pending habit's start date is still ahead.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ tzm: String(-new Date().getTimezoneOffset()) });
    if (excludeNoise) params.set("noise", "exclude");
    /* Every answer replaces both, failures included, so toggling the noise
       filter can't leave the last setting's panel up under the new one. */
    const clear = () => {
      if (cancelled) return;
      setProfile(null);
      setTooFew(null);
    };
    fetch(`/api/user/${encodeURIComponent(username)}/profile?${params}`)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (cancelled) return;
        if (!data) return clear();
        const few =
          data.error && typeof data.have === "number" && typeof data.needed === "number"
            ? { have: data.have, needed: data.needed }
            : null;
        setProfile(data.error ? null : data);
        setTooFew(few);
      })
      .catch(clear);
    return () => {
      cancelled = true;
    };
  }, [username, excludeNoise]);

  if (!profile) {
    if (!tooFew) return null;
    return (
      <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
        <h3 className="text-ink text-sm font-medium mb-1">
          Sky aside: what actually runs your listening
        </h3>
        <p className="text-ink-3 text-xs max-w-xl leading-relaxed">
          Your listening fingerprints (when you listen, how much, and what you reach
          for) show up once there are {tooFew.needed.toLocaleString()} of your plays
          to read. So far there are {tooFew.have.toLocaleString()}.
        </p>
      </div>
    );
  }
  const p = profile;
  const maxShare = Math.max(...p.hourShares);
  const pending = pendingHabitsSentence(p.pending, now);

  return (
    <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
      <h3 className="text-ink text-sm font-medium mb-1">
        Sky aside: what actually runs your listening
      </h3>
      <p className="text-ink-3 text-xs mb-4 max-w-xl leading-relaxed">
        The planets may plead innocent, but your habits leave fingerprints. These are
        yours, computed from every play, no horoscope required.
      </p>

      {p.archetypes.length > 0 && (
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
      )}
      {pending && <p className="text-ink-3 text-xs mb-5 max-w-xl leading-relaxed">{pending}</p>}

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
