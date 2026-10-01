import { NextResponse } from "next/server";
import { refuseUnlessCron } from "@/lib/cronAuth";
import { expireStaleHistories } from "@/lib/expiry";
import { KEEP_DAYS } from "@/lib/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/expire: the daily expiry sweep, run by Vercel Cron
 * (`vercel.json`). A GET that deletes, which no other route here does, because
 * Vercel Cron only sends GETs; `refuseUnlessCron` keeps everyone else out.
 */
export async function GET(req: Request) {
  const refused = refuseUnlessCron(req, "expiry sweep");
  if (refused) return refused;
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
