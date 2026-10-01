import { NextResponse, after } from "next/server";
import { answersPayload, computingPayload } from "@/lib/answers/payload";
import { computeOnce, isCurrent, readAnswers } from "@/lib/answers/store";
import { emptyHistoryResponse } from "@/lib/emptyHistory";
import { getStore } from "@/lib/store/jsonStore";
import { isValidUsername } from "@/lib/username";
import { requestZone } from "@/lib/zone";

export const dynamic = "force-dynamic";
// All 12 in one pass: about 1.6 s for 500,000 plays locally, a few times
// that on production (step 0 measured 1.9 to 2.4 times local).
export const maxDuration = 60;

/**
 * GET /api/user/:name/answers?tz=America/Chicago: the 12 questions' answers
 * and every sentence the client shows (spec 7.4).
 *
 * - A stored record that's current is served as "ready".
 * - One that's behind (the history grew, the analysis changed) is served at
 *   once as "updating" and recomputed after the response (6.6).
 * - With none stored, the answers are computed now and served "ready": a
 *   first computation takes seconds, not minutes (step 0).
 * - While the history is still being read, nothing is computed: "computing",
 *   0 of 12, and the client keeps polling /status as it does today.
 */
async function handler(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "Invalid username", code: "invalid-username" }, { status: 400 });
  }
  const { zone, fellBack } = requestZone(new URL(req.url).searchParams);
  const zoneFields = { zone, zoneFellBack: fellBack };
  // Taken before the history is read: a removal that lands any time after
  // this has the answers written below taken back.
  const startedAt = Date.now();

  const [state, stored, existing] = await Promise.all([
    getStore().getSyncState(username),
    getStore().getScrobbles(username),
    readAnswers(username, zone),
  ]);
  if (stored.length === 0) return emptyHistoryResponse(username);

  if (state?.status === "syncing") {
    return existing
      ? NextResponse.json({ ...answersPayload(existing, "updating"), ...zoneFields })
      : NextResponse.json({ ...computingPayload(), ...zoneFields });
  }
  if (existing && isCurrent(existing, stored)) {
    return NextResponse.json({ ...answersPayload(existing, "ready"), ...zoneFields });
  }
  if (existing) {
    after(() => computeOnce(username, zone, stored, startedAt).then(() => undefined));
    return NextResponse.json({ ...answersPayload(existing, "updating"), ...zoneFields });
  }
  const record = await computeOnce(username, zone, stored, startedAt);
  return NextResponse.json({ ...answersPayload(record, "ready"), ...zoneFields });
}

/** Surface real error messages instead of opaque empty 500s. */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    return await handler(req, ctx);
  } catch (err) {
    const routeError = err instanceof Error ? err.message : String(err);
    console.error(`[retrospect] route failure:`, err);
    return NextResponse.json({ error: routeError, code: "server" }, { status: 500 });
  }
}
