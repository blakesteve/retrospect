import { NextResponse } from "next/server";
import { getStore } from "./store/jsonStore";

/**
 * The answer for "this user has no scrobbles stored", told honestly.
 *
 * The report, profile and genre routes all used to say "No scrobbles synced
 * yet", which was false in two ways: a history too young for a trial got it
 * (that is now a report of its own), and so did an account that had synced
 * completely and simply has nothing in it. Those last two are still both
 * "nothing stored", so the sync state tells them apart: a finished sync means
 * the history is empty, a failed one carries its own reason, and anything
 * else means it hasn't been read yet.
 */
export async function emptyHistoryResponse(username: string): Promise<NextResponse> {
  const state = await getStore().getSyncState(username);
  if (state?.status === "error") {
    // A sync that failed isn't "not read yet": say why it failed.
    return NextResponse.json(
      { error: state.error ?? "The last sync failed.", code: state.errorCode ?? "server" },
      { status: 409 },
    );
  }
  if (state?.status === "ready") {
    return NextResponse.json(
      { error: "This Last.fm account has no scrobbles.", code: "no-scrobbles" },
      { status: 404 },
    );
  }
  return NextResponse.json(
    {
      error: "This history hasn't been read yet. Poll /status until it reports ready.",
      code: "not-synced",
    },
    { status: 409 },
  );
}
