import { NextResponse } from "next/server";
import { lengthWords, strangestLine, wildLine } from "@/lib/listener/sentences";
import { guarded, loadListener } from "@/lib/listener/serve";
import { skyAt } from "@/lib/sky/sky";
import { nightName, nightWeekday } from "@/lib/zone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The wild nights row shows this many (7.5). */
const WILD_ROW = 10;

/**
 * GET /api/user/:name/highlights?tz=America/Chicago: the reveal and the wild
 * nights row (spec 7.5, 8.3). The count-ups (a count of 0 is the client's
 * to leave out), the wildest nights with their titles, the wildest night's
 * line, and the song with the strangest sky with its line. Every sentence is
 * built here; the client lays them out.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack } = loaded;
    const plays = new Map(record.nights.map(([n, p]) => [n, p]));
    const trackOf = new Map(record.songs.listed.map((s) => [s.songId, s.track]));

    const wild = record.wild.slice(0, WILD_ROW).map((w) => ({
      date: nightName(w.night),
      rank: w.rank,
      title: w.title,
      story: w.story,
      eventId: w.eventId,
    }));
    const top = record.wild[0];
    const wildest = top
      ? {
          date: nightName(top.night),
          line: wildLine(
            top.title,
            plays.get(top.night) ?? 0,
            WEEKDAYS[nightWeekday(top.night)],
            record.usual[nightWeekday(top.night)],
            (record.firstPlays[top.night] ?? []).map((id) => trackOf.get(id)).find(Boolean) ?? null,
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
    });
  });
}
