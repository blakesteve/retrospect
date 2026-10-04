/**
 * Sheets are URLs (spec 4, "Sheets are URLs"): one search parameter per
 * sheet, one sheet at a time.
 *
 * `history.pushState`, never `router.push`: in Next 16 a router push
 * refetches the server payload, and Next patches `pushState` so
 * `useSearchParams` follows it anyway. The app marks its own entries with a
 * depth, so closing can tell a sheet the app opened (go back) from one that
 * arrived by a deep link (replace the URL without it). Pass only the mark:
 * Next copies its own state in, and skips its sync for state that already
 * carries its `__NA` flag.
 */

export type SheetKind = "song" | "night" | "q" | "planet" | "share" | "chart";
/** `chart=you` is the Sky view's birth chart (8.6 item 5): the parameter
    names the sheet only; the birth data never leaves the browser. */
export const SHEET_KEYS: SheetKind[] = ["song", "night", "q", "planet", "share", "chart"];

export interface SheetRef {
  kind: SheetKind;
  value: string;
}

/** The key the app's own history entries carry their depth under. */
export const SHEET_MARK = "retrospectSheet";
const MARK = SHEET_MARK;

/** The sheet a URL asks for: the first sheet parameter present. */
export function sheetFrom(params: URLSearchParams): SheetRef | null {
  for (const kind of SHEET_KEYS) {
    const value = params.get(kind);
    if (value) return { kind, value };
  }
  return null;
}

/** How many sheets the app has pushed on top of the view. */
export const sheetDepth = (): number => {
  const d = (window.history.state as Record<string, unknown> | null)?.[MARK];
  return typeof d === "number" ? d : 0;
};

function urlWith(ref: SheetRef | null): string {
  const url = new URL(window.location.href);
  for (const k of SHEET_KEYS) url.searchParams.delete(k);
  if (ref) url.searchParams.set(ref.kind, ref.value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Open a sheet, or replace the open one, with a history entry of its own:
    back closes it, or returns to the sheet it was opened from. */
export function openSheet(ref: SheetRef) {
  window.history.pushState({ [MARK]: sheetDepth() + 1 }, "", urlWith(ref));
}

/** Set or drop a view's own parameters (Every night's `filter` and
    `genre`) without a history entry, keeping any sheet and its depth. */
export function replaceParams(next: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState({ [MARK]: sheetDepth() }, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Drop the sheet parameter without a history entry: a deep-linked sheet
    closing, or an invalid parameter (8.7). */
export function dropSheet() {
  window.history.replaceState({ [MARK]: 0 }, "", urlWith(null));
}

let closing = false;

/** The close button closes the whole stack and returns to the view. */
export function closeSheets() {
  const depth = sheetDepth();
  if (depth === 0) {
    dropSheet();
    return;
  }
  // The entry under the stack may itself be a deep-linked sheet: once back
  // there, drop its parameter too.
  closing = true;
  window.history.go(-depth);
}

/** Call from a `popstate` listener: finishes a close that went back past the
    app's own entries onto a deep-linked sheet. */
export function finishClose() {
  if (!closing) return;
  closing = false;
  if (sheetFrom(new URLSearchParams(window.location.search)) && sheetDepth() === 0) dropSheet();
}
