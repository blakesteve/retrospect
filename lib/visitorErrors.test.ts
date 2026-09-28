import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VISITOR_ERROR_CODES, toVisitorErrorCode, visitorError } from "./visitorErrors";
import { LastfmError, getRecentTracksPage, syncErrorCode } from "./lastfm";

/* The error screen used to show the raw API text plus "(Is the username
   right? Is the profile public? Is LASTFM_API_KEY set?)". A missing API key
   or unconfigured storage reached a visitor as a setting's name. These pin
   that nothing a visitor can be shown carries developer text, that the
   classifier sends each failure to the right plain-English message, and that
   the old hint doesn't come back in the page source. */

/** Kinds of text that belong in a log, never on a visitor's screen. */
const DEVELOPER_TEXT: [string, RegExp][] = [
  ["an environment variable name", /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/],
  ["an env file", /\.env/],
  ["an HTTP status", /\bHTTP\b|\b[45]\d\d\b/],
  ["an API key", /api[ _]?key/i],
  ["a code identifier", /\b(undefined|null|NaN|Error|stack)\b/],
  ["a config hint", /\b(Settings|Environment Variables|redeploy|configured)\b/],
];

describe("visitor error copy", () => {
  it.each(VISITOR_ERROR_CODES)("%s says nothing a developer wrote for a developer", (code) => {
    const { title, body } = visitorError(code, "example-listener");
    for (const [what, pattern] of DEVELOPER_TEXT) {
      expect(`${title} ${body}`, `contains ${what}`).not.toMatch(pattern);
    }
  });

  it("doesn't blame the visitor for failures that aren't theirs", () => {
    expect(visitorError("server", "x").body).toMatch(/not you/);
    // Last.fm's trouble is named as Last.fm's, and says what to do.
    const lastfm = visitorError("lastfm-unavailable", "x");
    expect(`${lastfm.title} ${lastfm.body}`).toMatch(/Last\.fm/);
    expect(lastfm.body).toMatch(/Refresh/);
  });

  it("treats a missing or unknown code as ours, not theirs", () => {
    expect(toVisitorErrorCode(undefined)).toBe("server");
    expect(toVisitorErrorCode("LASTFM_API_KEY is not set")).toBe("server");
    expect(toVisitorErrorCode("private-history")).toBe("private-history");
  });
});

describe("syncErrorCode", () => {
  it.each([
    ["Last.fm's no-such-user error", new LastfmError("User not found", 6), "user-not-found"],
    ["Last.fm's login-required error, for a hidden history", new LastfmError("Login: User required to be logged in", 17), "private-history"],
    ["an invalid API key", new LastfmError("Invalid API key", 10), "server"],
    ["a suspended API key", new LastfmError("Suspended API key", 26), "server"],
    ["a missing API key", new Error("LASTFM_API_KEY is not set (add it to .env.local)"), "server"],
    ["unconfigured storage", new Error("R2 storage is not configured: missing env var(s) R2_BUCKET."), "server"],
    ["Last.fm falling over", new LastfmError("Last.fm HTTP 502", undefined, 502), "lastfm-unavailable"],
    ["a dropped connection", new TypeError("fetch failed"), "lastfm-unavailable"],
  ])("sends %s to %s", (_what, err, code) => {
    expect(syncErrorCode(err)).toBe(code);
  });

  it("carries a missing key all the way to copy that doesn't name it", () => {
    const code = syncErrorCode(new Error("LASTFM_API_KEY is not set (add it to .env.local)"));
    const { title, body } = visitorError(code, "example-listener");
    expect(`${title} ${body}`).not.toContain("LASTFM");
  });
});

describe("page source", () => {
  const root = path.resolve(__dirname, "..");
  const pageFiles = [
    ...readdirSync(path.join(root, "components")).map((f) => path.join("components", f)),
    ...["app/page.tsx", "app/layout.tsx", "app/u/[username]/page.tsx", "app/vs/[a]/[b]/page.tsx"],
  ].filter((f) => f.endsWith(".tsx"));

  it.each(pageFiles)("%s has no developer hint for visitors", (file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    expect(source).not.toContain("LASTFM_API_KEY");
    expect(source).not.toContain("Is the profile public?");
    expect(source).not.toMatch(/R2_[A-Z_]+/);
  });
});

describe("Last.fm's own error codes survive its HTTP status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** Answer every fetch the way Last.fm does: a status AND a body. A string
      body goes out as is, so it can be something that isn't JSON. */
  function lastfmReplies(status: number, body: unknown) {
    vi.stubEnv("LASTFM_API_KEY", "test-key");
    const text = typeof body === "string" ? body : JSON.stringify(body);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status })));
  }

  it("reads an unknown user as 'user-not-found', though Last.fm sends it as a 404", async () => {
    // The live API, checked 28 Sept 2026: HTTP 404, {"message":"User not found","error":6}.
    lastfmReplies(404, { message: "User not found", error: 6 });
    const err = await getRecentTracksPage("zz-no-such-user", 1).catch((e) => e);
    expect(err).toBeInstanceOf(LastfmError);
    expect(syncErrorCode(err)).toBe("user-not-found");
  });

  it("reads an error page that isn't JSON as Last.fm being down", async () => {
    // A 403 isn't retried, so this reaches the classifier without waiting.
    lastfmReplies(403, "<html>Forbidden</html>");
    const err = await getRecentTracksPage("someone", 1).catch((e) => e);
    expect(syncErrorCode(err)).toBe("lastfm-unavailable");
  });
});

