import { NextResponse } from "next/server";
import { refuseUnlessCron } from "@/lib/cronAuth";
import { runSpaceWork } from "@/lib/space/work";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/space: one pass of filling and refreshing NASA's data (spec
 * 7.3), run daily by Vercel Cron (`vercel.json`). Each pass does what's most
 * needed first and starts no new fetch after 35 seconds; the next carries on.
 * If the answers route's DONKI pass is running on this instance, it waits
 * for it inside the same 35 seconds. A first fill of production takes many
 * passes (EPIC alone is a call per day since 2015); Vercel's "Run" button on
 * the cron job starts one by hand.
 */
export async function GET(req: Request) {
  const refused = refuseUnlessCron(req, "space refresh");
  if (refused) return refused;
  try {
    // A unit started just before the budget ends can wait out a 20 s fetch
    // timeout, so 35 s keeps the whole pass inside the route's 60.
    const summary = await runSpaceWork({ budgetMs: 35_000, wait: true });
    console.log(
      `[retrospect] space pass: ${summary.fetches} fetches, ${summary.wrote.length} months written, ` +
        `${summary.failed.length} failed, ${summary.done ? "all done" : "more to do"}, ${summary.ms} ms`,
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[retrospect] space pass failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
