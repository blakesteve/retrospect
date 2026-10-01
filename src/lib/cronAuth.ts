import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Vercel Cron only sends GETs, and adds `Authorization: Bearer $CRON_SECRET`
 * to its own requests when the variable is set. So a cron route does nothing
 * without that header: a crawler or a link preview gets a 401. With no
 * `CRON_SECRET` it refuses everyone and says why, loudly: a job that quietly
 * never runs is how "no longer than needed" became "forever" the first time.
 *
 * Returns the response to send when the caller isn't the cron, or null to go on.
 */
export function refuseUnlessCron(req: Request, job: string): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error(`[retrospect] ${job} refused: CRON_SECRET is not set.`);
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
