import { NextResponse } from "next/server";
import type { SongEntry } from "@/lib/listener/record";
import { guarded, loadListener } from "@/lib/listener/serve";
import { moonPhaseAt } from "@/lib/listener/skyNights";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/user/:name/songs?tz=America/Chicago: the songs the redesign shows
 * (spec 7.4, 7.5). `row` is the songs row and the Sky wheel's stars (up to
 * 12, plus the first scrobble); `listed` is "See all", the door badges and
 * the pairings (up to 50). Each song carries its genre, its first play in
 * the listener's zone, its highlight chip, its pairing sentence, the
 * questions whose condition held at its first play, and the Moon's phase
 * then.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack } = loaded;
    // A record stored before songs carried the Moon (version 2) gets her here, while it's rebuilt.
    const withMoon = (s: SongEntry) => (typeof s.moonPhase === "number" ? s : { ...s, moonPhase: moonPhaseAt(s.firstPlayUts) });
    const { row, listed, ...rest } = record.songs;
    return NextResponse.json({ status, zone, zoneFellBack, ...rest, row: row.map(withMoon), listed: listed.map(withMoon) });
  });
}
