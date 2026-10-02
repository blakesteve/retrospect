/**
 * What the landing's tiles show on their faces, read at build time from the
 * committed sample (spec 8.1), so a regenerated sample can't leave a tile
 * pointing at a song it no longer has. Server only: the page passes the
 * few strings it needs to the client tiles, and none of the sample's JSON
 * reaches a client chunk.
 */
import songs from "../../../public/samples/songs.json";
import answers from "../../../public/samples/answers.json";
import may2024 from "../../../public/samples/nights-2024-05.json";

/** The sample song the first tile opens (8.1's sample song, swapped 2 Oct
    2026 for a less poppy one at the same minute). */
export const SONG = { artist: "Boards of Canada", track: "Aquarius" };
/** The sample night the second tile opens (8.1: "the sample May 10, 2024 night"). */
export const WILD_NIGHT = "2024-05-10";
/** The night the hero's ring opens: the eclipse's (8.1). */
export const HERO_NIGHT = "2024-04-08";

export interface TileFacts {
  /** "Aquarius by Boards of Canada": a song and its artist read "[song] by [artist]"
      or "[artist] - [song]", never the song first with a dash (2 Oct 2026). */
  song: { id: string; name: string; chip: string | null; time: string };
  night: { date: string; chip: string | null };
  /** The sample's answer words, most common first, for the jars. */
  words: { word: string; count: number }[];
}

export function tileFacts(): TileFacts {
  const song = [...songs.row, ...songs.listed].find((s) => s.artist === SONG.artist && s.track === SONG.track);
  if (!song) throw new Error(`The sample has no ${SONG.track}: rerun the sample generator`);
  const night = may2024.nights.find((n) => n.date === WILD_NIGHT);
  if (!night) throw new Error(`The sample has no night of ${WILD_NIGHT}`);
  // "Kp 9: a G5 storm, the top of the scale" → "Solar storm, Kp 9", as the song chips say it.
  const kp = night.space.stormLine?.split(":")[0];
  const words = Object.entries(answers.tally as Record<string, number>)
    .filter(([, count]) => count > 0)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
  return {
    song: { id: song.songId, name: `${song.track} by ${song.artist}`, chip: song.highlight ?? null, time: song.firstPlayTime },
    night: { date: night.date, chip: kp && night.space.kp !== null ? `Solar storm, ${kp}` : null },
    words,
  };
}
