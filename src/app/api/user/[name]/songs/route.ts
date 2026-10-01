import { NextResponse } from "next/server";
import { guarded, loadListener } from "@/lib/listener/serve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/user/:name/songs?tz=America/Chicago: the songs the redesign shows
 * (spec 7.4, 7.5). `row` is the songs row and the Sky wheel's stars (up to
 * 12, plus the first scrobble); `listed` is "See all", the door badges and
 * the pairings (up to 50). Each song carries its genre, its first play in
 * the listener's zone, its highlight chip, its pairing sentence and the
 * questions whose condition held at its first play.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack } = loaded;
    return NextResponse.json({ status, zone, zoneFellBack, ...record.songs });
  });
}
