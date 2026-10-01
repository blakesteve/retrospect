import { NextResponse } from "next/server";
import { loadListener } from "@/lib/listener/serve";
import { getStore } from "@/lib/store/jsonStore";
import { runTagChunk } from "@/lib/tagsync";
import { isValidUsername } from "@/lib/username";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/user/:name/genres?tz=America/Chicago: genres as facts about your
 * listening, never as claims about the sky (spec 7.6), in its three states:
 *
 * - "building": the history or the tags are still being read. Each call
 *   advances the tag fetch one budgeted chunk; poll until ready.
 * - "ready": `{ done, total, genres }`, at most 12, each with its plays,
 *   share, top artists, "rising" and its biggest night. None with 50 plays
 *   yet is a ready list with none in it.
 * - "failed": the tags can't be fetched (no Last.fm key here) or something
 *   broke; the client tries again on the next visit.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const username = decodeURIComponent(name).trim();
    if (!isValidUsername(username)) {
      return NextResponse.json({ error: "Invalid username", code: "invalid-username" }, { status: 400 });
    }
    if ((await getStore().getSyncState(username))?.status === "syncing") {
      return NextResponse.json({ status: "building", done: 0, total: 0, genres: [] });
    }
    const tags = await runTagChunk(username);
    if (tags.total > 0 && !tags.complete) {
      if (!process.env.LASTFM_API_KEY?.trim()) return NextResponse.json({ status: "failed", done: tags.done, total: tags.total, genres: [] });
      return NextResponse.json({ status: "building", done: tags.done, total: tags.total, genres: [] });
    }
    const loaded = await loadListener(req, name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack } = loaded;
    // Built before the tags finished, and being rebuilt after this response.
    if (record.tagged === -1) return NextResponse.json({ status: "building", done: tags.done, total: tags.total, genres: [] });
    /* A record behind only on its tags was rebuilt inside the load, so its
       genres are current; "updating" means it's behind on something else
       and its genres are still the ones from the finished tags. */
    return NextResponse.json({ status: "ready", record: status, done: tags.done, total: tags.total, zone, zoneFellBack, genres: record.genres });
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ status: "failed", done: 0, total: 0, genres: [], error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
