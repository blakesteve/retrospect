import { NextResponse } from "next/server";
import { HOUR, parsePathQuery, skyPath } from "@/lib/sky/path";

export const dynamic = "force-dynamic";

/**
 * GET /api/sky/path?to={unix seconds}: the wheel's path (spec 7.4, 8.11,
 * 18), each body's longitude from now, rounded down to the hour, to `to`,
 * rounded to the hour. `to` may be at most 45 days after now as given, so
 * every coming-up moment is in reach, even one that rounds past 45 days. `{ from, to, step: { moon:
 * 3600, others: 86400 }, bodies: { sun: [...], moon: [...], mercury, venus,
 * mars, jupiter, saturn } }`, degrees to 0.01, sample i at `from + i * step`
 * and the last at exactly `to`. A `to` that isn't a number, lies more than
 * 45 days after now, or rounds to before `from` is a 400 with `code:
 * "invalid"`.
 *
 * The body is a pure function of the two rounded hours, but the URL names
 * only `to`: `from` is the clock's. So it's cached until the hour turns and
 * no longer, when the same URL would start the path an hour later. Never
 * "immutable", which would keep serving a path from an hour long gone.
 */
export function GET(req: Request) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const query = parsePathQuery(new URL(req.url).searchParams.get("to"), now);
    if ("error" in query) return NextResponse.json({ error: query.error, code: "invalid" }, { status: 400 });
    const left = query.from + HOUR - now;
    return NextResponse.json(skyPath(query.from, query.to), {
      headers: { "Cache-Control": `public, max-age=${left}, s-maxage=${left}` },
    });
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "server" }, { status: 500 });
  }
}
