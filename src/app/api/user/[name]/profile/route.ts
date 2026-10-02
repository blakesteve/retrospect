import { NextResponse } from "next/server";
import {
  buildProfile,
  profileResponse,
  PROFILE_MIN_SCROBBLES,
  type ListeningProfile,
  type ProfileTooFew,
} from "@/lib/profile";
import { getStore } from "@/lib/store/jsonStore";
import { isNoiseArtist } from "@/lib/noise";
import { emptyHistoryResponse } from "@/lib/emptyHistory";
import { requestZone } from "@/lib/zone";

export const dynamic = "force-dynamic";
// Profile taggers walk the full history a few times on a cold cache.
export const maxDuration = 60;

/**
 * GET /api/user/:name/profile?tz=America/Chicago: sky-independent habits, in
 * the listener's zone and nights (spec 7.1), with the sentence about habits
 * still waiting already written (spec 13.5). A missing or refused `tz` reads
 * the history in UTC and says so with `zoneFellBack`.
 *
 * Noise is always excluded (spec 4), as the answers and the listener record
 * exclude it, so "So far there are {have}" counts the plays the questions
 * count. `noise` is ignored: `noise=exclude` from an old page gets what it
 * asked for, and `noise=include` gets the same, since no page offers the
 * choice any more. A history that is all noise is read whole, as the answers
 * read it, rather than as nothing.
 */
const cache = new Map<string, { key: string; profile: ListeningProfile | null }>();

/** Too few plays for a profile. `have` and `needed` let the page say how far
    along the history is, instead of the panel silently not appearing. */
const tooFewResponse = (have: number) =>
  NextResponse.json(
    {
      error: `The profile needs at least ${PROFILE_MIN_SCROBBLES} scrobbles.`,
      code: "too-few-plays",
      have,
      needed: PROFILE_MIN_SCROBBLES,
    } satisfies ProfileTooFew,
    { status: 404 },
  );

async function handler(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  const { zone, fellBack } = requestZone(new URL(req.url).searchParams);

  const stored = await getStore().getScrobbles(username);
  if (stored.length === 0) return emptyHistoryResponse(username);
  const music = stored.filter((s) => !isNoiseArtist(s.artist));
  const scrobbles = music.length > 0 ? music : stored;

  const newest = scrobbles[scrobbles.length - 1].uts;
  // Size and oldest play too: backfill fills in older plays under a fixed newest one.
  const cacheKey = `${scrobbles.length}|${scrobbles[0].uts}|${newest}|${zone}`;
  const userKey = username.toLowerCase();
  const hit = cache.get(userKey);
  const profile = hit && hit.key === cacheKey ? hit.profile : buildProfile(scrobbles, zone);
  if (!hit || hit.key !== cacheKey) cache.set(userKey, { key: cacheKey, profile });

  // The sentence is written per request: whether a start date is still ahead
  // depends on today, not on when the profile was cached.
  return profile
    ? NextResponse.json(profileResponse(profile, zone, fellBack, Date.now()))
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
