import { NextResponse } from "next/server";
import { oneCardPerEvent } from "@/lib/listener/highlights";
import { lengthWords, longNightDate, strangestLine, WEEKDAYS, wildLine } from "@/lib/listener/sentences";
import { guarded, loadListener } from "@/lib/listener/serve";
import { firstPhotos, surprisePool, wildCards, type CardPhoto } from "@/lib/listener/tonightCards";
import { skyAt } from "@/lib/sky/sky";
import { nightName, nightWeekday, zoneClock } from "@/lib/zone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The wild nights row shows this many (7.5). */
const WILD_ROW = 10;

/**
 * GET /api/user/:name/highlights?tz=America/Chicago: the reveal, the wild
 * nights row and the Surprise me pool (spec 7.5, 8.3, 8.4). The count-ups (a
 * count of 0 is the client's to leave out), the wildest nights as cards
 * (title, plays against the usual, date, the event's kind, the night's first
 * photo and the Moon's phase at 9 p.m.), one card per event, the wildest
 * night's date and line, the song with the strangest sky with its line, and
 * the pool: songs with a highlight chip, every wild night, and dated facts.
 * Every sentence is built here; the client lays them out.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack, nasa } = loaded;
    const plays = new Map(record.nights.map(([n, p]) => [n, p]));
    const heard = new Map(record.songs.listed.map((s) => [s.songId, `${s.track} by ${s.artist}`]));
    const clock = zoneClock(zone, record.historyStart, record.historyEnd);

    // One event, one card (7.5): a storm past 4 a.m. is one card, not two.
    const cards = oneCardPerEvent(record.wild);
    const row = cards.slice(0, WILD_ROW);
    /* A photo that won't read leaves its card to draw the sky (8.4): the
       reveal and the rest of Tonight don't fail over it. */
    const photos = await firstPhotos(clock, row.map((w) => w.night), nasa).catch(
      (err) => {
        console.error("[retrospect] wild night photos wouldn't read:", err);
        return new Map<number, CardPhoto | null>();
      },
    );
    const wild = wildCards(record, row, photos, clock);
    const top = cards[0];
    const wildest = top
      ? {
          date: nightName(top.night),
          // The card's eyebrow (8.3): "Friday, May 10, 2024".
          dateLine: longNightDate(top.night),
          line: wildLine(
            top.title,
            plays.get(top.night) ?? 0,
            WEEKDAYS[nightWeekday(top.night)],
            record.usual[nightWeekday(top.night)],
            (record.firstPlays[top.night] ?? []).map((id) => heard.get(id)).find(Boolean) ?? null,
          ),
        }
      : null;
    const song = record.strangest ? record.songs.row.find((s) => s.songId === record.strangest!.songId) ?? null : null;
    const strangest = song
      ? {
          songId: song.songId,
          score: record.strangest!.score,
          line: strangestLine(song.firstPlayTime, song.firstPlayDate, song.pairingFact, skyAt(new Date(song.firstPlayUts * 1000)), song.chip),
        }
      : null;

    return NextResponse.json({
      status,
      zone,
      zoneFellBack,
      length: lengthWords(record.historyStart, record.historyEnd),
      counts: record.counts,
      wildCount: record.wild.length,
      wild,
      wildest,
      strangest,
      surprise: surprisePool(record),
    });
  });
}
