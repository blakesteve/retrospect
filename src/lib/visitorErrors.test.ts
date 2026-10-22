import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageError from "@/app/error";
import GlobalError from "@/app/global-error";
import NotFound from "@/app/not-found";
import TryAgain from "@/components/TryAgain";
import { VISITOR_ERROR_CODES, toVisitorErrorCode, visitorError } from "./visitorErrors";
import { LastfmError, getRecentTracksPage, syncErrorCode } from "./lastfm";
import { REMOVAL_OUTCOMES, removalMessage, toRemovalOutcome } from "./removalCopy";

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

describe("removal page copy", () => {
  it.each(REMOVAL_OUTCOMES)("%s says nothing a developer wrote for a developer", (outcome) => {
    const { title, body } = removalMessage(outcome, "example-listener", "Thursday 3:40 PM");
    for (const [what, pattern] of DEVELOPER_TEXT) {
      expect(`${title} ${body}`, `contains ${what}`).not.toMatch(pattern);
    }
  });

  it("treats an answer it doesn't know as ours, not theirs", () => {
    expect(toRemovalOutcome(undefined)).toBe("server");
    expect(toRemovalOutcome("Invalid username")).toBe("server");
    expect(toRemovalOutcome("cooldown")).toBe("cooldown");
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

/** Words a visitor shouldn't meet on a page that only says something went
    wrong: the numbers' and the sky's (Retrospect's own rule, everywhere). */
const STATS_OR_SKY =
  /\b(p ?[<=]|p-values?|significan\w*|statistic\w*|correlat\w*|random\w*|odds|chance|shuffles?|planets?|stars?|sky|skies|moon|sun|retrograde|zodiac|signs?|horoscopes?|astrolog\w*|transits?|charts?|cosmic|mercury|venus|mars)\b/i;

describe("the error pages (not-found, error, global-error)", () => {
  const error = Object.assign(new Error("Cannot read properties of undefined (reading 'bodies')"), { digest: "123" });
  const pages = [
    ["not-found", renderToStaticMarkup(createElement(NotFound))],
    ["error", renderToStaticMarkup(createElement(PageError, { error, retry: () => {} }))],
    ["global-error", renderToStaticMarkup(createElement(GlobalError, { error }))],
  ] as const;
  /** What a visitor reads: the markup's text, entities as characters. */
  const words = (html: string) =>
    html
      .replace(/<title>[^<]*<\/title>/, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&rsquo;|&#8217;/g, "\u2019")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

  it.each(pages)("%s says what happened in plain English, with a way back to the start", (_name, html) => {
    const text = words(html);
    expect(text.length).toBeGreaterThan(60);
    expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Back to the start<\/a>/);
    expect(text, "a stats or sky word").not.toMatch(STATS_OR_SKY);
    for (const [what, pattern] of DEVELOPER_TEXT) expect(text, `contains ${what}`).not.toMatch(pattern);
    // Never the error's own text.
    expect(html).not.toContain("Cannot read");
  });

  it("would catch a sky word, and a page that showed the error's own text", () => {
    expect("Something in the stars went wrong.").toMatch(STATS_OR_SKY);
    expect("Your sky didn't load.").toMatch(STATS_OR_SKY);
    expect(words("<p>Cannot read properties of undefined</p>")).toMatch(DEVELOPER_TEXT.find(([w]) => w === "a code identifier")![1]);
  });

  it("holds Try again's place until Roster's button loads, and draws a whole document when the root layout fails", () => {
    // The button loads when the page draws (error.tsx), in a box its height.
    expect(pages[1][1]).toContain('<span class="block h-11"></span>');
    expect(renderToStaticMarkup(createElement(TryAgain, { onClick: () => {} }))).toMatch(/^<button[^>]*>Try again<\/button>$/);
    const doc = pages[2][1];
    // The root layout's own classes, read from it, and a title React lifts into the head.
    const layout = readFileSync(path.resolve(__dirname, "../app/layout.tsx"), "utf8");
    const [htmlClass, bodyClass] = [/<html lang="en" className="([^"]+)"/, /<body className="([^"]+)"/].map((r) => layout.match(r)![1]);
    expect(doc).toMatch(new RegExp(`^<html lang="en" class="${htmlClass}"><head><title>Something went wrong · Retrospect</title></head><body class="${bodyClass}">`));
    // No Try again: the same root layout would fail the same way.
    expect(doc).not.toContain("<button");
  });
});

describe("page source", () => {
  const root = path.resolve(__dirname, "../..");
  // Every component and every page or layout, at any depth: the redesign's
  // components live in subfolders, and a fixed list would let them escape.
  const walk = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "api" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)],
    );
  const pageFiles = [...walk("src/components"), ...walk("src/app")].filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

  it("reaches the redesign's components and pages", () => {
    expect(pageFiles).toContain(path.join("src/components/listener/Shell.tsx"));
    expect(pageFiles).toContain(path.join("src/app/u/[username]/layout.tsx"));
    expect(pageFiles).toContain(path.join("src/app/page.tsx"));
  });

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

