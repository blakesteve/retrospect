import { NextResponse, after } from "next/server";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { emptyHistoryResponse } from "@/lib/emptyHistory";
import { readTagStore, topArtists, TOP_ARTISTS, type TagStore } from "@/lib/genres";
import { readNasaLog, type NasaLog } from "@/lib/space/compact";
import { refreshNasaAfter } from "@/lib/space/refresh";
import { runTagChunk } from "@/lib/tagsync";
import { getStore } from "@/lib/store/jsonStore";
import { isValidUsername } from "@/lib/username";
import { requestZone } from "@/lib/zone";
import { computeListenerOnce, isCurrentListener, readListener, type ListenerRecord } from "./record";

/**
 * What every listener route (nights, songs, highlights, genres) does first:
 * find the listener's record for the request's zone, and keep it fresh the
 * way the answers are kept (6.6).
 *
 * - A current record is served "ready".
 * - One that's behind is served at once as "updating" and recomputed after
 *   the response.
 * - With none, it's computed now.
 * - While the history is still being read, nothing is computed: an existing
 *   record is served "updating", and without one the route says "computing".
 */

export type Loaded =
  | {
      kind: "record";
      status: "ready" | "updating";
      record: ListenerRecord;
      username: string;
      zone: string;
      zoneFellBack: boolean;
      nasa: NasaLog | null;
      stored: Scrobble[];
    }
  | { kind: "response"; response: NextResponse };

/** The tag store, and a stamp that moves only when the tag fetch finishes:
    while it's still going, every poll would otherwise recompute the record. */
export function tagsStamp(stored: Scrobble[], tags: TagStore): number {
  const wanted = topArtists(stored, TOP_ARTISTS);
  const complete = wanted.every((a) => a.artist.toLowerCase() in tags.artists);
  return complete ? Object.keys(tags.artists).length : -1;
}

export async function loadListener(req: Request, name: string): Promise<Loaded> {
  const username = decodeURIComponent(name).trim();
  if (!isValidUsername(username)) {
    return { kind: "response", response: NextResponse.json({ error: "Invalid username", code: "invalid-username" }, { status: 400 }) };
  }
  const { zone, fellBack } = requestZone(new URL(req.url).searchParams);
  // Taken before the history is read: a removal after it takes the write back.
  const startedAt = Date.now();
  let nasaUnreadable = false;
  const [state, stored, existing, nasa, tags] = await Promise.all([
    getStore().getSyncState(username),
    getStore().getScrobbles(username),
    readListener(username, zone),
    readNasaLog().catch((err) => {
      console.error("[retrospect] NASA's log wouldn't read:", err);
      nasaUnreadable = true;
      return null;
    }),
    readTagStore(username),
  ]);
  if (stored.length === 0) return { kind: "response", response: await emptyHistoryResponse(username) };

  const base = { kind: "record" as const, username, zone, zoneFellBack: fellBack, nasa, stored };
  const stamp = tagsStamp(stored, tags);
  refreshNasaAfter(nasa);
  /* The tag fetch runs after the sync (7.6) in budgeted chunks; with no
     page polling /genres before phase 3, the listener routes move it on. */
  if (stamp === -1 && state?.status !== "syncing") after(() => runTagChunk(username).then(() => undefined));
  const nasaStamp = nasa?.stamp ?? (nasaUnreadable && existing ? existing.nasaStamp : null);
  if (state?.status === "syncing") {
    if (existing) return { ...base, status: "updating", record: existing };
    return { kind: "response", response: NextResponse.json({ status: "computing", zone, zoneFellBack: fellBack }) };
  }
  if (existing && isCurrentListener(existing, stored, nasaStamp, stamp)) return { ...base, status: "ready", record: existing };
  const tagsFor = { artists: stamp === -1 ? {} : tags.artists };
  /* Behind only because the tag fetch just finished: rebuild now (about
     0.3 s on 500,000 plays) rather than serve a record with no genres as
     current, which would end a client's polling on an empty list. */
  const tagsOnly = existing && existing.tagged !== stamp && isCurrentListener({ ...existing, tagged: stamp }, stored, nasaStamp, stamp);
  if (existing && !tagsOnly) {
    after(() => computeListenerOnce(username, zone, stored, startedAt, nasa, tagsFor, stamp).then(() => undefined));
    return { ...base, status: "updating", record: existing };
  }
  const record = await computeListenerOnce(username, zone, stored, startedAt, nasa, tagsFor, stamp);
  return { ...base, status: "ready", record };
}

/** Real error messages instead of opaque empty 500s, as every route does. */
export async function guarded(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "server" }, { status: 500 });
  }
}
