import { NextResponse } from "next/server";
import { PROGRESS_KEY, readSpaceJson } from "@/lib/space/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/space/progress: how far the NASA fill has come, readable in a
 * browser without Vercel's dashboard (architect, 2 Oct 2026). Each full pass
 * writes what's still to fetch by source (months for DONKI, calls for JPL,
 * pages for APOD, an estimate, event moments for SDO, days for EPIC, with
 * "epic-priority" the days that come first) and its own calls, writes and
 * failures, the latest 30 newest first, and `running` while a full pass is
 * under way (it records only at its end, up to 270 seconds later). Never
 * cached (`no-store`). Counts only: nothing about anyone.
 */
export async function GET() {
  try {
    const progress = await readSpaceJson(PROGRESS_KEY);
    return NextResponse.json(progress ?? { updatedAt: null, left: {}, passes: [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "server" }, { status: 500 });
  }
}
