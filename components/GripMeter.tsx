"use client";

/**
 * The plain-language replacement for "1.04×, p=0.93": how hard does the sky
 * actually grip this listener? Five cells, a label, no jargon.
 */
export function gripLevel(
  index: number,
  significant: boolean,
  suggestive = false
): { level: 0 | 1 | 2 | 3 | 4; label: string; unconfirmed: boolean } {
  if (!Number.isFinite(index)) return { level: 0, label: "No measurable grip", unconfirmed: false };
  if (!significant) {
    return suggestive
      ? { level: 1, label: "A suspicious lean (unconfirmed)", unconfirmed: true }
      : { level: 0, label: "No measurable grip", unconfirmed: false };
  }
  const pct = Math.abs(index - 1) * 100;
  if (pct < 5) return { level: 1, label: "A faint pull", unconfirmed: false };
  if (pct < 15) return { level: 2, label: "A noticeable pull", unconfirmed: false };
  if (pct < 30) return { level: 3, label: "A strong pull", unconfirmed: false };
  return { level: 4, label: "An iron grip", unconfirmed: false };
}

export function GripMeter({
  index,
  significant,
  suggestive = false,
}: {
  index: number;
  significant: boolean;
  suggestive?: boolean;
}) {
  const { level, label, unconfirmed } = gripLevel(index, significant, suggestive);
  return (
    <div className="inline-flex items-center gap-3" role="img" aria-label={`Sky grip: ${label}`}>
      <span className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-2.5 w-6 rounded-full transition-colors"
            style={{
              background:
                i <= level
                  ? unconfirmed
                    ? "var(--accent-mark)" // ochre: a lead, not a conviction
                    : "var(--gold)"
                  : "var(--surface-2)",
              boxShadow: i <= level && !unconfirmed ? "0 0 8px rgba(212,175,55,0.5)" : "none",
            }}
          />
        ))}
      </span>
      <span className="text-sm text-ink-2">{label}</span>
    </div>
  );
}
