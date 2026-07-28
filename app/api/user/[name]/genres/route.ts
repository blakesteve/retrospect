import { NextResponse } from "next/server";
import { analyzeGenres, readTagStore, type GenreAnalysis } from "@/lib/genres";
import { runTagChunk } from "@/lib/tagsync";
import { getStore } from "@/lib/store/jsonStore";
import { getBlobStore } from "@/lib/store/blob";
import { isNoiseArtist } from "@/lib/report";

export const dynamic = "force-dynamic";
// The genre analysis runs every genre against every phenomenon with 400
// calendar scrambles each; a 500k-play library needs ~30s cold.
export const maxDuration = 60;

/**
 * GET /api/user/:name/genres
 *
 * Advances the tag fetch one budgeted chunk per call (poll until ready, like
 * the scrobble sync), then returns the full genre × phenomenon analysis.
 * The analysis is cached per (user, newest scrobble, artists tagged).
 */
const cache = new Map<string, { key: string; analysis: GenreAnalysis }>();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();

  const scrobbles = (await getStore().getScrobbles(username)).filter(
    (s) => !isNoiseArtist(s.artist)
  );
  if (scrobbles.length === 0) {
    return NextResponse.json({ error: "No scrobbles synced yet" }, { status: 404 });
  }

  const sync = await runTagChunk(username);
  if (!sync.complete) {
    return NextResponse.json({ status: "building", done: sync.done, total: sync.total });
  }

  const newestUts = scrobbles[scrobbles.length - 1].uts;
  const cacheKey = `${newestUts}|${sync.total}`;
  const userKey = username.toLowerCase();
  const hit = cache.get(userKey);
  if (hit && hit.key === cacheKey) return NextResponse.json(hit.analysis);

  // Persistent cache: the analysis is expensive (~30s on a big library), so
  // it must survive serverless cold starts, not just this process.
  const blobKey = `cache/genres-${userKey.replace(/[^a-z0-9_-]/g, "_")}.json`;
  const persisted = await getBlobStore().get(blobKey);
  if (persisted) {
    try {
      const parsed = JSON.parse(persisted.toString("utf8"));
      if (parsed.key === cacheKey) {
        cache.set(userKey, { key: cacheKey, analysis: parsed.analysis });
        return NextResponse.json(parsed.analysis);
      }
    } catch {
      // corrupt cache: recompute
    }
  }

  const tagStore = await readTagStore(username);
  const analysis = analyzeGenres(scrobbles, tagStore);
  cache.set(userKey, { key: cacheKey, analysis });
  await getBlobStore().put(blobKey, Buffer.from(JSON.stringify({ key: cacheKey, analysis })));
  return NextResponse.json(analysis);
}
