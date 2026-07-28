import type { Scrobble } from "./analysis/nostalgia";
import { mulberry32 } from "./analysis/rng";
import { makeInWindow } from "./ephemeris/retrogrades";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "./ephemeris/phenomena";
import { isNoiseArtist } from "./report";
import { getBlobStore } from "./store/blob";

/* ------------------------------------------------------------------ */
/* Tag store: artist → Last.fm top tags, cached on disk                */
/* ------------------------------------------------------------------ */

export interface TagStore {
  /** artist (lowercased) → top tags; empty array = fetched, none found. */
  artists: Record<string, string[]>;
}

const safe = (u: string) => u.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
const tagKey = (u: string) => `tags/${safe(u)}.json`;

export async function readTagStore(username: string): Promise<TagStore> {
  const raw = await getBlobStore().get(tagKey(username));
  if (!raw) return { artists: {} };
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return { artists: {} };
  }
}

export async function writeTagStore(username: string, store: TagStore): Promise<void> {
  await getBlobStore().put(tagKey(username), Buffer.from(JSON.stringify(store)));
}

/** How many top artists we bother tagging — covers the bulk of any library. */
export const TOP_ARTISTS = 200;

/** Top artists by play count, noise excluded. */
export function topArtists(scrobbles: Scrobble[], limit = TOP_ARTISTS): { artist: string; plays: number }[] {
  const counts = new Map<string, { artist: string; plays: number }>();
  for (const s of scrobbles) {
    if (isNoiseArtist(s.artist)) continue;
    const key = s.artist.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.plays++;
    else counts.set(key, { artist: s.artist, plays: 1 });
  }
  return [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Genre from tags                                                     */
/* ------------------------------------------------------------------ */

/** Tags that are true but musically useless. */
const JUNK_TAGS = new Set([
  "seen live", "favorites", "favourites", "favorite", "favourite",
  "albums i own", "under 2000 listeners", "my music", "check out",
  "female vocalists", "male vocalists", "female vocalist", "male vocalist",
  "american", "british", "usa", "uk", "german", "swedish", "canadian",
  "australian", "french", "japanese", "norwegian", "finnish", "english",
  "all", "beautiful", "awesome", "love", "cool", "epic", "chill",
]);

export function genreOfTags(tags: string[], artist: string): string | null {
  const artistLower = artist.toLowerCase();
  for (const raw of tags) {
    const tag = raw.toLowerCase().trim();
    if (!tag || tag === artistLower || JUNK_TAGS.has(tag)) continue;
    if (/^\d+$/.test(tag)) continue; // "2007"
    return tag;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Affinity analysis: every genre × every phenomenon, one pass/rotation */
/* ------------------------------------------------------------------ */

export interface GenreAffinity {
  genre: string;
  /** Composition ratio: genre's share of in-window plays / share outside. */
  index: number;
  p: number;
  inPlays: number;
}

export interface GenreAnalysis {
  status: "ready";
  artistsTagged: number;
  /** Genres big enough to analyze, by total plays. */
  genres: { genre: string; plays: number; artists: number }[];
  /** Per phenomenon, affinities sorted by |log index|, significant first. */
  affinity: Record<PhenomenonKey, GenreAffinity[]>;
  /** Last-90-days genre momentum vs lifetime share. */
  rising: { genre: string; ratio: number; recentPlays: number }[];
  /** The single most striking significant genre × sky pair, if any. */
  headline: { body: PhenomenonKey; genre: string; index: number; p: number } | null;
}

const ROTATIONS = 400;
const MIN_GENRE_PLAYS = 1500;
const MAX_GENRES = 10;
const DAY = 86400;

export function analyzeGenres(scrobbles: Scrobble[], tagStore: TagStore): GenreAnalysis {
  // Artist → genre.
  const genreByArtist = new Map<string, string>();
  for (const [artist, tags] of Object.entries(tagStore.artists)) {
    const g = genreOfTags(tags, artist);
    if (g) genreByArtist.set(artist, g);
  }

  // Genre totals; keep the big ones.
  const totals = new Map<string, { plays: number; artists: Set<string> }>();
  for (const s of scrobbles) {
    const g = genreByArtist.get(s.artist.toLowerCase());
    if (!g) continue;
    const entry = totals.get(g) ?? { plays: 0, artists: new Set<string>() };
    entry.plays++;
    entry.artists.add(s.artist.toLowerCase());
    totals.set(g, entry);
  }
  const kept = [...totals.entries()]
    .filter(([, v]) => v.plays >= MIN_GENRE_PLAYS)
    .sort((a, b) => b[1].plays - a[1].plays)
    .slice(0, MAX_GENRES);
  const genreIds = new Map(kept.map(([g], i) => [g, i]));
  const G = kept.length;

  // Per-scrobble genre id (-1 = untracked genre) + timestamps, sorted.
  const sorted = [...scrobbles].sort((a, b) => a.uts - b.uts);
  const uts = new Float64Array(sorted.length);
  const gid = new Int8Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    uts[i] = sorted[i].uts;
    const g = genreByArtist.get(sorted[i].artist.toLowerCase());
    gid[i] = g !== undefined && genreIds.has(g) ? (genreIds.get(g)! as number) : -1;
  }
  const spanStart = uts[0];
  const spanEnd = uts[uts.length - 1];
  const spanLen = spanEnd - spanStart;

  const affinity = {} as Record<PhenomenonKey, GenreAffinity[]>;

  for (const key of PHENOMENON_KEYS) {
    const inWindow = makeInWindow(PHENOMENA[key].bounds);
    const rng = mulberry32(0xa57 + key.length);

    // One pass over all plays counts every genre simultaneously.
    const count = (offset: number) => {
      const inG = new Float64Array(G);
      let inTot = 0;
      let outTot = 0;
      const outG = new Float64Array(G);
      for (let i = 0; i < uts.length; i++) {
        const t = offset === 0
          ? uts[i]
          : spanStart + ((((uts[i] - spanStart + offset) % spanLen) + spanLen) % spanLen);
        if (inWindow(t)) {
          inTot++;
          if (gid[i] >= 0) inG[gid[i]]++;
        } else {
          outTot++;
          if (gid[i] >= 0) outG[gid[i]]++;
        }
      }
      const sim = new Float64Array(G).fill(NaN);
      if (inTot > 0 && outTot > 0) {
        for (let g = 0; g < G; g++) {
          const shareIn = inG[g] / inTot;
          const shareOut = outG[g] / outTot;
          if (shareOut > 0) sim[g] = shareIn / shareOut;
        }
      }
      return { sim, inG };
    };

    const real = count(0);
    const beats = new Float64Array(G);
    const valid = new Float64Array(G);
    for (let r = 0; r < ROTATIONS; r++) {
      const { sim } = count(Math.floor(rng() * spanLen));
      for (let g = 0; g < G; g++) {
        if (!Number.isFinite(sim[g]) || sim[g] <= 0 || !Number.isFinite(real.sim[g]) || real.sim[g] <= 0) continue;
        valid[g]++;
        if (Math.abs(Math.log(sim[g])) >= Math.abs(Math.log(real.sim[g]))) beats[g]++;
      }
    }

    affinity[key] = kept
      .map(([genre], g) => ({
        genre,
        index: real.sim[g],
        p: valid[g] > 0 ? beats[g] / valid[g] : NaN,
        inPlays: real.inG[g],
      }))
      .filter((a) => Number.isFinite(a.index) && a.inPlays >= 100)
      .sort((a, b) => {
        const sigA = a.p < 0.05 ? 1 : 0;
        const sigB = b.p < 0.05 ? 1 : 0;
        return sigB - sigA || Math.abs(Math.log(b.index)) - Math.abs(Math.log(a.index));
      });
  }

  // Rising genres: last 90 days vs lifetime composition.
  const recentStart = spanEnd - 90 * DAY;
  const recentTotals = new Map<string, number>();
  let recentN = 0;
  for (let i = uts.length - 1; i >= 0 && uts[i] >= recentStart; i--) {
    recentN++;
    if (gid[i] >= 0) {
      const g = kept[gid[i]][0];
      recentTotals.set(g, (recentTotals.get(g) ?? 0) + 1);
    }
  }
  const totalPlays = sorted.length;
  const rising = kept
    .map(([genre, v]) => {
      const lifetimeShare = v.plays / totalPlays;
      const recentPlays = recentTotals.get(genre) ?? 0;
      const recentShare = recentN > 0 ? recentPlays / recentN : 0;
      return { genre, ratio: lifetimeShare > 0 ? recentShare / lifetimeShare : 0, recentPlays };
    })
    .filter((r) => r.recentPlays >= 20)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);

  // Headline: strongest significant pair anywhere.
  let headline: GenreAnalysis["headline"] = null;
  for (const key of PHENOMENON_KEYS) {
    for (const a of affinity[key]) {
      if (a.p >= 0.05) continue;
      if (!headline || Math.abs(Math.log(a.index)) > Math.abs(Math.log(headline.index))) {
        headline = { body: key, genre: a.genre, index: a.index, p: a.p };
      }
    }
  }

  return {
    status: "ready",
    artistsTagged: Object.keys(tagStore.artists).length,
    genres: kept.map(([genre, v]) => ({ genre, plays: v.plays, artists: v.artists.size })),
    affinity,
    rising,
    headline,
  };
}
