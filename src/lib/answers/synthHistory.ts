import type { Scrobble } from "@/lib/analysis/nostalgia";
import { mulberry32 } from "@/lib/analysis/rng";

/**
 * A made-up listening history shaped like a heavy real one, seeded so every
 * run produces the same plays. Nothing here comes from a real account, and
 * nothing here depends on the sky: the null-data test (spec 6.3) and the
 * reference test use it as histories with no sky effect by construction.
 * Ported from step 0's prototype, unchanged in what it generates.
 *
 * - 1 January of `startYear` to 30 Sept 2026 (about 20.75 years from 2006), or
 * to the end of `endYear` when one is given.
 * - About 82% of days have listening; a listening day's count is lognormal
 *   (median ~67, long tail), so the total lands near `target`.
 * - Plays come in sessions of consecutive songs 2.5 to 5.5 minutes apart.
 *   Session starts favor evenings, with some daytime and after-midnight ones,
 *   in a UTC-6 local clock.
 * - Songs: ~64,000 tracks by 8,000 artists, discovered steadily across the
 *   span. Each play picks a brand-new track (8%), a recent discovery (57%) or
 *   an older one weighted toward the oldest (35%), so old favorites, first
 *   listens and replays all occur at realistic rates.
 */
export function synthHistory(target = 500_000, seed = 20260930, startYear = 2006, endYear = 2026): Scrobble[] {
  const rng = mulberry32(seed);
  const DAY = 86_400;
  const start = Date.UTC(startYear, 0, 1) / 1000;
  const end = endYear === 2026 ? Date.UTC(2026, 8, 30) / 1000 : Date.UTC(endYear, 11, 31) / 1000;
  const days = Math.floor((end - start) / DAY);
  const ARTISTS = 8_000;
  const TRACKS = 64_000;
  const activeShare = 0.82;
  const mu = Math.log(target / (days * activeShare)) - 0.18; // lognormal mean correction for sigma 0.6

  const gauss = () => {
    const u = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };

  const plays: Scrobble[] = [];
  let discovered = 200; // a starting library
  for (let d = 0; d < days; d++) {
    const frontierGoal = 200 + Math.floor(((TRACKS - 200) * d) / days);
    if (rng() > activeShare) continue;
    let n = Math.round(Math.exp(mu + 0.6 * gauss()));
    if (n > 600) n = 600;
    const dayStart = start + d * DAY;
    while (n > 0) {
      const session = Math.min(n, 4 + Math.floor(rng() * 20));
      n -= session;
      // Local hour of the session's start, then back to UTC (local = UTC-6).
      const pick = rng();
      const localHour = pick < 0.6 ? 18 + rng() * 6 : pick < 0.85 ? 9 + rng() * 9 : rng() * 4;
      let t = Math.floor(dayStart + (localHour + 6) * 3600 + rng() * 600);
      for (let k = 0; k < session; k++) {
        let track: number;
        const r = rng();
        if (r < 0.08 && discovered < TRACKS) {
          track = discovered++;
        } else if (r < 0.65) {
          const recent = Math.min(discovered, 2_000);
          track = discovered - 1 - Math.floor(rng() * recent);
        } else {
          track = Math.floor(discovered * rng() * rng());
        }
        if (discovered < frontierGoal && rng() < 0.02) discovered++;
        const artist = track % ARTISTS;
        plays.push({ uts: t, artist: `Artist ${artist}`, track: `Track ${track}` });
        t += 150 + Math.floor(rng() * 180);
      }
    }
  }
  plays.sort((a, b) => a.uts - b.uts);
  return plays;
}
