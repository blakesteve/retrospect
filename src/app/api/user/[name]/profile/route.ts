import { NextResponse } from "next/server";
import { buildProfile, PROFILE_MIN_SCROBBLES, type ListeningProfile, type ProfileResponse } from "@/lib/profile";
import { getStore } from "@/lib/store/jsonStore";
import { isNoiseArtist } from "@/lib/report";
import { emptyHistoryResponse } from "@/lib/emptyHistory";
import { requestZone } from "@/lib/zone";

export const dynamic = "force-dynamic";
// Profile taggers walk the full history a few times on a cold cache.
export const maxDuration = 60;

/**
 * GET /api/user/:name/profile?tz=America/Chicago&noise=exclude: sky-independent
 * habits, in the listener's zone and nights (spec 7.1). A missing or refused
 * `tz` reads the history in UTC and says so with `zoneFellBack`.
 */
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
  const { zone, fellBack } = requestZone(url.searchParams);
  const excludeNoise = url.searchParams.get("noise") === "exclude";

  let scrobbles = await getStore().getScrobbles(username);
  if (scrobbles.length === 0) return emptyHistoryResponse(username);
  if (excludeNoise) {
    const kept = scrobbles.filter((s) => !isNoiseArtist(s.artist));
    if (kept.length > 0) scrobbles = kept;
  }

  const newest = scrobbles[scrobbles.length - 1].uts;
  // Size and oldest play too: backfill fills in older plays under a fixed newest one.
  const cacheKey = `${scrobbles.length}|${scrobbles[0].uts}|${newest}|${zone}|${excludeNoise}`;
  const userKey = username.toLowerCase();
  const hit = cache.get(userKey);
  if (hit && hit.key === cacheKey) {
    return hit.profile
      ? NextResponse.json(withZone(hit.profile, zone, fellBack))
      : tooFewResponse(scrobbles.length);
  }

  const profile = buildProfile(scrobbles, zone);
  cache.set(userKey, { key: cacheKey, profile });
  return profile
    ? NextResponse.json(withZone(profile, zone, fellBack))
    : tooFewResponse(scrobbles.length);
}

const withZone = (profile: ListeningProfile, zone: string, zoneFellBack: boolean): ProfileResponse => ({
  ...profile,
  zone,
  zoneFellBack,
});

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
