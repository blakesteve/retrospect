import { NextResponse } from "next/server";
import { parsePlanetQuery, planetSheet } from "@/lib/sky/planet";
import { requestZone } from "@/lib/zone";

export const dynamic = "force-dynamic";

/** "Tonight" and "next" move with the clock, so a short cache. (Not
    exported: Next refuses unknown exports from a route file.) */
const PLANET_CACHE_CONTROL = "public, max-age=300";

/**
 * GET /api/sky/planet?body=venus&from={uts}&to={uts}&tz=America/Chicago:
 * the planet sheet (spec 8.7.4). The body tonight, its dignity in each sign,
 * its path through the history `from` to `to` (the client's first and last
 * play, clamped to the sky data's 2002 through 2035), its next station and
 * sign change, and the questions about it. Stateless: no listener record is
 * read. An unknown body, a time that isn't Unix seconds from 1970 up to
 * 2100, or `from` after `to` is a 400 with `code: "invalid"`.
 */
export function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const query = parsePlanetQuery(params);
    if ("error" in query) return NextResponse.json({ error: query.error, code: "invalid" }, { status: 400 });
    const { zone, fellBack } = requestZone(params);
    const now = Math.floor(Date.now() / 1000);
    return NextResponse.json(
      { zone, zoneFellBack: fellBack, ...planetSheet(query.body, query.from, query.to, zone, now) },
      { headers: { "Cache-Control": PLANET_CACHE_CONTROL } },
    );
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "server" }, { status: 500 });
  }
}
