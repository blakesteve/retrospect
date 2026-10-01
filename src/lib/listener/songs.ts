import { createHash } from "node:crypto";
import type { Scrobble } from "@/lib/analysis/nostalgia";

/**
 * Songs, and which of them the redesign shows (spec 7.5). SERVER ONLY.
 *
 * A song is today's identity key, `lowercase(artist + " " + track)`, so a
 * remaster or a "feat." version is a separate song (spec 14). Its id is a
 * stable, URL-safe hash of that key, so it survives re-syncs (spec 4).
 */

export const songKey = (artist: string, track: string) => `${artist} ${track}`.toLowerCase();

/** 11 characters of base64url SHA-256: 66 bits, no collision in any history. */
export const songIdOf = (key: string) => createHash("sha256").update(key).digest("base64url").slice(0, 11);

/** A song as a history counts it. Its id is hashed only once it's selected:
    a big history has 50,000 songs and shows 50. */
export interface SongTally {
  key: string;
  /** As the first play spelled them. */
  artist: string;
  track: string;
  plays: number;
  firstPlayUts: number;
}

export interface Song extends SongTally {
  songId: string;
}

/** Every song in a history, keyed by its identity key. `plays` must be sorted by time. */
export function songsOf(plays: Scrobble[]): Map<string, SongTally> {
  const byKey = new Map<string, SongTally>();
  for (const p of plays) {
    const key = songKey(p.artist, p.track);
    const song = byKey.get(key);
    if (song) song.plays++;
    else byKey.set(key, { key, artist: p.artist, track: p.track, plays: 1, firstPlayUts: p.uts });
  }
  return byKey;
}

/** The songs row: this many, plus the first scrobble (7.5). */
export const ROW_SONGS = 12;
/** "See all", the door badges and the pairings: this many. */
export const LISTED_SONGS = 50;
export const MIN_SONG_PLAYS = 5;
/** A song first played this soon after the history starts was probably
    already a favorite, so its first play isn't news. */
export const SETTLE_SECONDS = 90 * 86_400;

export interface SelectedSong extends Song {
  /** First played in the history's first 90 days, the first scrobble
      included: "On record since your first weeks", and its first play is
      never paired with the sky, chipped or pointed at a question. */
  early: boolean;
  /** The history's very first play. */
  firstScrobble: boolean;
}

export interface SongSelection {
  /** "Your songs' skies appear once a song has a few plays." when no song
      has 2 plays yet; the row is then just the first scrobble. */
  state: "ready" | "too-few-plays";
  /** The songs row and the Sky wheel's stars: up to 12, then the first scrobble. */
  row: SelectedSong[];
  /** "See all", door badges and pairings: up to 50, by the same rule. */
  listed: SelectedSong[];
  /** Fewer than 3 songs qualified, so the 90-day rule was dropped. */
  settleRuleDropped: boolean;
}

/**
 * Spec 7.5: the most-played songs with at least 5 plays whose first play is
 * more than 90 days after the history starts. If fewer than 3 qualify, the
 * 90-day rule is dropped and those cards are marked early. Ties go to the
 * earlier first play.
 */
export function selectSongs(songs: Map<string, SongTally>, historyStart: number): SongSelection {
  const all = [...songs.values()];
  const byPlays = (a: SongTally, b: SongTally) => b.plays - a.plays || a.firstPlayUts - b.firstPlayUts || a.key.localeCompare(b.key);
  const isEarly = (s: SongTally) => s.firstPlayUts <= historyStart + SETTLE_SECONDS;
  let pool = all.filter((s) => s.plays >= MIN_SONG_PLAYS && !isEarly(s));
  const settleRuleDropped = pool.length < 3;
  if (settleRuleDropped) pool = all.filter((s) => s.plays >= MIN_SONG_PLAYS);
  pool.sort(byPlays);

  const first = all.reduce<SongTally | null>((a, s) => (!a || s.firstPlayUts < a.firstPlayUts ? s : a), null);
  const mark = (s: SongTally): SelectedSong => ({ ...s, songId: songIdOf(s.key), early: isEarly(s), firstScrobble: s === first });
  const row = pool.slice(0, ROW_SONGS).map(mark);
  if (first && !row.some((s) => s.key === first.key)) row.push(mark(first));
  return {
    state: all.some((s) => s.plays >= 2) ? "ready" : "too-few-plays",
    row,
    listed: pool.slice(0, LISTED_SONGS).map(mark),
    settleRuleDropped,
  };
}
