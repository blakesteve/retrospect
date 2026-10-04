import { answersPayload } from "@/lib/answers/payload";
import { readAnswers } from "@/lib/answers/store";
import { phaseName } from "@/lib/client/moon";
import { moonPhaseAt } from "@/lib/listener/skyNights";
import { readListener } from "@/lib/listener/record";
import { nightDate } from "@/lib/listener/words";
import { bodiesAt, type SkyBody, type Sign } from "@/lib/sky/sky";
import { isValidUsername } from "@/lib/username";
import { ninePm, nightWeekday, zoneClock } from "@/lib/zone";
import { firstPerson, nightSays, songSays, questionSays, type CardRef } from "./card";

/**
 * What a share card shows (spec 8.7.5), from what's stored and the sky
 * alone: the listener's stored record and stored answers for the zone, read
 * and never computed (6.6). A card with nothing stored behind it (no record
 * in that zone, a removed history, a song or night it doesn't hold, an
 * unknown question) is the generic card: the username and tonight's Moon.
 * SERVER ONLY: it reads the store.
 */

export type CardData =
  | { kind: "generic"; username: string | null; moonPhase: number; moonName: string }
  | { kind: "song"; username: string; says: string; planets: { body: SkyBody; sign: Sign; retrograde: boolean }[]; moonPhase: number }
  | { kind: "night"; username: string; says: string; plays: number; usual: number | null; weekday: string; moonPhase: number; moonName: string }
  | { kind: "q"; username: string; says: string; question: string; word: string; line: string | null };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY = 86_400;

function generic(username: string | null, now: number): CardData {
  const moonPhase = moonPhaseAt(now);
  return { kind: "generic", username, moonPhase, moonName: phaseName(moonPhase) };
}

export async function cardData(rawUsername: string, ref: CardRef | null, zone: string, now = Math.floor(Date.now() / 1000)): Promise<CardData> {
  const username = rawUsername.trim();
  if (!isValidUsername(username)) return generic(null, now);
  if (!ref) return generic(username, now);

  if (ref.kind === "q") {
    const stored = await readAnswers(username, zone);
    const q = stored ? answersPayload(stored, "ready").questions.find((x) => x.id === ref.id) : undefined;
    // A stored answer that no longer measures what the question does is waiting to be checked again: no word yet.
    if (!q || q.updating) return generic(username, now);
    // Tested: how likely chance is, with the correction when it decides the word. Otherwise why there's no
    // word yet, short, since the word already says it (9.2).
    const line = q.status === "tested" ? q.phrases.chance : firstPerson(q.phrases.tonightLine);
    return { kind: "q", username, says: questionSays(q.question, q.word), question: firstPerson(q.question), word: q.word, line };
  }

  const record = await readListener(username, zone);
  if (!record) return generic(username, now);

  if (ref.kind === "song") {
    const song = [...record.songs.row, ...record.songs.listed].find((s) => s.songId === ref.id);
    if (!song) return generic(username, now);
    const planets = bodiesAt(new Date(song.firstPlayUts * 1000)).map((b) => ({ body: b.body, sign: b.sign, retrograde: b.retrograde }));
    return { kind: "song", username, says: songSays(song), planets, moonPhase: song.moonPhase ?? moonPhaseAt(song.firstPlayUts) };
  }

  const night = Math.round(Date.parse(`${ref.date}T00:00:00Z`) / 1000 / DAY);
  const entry = record.nights.find((n) => n[0] === night);
  // A night it doesn't hold isn't a card (8.7). It holds only nights with music.
  if (!entry) return generic(username, now);
  const wild = record.wild.find((w) => w.night === night) ?? null;
  const clock = zoneClock(zone, (night - 1) * DAY, (night + 2) * DAY);
  const moonPhase = moonPhaseAt(ninePm(clock, night));
  const weekday = nightWeekday(night);
  return {
    kind: "night",
    username,
    says: nightSays(nightDate(ref.date), wild?.title ?? null),
    plays: entry[1],
    usual: record.usual[weekday] ?? null,
    weekday: WEEKDAYS[weekday],
    moonPhase,
    moonName: phaseName(moonPhase),
  };
}
