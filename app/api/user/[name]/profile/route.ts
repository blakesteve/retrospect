import { NextResponse } from "next/server";
import { buildProfile, PROFILE_MIN_SCROBBLES, type ListeningProfile } from "@/lib/profile";
import { getStore } from "@/lib/store/jsonStore";
import { isNoiseArtist } from "@/lib/report";
import { emptyHistoryResponse } from "@/lib/emptyHistory";

export const dynamic = "force-dynamic";
// Profile taggers walk the full history a few times on a cold cache.
export const maxDuration = 60;

/** GET /api/user/:name/profile?tzm=-300&noise=exclude — sky-independent habits. */
const cache = new Map<string, { key: string; profile: ListeningProfile | null }>();

/** Too few scrobbles for a profile. `have` and `needed` let the page say how
    far along the history is, instead of the panel silently not appearing. */
const tooFewResponse = (have: number) =>
  NextResponse.json(
    {
      error: `The profile needs at least ${PROFILE_MIN_SCROBBLES} scrobbles.`,
      have,
      needed: PROFILE_MIN_SCROBBLES,
    },
    { status: 404 },
  );

async function handler(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  const url = new URL(req.url);
  const tzRaw = Number(url.searchParams.get("tzm") ?? 0);
  const tzm = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 840 ? tzRaw : 0;
  const excludeNoise = url.searchParams.get("noise") === "exclude";

  let scrobbles = await getStore().getScrobbles(username);
  if (scrobbles.length === 0) return emptyHistoryResponse(username);
  if (excludeNoise) {
    const kept = scrobbles.filter((s) => !isNoiseArtist(s.artist));
    if (kept.length > 0) scrobbles = kept;
  }

  const newest = scrobbles[scrobbles.length - 1].uts;
  // Size and oldest play too: backfill fills in older plays under a fixed newest one.
  const cacheKey = `${scrobbles.length}|${scrobbles[0].uts}|${newest}|${tzm}|${excludeNoise}`;
  const userKey = username.toLowerCase();
  const hit = cache.get(userKey);
  if (hit && hit.key === cacheKey) {
    return hit.profile
      ? NextResponse.json(hit.profile)
      : tooFewResponse(scrobbles.length);
  }

  const profile = buildProfile(scrobbles, tzm);
  cache.set(userKey, { key: cacheKey, profile });
  return profile
    ? NextResponse.json(profile)
    : tooFewResponse(scrobbles.length);
}

/** Surface real error messages instead of opaque empty 500s. */
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
