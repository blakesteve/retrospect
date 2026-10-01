/**
 * Everything a visitor can be told when something goes wrong, and nothing else.
 *
 * The API keeps returning its own `error` text, which is written for whoever
 * is debugging the app and can name environment variables, HTTP statuses or
 * storage settings. That text must never reach a visitor's screen. Instead
 * every error a page can show also carries a `code` from the closed set
 * below, and the page renders the plain-English copy for that code. A missing
 * or unknown code falls back to "server", which blames nobody.
 *
 * Kept free of server-only imports so the pages can use it directly.
 */

export const VISITOR_ERROR_CODES = [
  "user-not-found",
  "private-history",
  "lastfm-unavailable",
  "no-scrobbles",
  "empty-era",
  "not-synced",
  "invalid-username",
  "network",
  "server",
] as const;

export type VisitorErrorCode = (typeof VISITOR_ERROR_CODES)[number];

/** A response or sync state's `code`, trusted only if it is one of ours. */
export function toVisitorErrorCode(value: unknown): VisitorErrorCode {
  return typeof value === "string" && (VISITOR_ERROR_CODES as readonly string[]).includes(value)
    ? (value as VisitorErrorCode)
    : "server";
}

export interface VisitorError {
  title: string;
  body: string;
}

export function visitorError(code: VisitorErrorCode, username: string): VisitorError {
  switch (code) {
    case "user-not-found":
      return {
        title: "We couldn't find that listener.",
        body: `Last.fm doesn't have a user called “${username}”. Check the spelling and try again.`,
      };
    case "private-history":
      return {
        title: "This listening history is private.",
        body: `${username} keeps their listening hidden on Last.fm, so there's nothing Retrospect can read. If it's your account, you can make it visible in Last.fm's privacy settings, then come back.`,
      };
    case "lastfm-unavailable":
      return {
        title: "Last.fm isn't answering right now.",
        body: "It usually comes back quickly. Refresh in a minute; Retrospect picks up where it left off.",
      };
    case "no-scrobbles":
      return {
        title: "Nothing to read yet.",
        body: `Last.fm hasn't recorded any listening for ${username} so far. Once it has, come back and Retrospect will read it.`,
      };
    case "empty-era":
      return {
        title: "No listening in that stretch.",
        body: "There's nothing to read in those months. Try a wider stretch of time.",
      };
    case "not-synced":
      return {
        title: "Still reading.",
        body: "Retrospect hasn't finished reading this history yet. Refresh in a moment.",
      };
    case "invalid-username":
      return {
        title: "That doesn't look like a Last.fm username.",
        body: "Check the spelling and try again.",
      };
    case "network":
      // Assigned by the page, never by the API: the browser couldn't reach us.
      return {
        title: "Couldn't reach Retrospect.",
        body: "Usually a connection hiccup. Refresh to try again.",
      };
    case "server":
      return {
        title: "Something went wrong on our side.",
        body: "It's not you or your account. Try again in a little while.",
      };
  }
}

/**
 * A failed API call, as a page sees it. The code decides what a visitor
 * reads; the message is the API's own text, written for debugging, and only
 * ever goes to the console.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: VisitorErrorCode,
  ) {
    super(message);
  }
}

/** Turn a non-OK response into an ApiError, whatever its body holds. */
export async function apiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  return new ApiError(body?.error ?? `HTTP ${res.status}`, toVisitorErrorCode(body?.code));
}

/** The code for anything a page caught. A thrown fetch is the browser failing
    to reach us, not an answer from us. */
export function visitorErrorCodeOf(err: unknown): VisitorErrorCode {
  if (err instanceof ApiError) return err.code;
  return err instanceof TypeError ? "network" : "server";
}
