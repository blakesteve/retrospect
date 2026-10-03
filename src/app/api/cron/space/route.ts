import { NextResponse } from "next/server";
import { refuseUnlessCron } from "@/lib/cronAuth";
import { runSpaceWork } from "@/lib/space/work";

export const dynamic = "force-dynamic";

const SOURCES = ["donki-gst", "donki-flr", "jpl-cad", "jpl-fireball", "apod", "sdo", "epic", "epic-priority"];
/** Vercel Hobby's limit with Fluid compute, on by default (Vercel's docs,
    24 Aug 2026): a longer pass fills production sooner (architect, 2 Oct 2026). */
export const maxDuration = 300;

/**
 * GET /api/cron/space: one pass of filling and refreshing NASA's data (spec
 * 7.3), run daily by Vercel Cron (`vercel.json`). Each pass does what's most
 * needed first and starts no new fetch after 270 seconds; the next carries
 * on. If the answers route's DONKI pass is running on this instance, it
 * waits for it inside the same 270. A first fill of production takes many
 * passes (EPIC alone is a call per day since 2015); Vercel's "Run" button on
 * the cron job starts one by hand, and `/api/space/progress` shows what's
 * left.
 */
export async function GET(req: Request) {
  const refused = refuseUnlessCron(req, "space refresh");
  if (refused) return refused;
  try {
    // A unit started just before the budget ends can wait out a 20 s fetch
    // timeout, so 270 s keeps the whole pass inside the route's 300.
    const summary = await runSpaceWork({ budgetMs: 270_000, wait: true });
    if (summary.heldUntil) {
      console.log(`[retrospect] space pass skipped: another pass holds the fill until ${summary.heldUntil}`);
      return NextResponse.json(summary);
    }
    // Every source by name, so one the pass didn't reach doesn't read as nothing left.
    const left = SOURCES.map((s) => (s in summary.left ? `${s} ${summary.left[s]}` : `${s} not reached`)).join(", ");
    console.log(
      `[retrospect] space pass: ${summary.fetches} fetches, ${summary.wrote.length} months written, ` +
        `${summary.failed.length} failed, ${summary.done ? "all done" : "more to do"}, ${summary.ms} ms; left: ${left}`,
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[retrospect] space pass failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
