/**
 * Where the landing's samples live, and the two sheets only the landing
 * has (spec 8.1). No React and no sky data: the landing's first load
 * imports this, and so does `src/lib/samples.test.ts`.
 */

import { SHEET_KEYS, SHEET_MARK, sheetDepth } from "@/components/listener/sheetUrl";

/** Every sample says what it is (8.1). */
export const SAMPLE_LABEL = "Sample · a made-up listener, the real sky";
/** The made-up listener's name and zone, as `scripts/sample-listener.ts` generated them. */
export const SAMPLE_USER = "sample";
export const SAMPLE_ZONE = "America/Chicago";

/** The landing's H1: where focus goes when a sheet that arrived by a link closes. */
export const LANDING_HEADING = "landing-heading";

/** The files `scripts/sample-listener.ts` writes, served from `public/samples/`. */
export const SAMPLE_DIR = "/samples";

/**
 * The committed file standing in for a listener route (`Listener.listenerUrl`).
 * Nights are committed a month at a time, so a request for one month maps to
 * its file; anything else maps to a file that doesn't exist, and the sheet
 * asking for it shows its own "didn't load" or doesn't move.
 */
export function sampleFile(route: string, extra = ""): string {
  if (route === "nights") {
    const q = new URLSearchParams(extra.replace(/^&/, ""));
    const from = q.get("from");
    const month = from && from === q.get("to") && /^\d{4}-\d{2}$/.test(from) ? from : "none";
    return `${SAMPLE_DIR}/nights-${month}.json`;
  }
  return `${SAMPLE_DIR}/${route.replace(/[^a-z]/g, "")}.json`;
}

/* ---- The landing's own sheets ------------------------------------------- */

/**
 * The Tonight tile's sheet (the real sky with the sample's lines) and the
 * 12 answers tile's (the sample's questions) have no place among a
 * listener's sheets, so they get a parameter of their own, `?sample=`, and
 * the same history rules (spec 4): opening pushes an entry, back closes it,
 * a sheet opened from one of them (a question) stacks above it.
 */
export const SAMPLE_PARAM = "sample";
export type SampleSheet = "tonight" | "answers";
export const SAMPLE_SHEETS: SampleSheet[] = ["tonight", "answers"];

/** `sheetUrl.ts` marks the app's own history entries with their depth under
    this key; `sheetDepth()` reads it, and `closeSheets()` goes back that far. */
const MARK = SHEET_MARK;

function urlWithSample(value: string | null): string {
  const url = new URL(window.location.href);
  for (const k of SHEET_KEYS) url.searchParams.delete(k);
  url.searchParams.delete(SAMPLE_PARAM);
  if (value) url.searchParams.set(SAMPLE_PARAM, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Open the landing's own sheet, with a history entry like any sheet's. */
export function openSample(sheet: SampleSheet) {
  window.history.pushState({ [MARK]: sheetDepth() + 1 }, "", urlWithSample(sheet));
}

/** Drop `?sample=` without an entry: a deep-linked one closing, or an invalid one. */
export function dropSample() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SAMPLE_PARAM)) return;
  url.searchParams.delete(SAMPLE_PARAM);
  window.history.replaceState({ [MARK]: 0 }, "", `${url.pathname}${url.search}${url.hash}`);
}

/** The landing's own sheet a URL asks for, if any: the value as given. */
export const sampleFrom = (params: URLSearchParams): string | null => params.get(SAMPLE_PARAM);

/** Whether a URL asks for any sheet the landing can open. */
export function wantsSample(params: URLSearchParams): boolean {
  return params.has(SAMPLE_PARAM) || SHEET_KEYS.some((k) => params.has(k));
}
