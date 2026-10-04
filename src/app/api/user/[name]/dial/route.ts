import { NextResponse } from "next/server";
import { dialMarks, dialPlays, NO_MARKS } from "@/lib/listener/dial";
import { guarded, loadListener } from "@/lib/listener/serve";
import { skyNights } from "@/lib/listener/skyNights";
import { spaceNights } from "@/lib/listener/spaceNights";
import { nightName, zoneClock } from "@/lib/zone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/user/:name/dial?tz=America/Chicago: the Sky view's dial (spec
 * 8.6, item 3), the whole history in one small answer. The history's first
 * night (as the nights route names it, null only when every play is noise),
 * tonight's night (7.1), plays per night from the first to tonight (0 for a
 * night with none, tonight's so far), the usual plays for each weekday
 * (Sunday first), and the ticks on nights you listened (`dialMarks`): storms,
 * X flares, eclipses, asteroids closer than the Moon and wild nights, each
 * at its night's place in the plays. NASA's ticks are left out when its log
 * is unavailable (8.5). The asteroids, about 1,100 nights in 20 years, are
 * offsets alone; with their names they were 20 KB of the 54 KB.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack, nasa } = loaded;
    const now = Date.now() / 1000;
    const base = {
      status,
      zone,
      zoneFellBack,
      // As the nights route says it: the log didn't read, or isn't whole yet.
      nasa: nasa ? ("ok" as const) : ("unavailable" as const),
    };
    if (record.plays === 0) {
      const tonight = zoneClock(zone, now).nightOf(now);
      return NextResponse.json({ ...base, first: null, tonight: nightName(tonight), plays: [], usual: record.usual, marks: NO_MARKS });
    }

    const clock = zoneClock(zone, record.historyStart, record.historyEnd);
    const first = clock.nightOf(record.historyStart);
    const tonight = clock.nightOf(now);
    const plays = dialPlays(record.nights, first, tonight);
    let marks = NO_MARKS;
    if (plays.length > 0) {
      // NASA's facts are read only when its log is: without it, no storm, flare or asteroid ticks.
      const space = nasa ? await spaceNights(clock, first, tonight, nasa) : null;
      marks = dialMarks(plays, first, skyNights(clock, first, tonight).eclipse, space, record.wild);
    }
    return NextResponse.json({ ...base, first: nightName(first), tonight: nightName(tonight), plays, usual: record.usual, marks });
  });
}
