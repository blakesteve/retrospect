import type { Scrobble } from "./analysis/nostalgia";
import { isNoiseArtist } from "./noise";
import { getBlobStore } from "./store/blob";
import { userKey } from "./store/userKeys";

/*
 * The tag pipeline behind genres as facts (spec 7.6): Last.fm's top tags for
 * a listener's 200 most-played artists, and the one genre each maps to.
 * Genre facts themselves are in `src/lib/listener/genres.ts`. The genre-
 * versus-sky test, its headline and its forecast were claims with no
 * correction, and are gone (step 5).
 */

/* ------------------------------------------------------------------ */
/* Tag store: artist → Last.fm top tags, cached on disk                */
/* ------------------------------------------------------------------ */

export interface TagStore {
  /** artist (lowercased) → top tags; empty array = fetched, none found. */
  artists: Record<string, string[]>;
}

const tagKey = (u: string) => userKey("tags", u);

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
