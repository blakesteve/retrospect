import type { Scrobble } from "./analysis/nostalgia";

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const PAGE_SIZE = 200;

export interface RecentTracksPage {
  scrobbles: Scrobble[];
  page: number;
  totalPages: number;
  totalScrobbles: number;
}

/** Last.fm API error codes that mean "try again", not "give up". */
const TRANSIENT_API_CODES = new Set([8, 11, 16, 29]); // backend failed / offline / temporarily unavailable / rate limited

export class LastfmError extends Error {
  constructor(
    message: string,
    public code?: number,
    public status?: number
  ) {
    super(message);
    this.name = "LastfmError";
  }
  get userNotFound() {
    return this.code === 6;
  }
  /** Worth retrying: HTTP 5xx / 429, or a transient API error code. */
  get transient() {
    return (
      (this.status !== undefined && (this.status === 429 || this.status >= 500)) ||
      (this.code !== undefined && TRANSIENT_API_CODES.has(this.code))
    );
  }
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof LastfmError) return err.transient;
  // fetch() network failures (DNS blip, reset connection) surface as TypeError.
  return err instanceof TypeError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiKey(): string {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error("LASTFM_API_KEY is not set (add it to .env.local)");
  return key;
}

/**
 * Fetch one page, riding out Last.fm's notoriously flaky API: transient
 * failures (HTTP 5xx/429, "backend failed" API codes, network blips) are
 * retried with exponential backoff before giving up. Real errors (bad user,
 * bad key, private profile) throw immediately.
 */
export async function getRecentTracksPage(
  user: string,
  page: number,
  opts: { from?: number } = {}
): Promise<RecentTracksPage> {
  const ATTEMPTS = 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
    try {
      return await fetchPage(user, page, opts);
    } catch (err) {
      if (!isTransientError(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchPage(
  user: string,
  page: number,
  opts: { from?: number } = {}
): Promise<RecentTracksPage> {
  const url = new URL(API_ROOT);
  url.search = new URLSearchParams({
    method: "user.getrecenttracks",
    user,
    api_key: apiKey(),
    format: "json",
    limit: String(PAGE_SIZE),
    page: String(page),
    ...(opts.from ? { from: String(opts.from) } : {}),
  }).toString();

  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 429) throw new LastfmError("Rate limited", undefined, 429);
  if (!res.ok) throw new LastfmError(`Last.fm HTTP ${res.status}`, undefined, res.status);
  const json: any = await res.json();
  if (json.error) throw new LastfmError(json.message ?? "Last.fm error", json.error);

  const rt = json.recenttracks;
  const attr = rt["@attr"];
  const raw = Array.isArray(rt.track) ? rt.track : [rt.track].filter(Boolean);
  const scrobbles: Scrobble[] = [];
  for (const t of raw) {
    if (t["@attr"]?.nowplaying) continue; // skip the currently-playing row
    scrobbles.push({ uts: Number(t.date.uts), artist: t.artist["#text"], track: t.name });
  }
  return {
    scrobbles,
    page: Number(attr.page),
    totalPages: Number(attr.totalPages),
    totalScrobbles: Number(attr.total),
  };
}
