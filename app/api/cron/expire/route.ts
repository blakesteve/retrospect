import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { expireStaleHistories } from "@/lib/expiry";
import { KEEP_DAYS } from "@/lib/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/expire: the daily expiry sweep, run by Vercel Cron
 * (`vercel.json`).
 *
 * A GET that deletes, which no other route here does, because Vercel Cron only
 * sends GETs. So it does nothing without `Authorization: Bearer $CRON_SECRET`,
 * which Vercel adds to its own cron requests when the variable is set. A
 * crawler or a link preview gets a 401.
 *
 * With no `CRON_SECRET` it refuses everyone and says why, loudly, every day:
 * a sweep that quietly never runs is exactly how "no longer than needed"
 * became "forever" the first time.
 */
function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[retrospect] expiry sweep refused: CRON_SECRET is not set, so nothing expires.");
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await expireStaleHistories();
    console.log(
      `[retrospect] expiry sweep: ${summary.expired} of ${summary.usernames} usernames past ` +
        `${KEEP_DAYS} days removed, ${summary.revisited} kept as looked up again, ` +
        `${summary.deferred} left for tomorrow, ${summary.markersPruned} old removal markers pruned`,
    );
    return NextResponse.json({ keepDays: KEEP_DAYS, ...summary });
  } catch (err) {
    console.error("[retrospect] expiry sweep failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
