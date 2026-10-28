import { NextResponse } from "next/server";
import { readAnswers } from "@/lib/answers/store";
import { runSyncChunk } from "@/lib/sync";
import { isValidUsername, decodeName } from "@/lib/username";
import { requestZone } from "@/lib/zone";

export const dynamic = "force-dynamic";
// Each poll runs one budgeted sync chunk (~8s of page pulls plus a blob flush).
export const maxDuration = 30;

/**
 * GET /api/user/:name/status
 *
 * Reports sync progress AND advances it: each call runs one budgeted chunk of
 * the backfill before responding. The client polls this until status=ready,
 * which is what makes the worker resumable across serverless invocations.
 *
 * With `?tz=`, a ready history also says whether that zone has stored answers
 * (`answersStored`), so the page shows "Checking 12 questions" only when
 * they're being computed for the first time (8.2), and not while stored ones
 * load. Without `tz`, or if the record won't read, it's `null`: not known.
 */
async function handler(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeName(name).trim();
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "Invalid username", code: "invalid-username" }, { status: 400 });
  }

  const state = await runSyncChunk(username);
  const query = new URL(req.url).searchParams;
  let answersStored: boolean | null = null;
  if (state.status === "ready" && query.get("tz")?.trim()) {
    answersStored = await readAnswers(username, requestZone(query).zone).then(
      (record) => record !== null,
      (err) => {
        console.error("[retrospect] the answers record wouldn't read for status:", err);
        return null;
      },
    );
  }
  return NextResponse.json({
    status: state.status,
    pagesDone: state.pagesDone,
    totalPages: state.totalPages,
    totalScrobbles: state.totalScrobbles,
    newestUts: state.newestUts || null,
    oldestUts: state.oldestUts ?? null,
    error: state.error ?? null,
    // A state saved before codes existed has none; "server" blames nobody.
    code: state.status === "error" ? (state.errorCode ?? "server") : null,
    answersStored,
  });
}

/** Surface real error messages instead of opaque empty 500s. The message is
    for whoever is debugging; `code` is what a visitor is told. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  try {
    return await handler(req, ctx);
  } catch (err) {
    const routeError = err instanceof Error ? err.message : String(err);
    console.error(`[retrospect] route failure:`, err);
    return NextResponse.json({ error: routeError, code: "server" }, { status: 500 });
  }
}
