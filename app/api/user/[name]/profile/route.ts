import { NextResponse } from "next/server";
import { buildProfile, type ListeningProfile } from "@/lib/profile";
import { getStore } from "@/lib/store/jsonStore";
import { isNoiseArtist } from "@/lib/report";

export const dynamic = "force-dynamic";
// Profile taggers walk the full history a few times on a cold cache.
export const maxDuration = 60;

/** GET /api/user/:name/profile?tzm=-300&noise=exclude — sky-independent habits. */
const cache = new Map<string, { key: string; profile: ListeningProfile | null }>();

export async function GET(
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
  if (scrobbles.length === 0) {
    return NextResponse.json({ error: "No scrobbles synced yet" }, { status: 404 });
  }
  if (excludeNoise) {
    const kept = scrobbles.filter((s) => !isNoiseArtist(s.artist));
    if (kept.length > 0) scrobbles = kept;
  }

  const newest = scrobbles[scrobbles.length - 1].uts;
  const cacheKey = `${newest}|${tzm}|${excludeNoise}`;
  const userKey = username.toLowerCase();
  const hit = cache.get(userKey);
  if (hit && hit.key === cacheKey) {
    return hit.profile
      ? NextResponse.json(hit.profile)
      : NextResponse.json({ error: "not enough history" }, { status: 404 });
  }

  const profile = buildProfile(scrobbles, tzm);
  cache.set(userKey, { key: cacheKey, profile });
  return profile
    ? NextResponse.json(profile)
    : NextResponse.json({ error: "not enough history" }, { status: 404 });
}
