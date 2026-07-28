import { NextResponse } from "next/server";
import { runSyncChunk } from "@/lib/sync";

export const dynamic = "force-dynamic";
// Each poll runs one budgeted sync chunk (~8s of page pulls plus a blob flush).
export const maxDuration = 30;

/**
 * GET /api/user/:name/status
 *
 * Reports sync progress AND advances it: each call runs one budgeted chunk of
 * the backfill before responding. The client polls this until status=ready,
 * which is what makes the worker resumable across serverless invocations.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  if (!/^[a-zA-Z0-9_ .-]{1,50}$/.test(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  const state = await runSyncChunk(username);
  return NextResponse.json({
    status: state.status,
    pagesDone: state.pagesDone,
    totalPages: state.totalPages,
    totalScrobbles: state.totalScrobbles,
    newestUts: state.newestUts || null,
    oldestUts: state.oldestUts ?? null,
    error: state.error ?? null,
  });
}
