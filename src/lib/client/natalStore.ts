/**
 * Where the birth chart's inputs live: this browser's storage only (spec
 * 8.6 item 5). No astronomy here, so the Sky view can look for a saved
 * chart on its first load and fetch the math (`natal.ts`) only if there is
 * one.
 */

export const NATAL_KEY = "retrospect.natal.v1";
/** Fired on `window` when the chart is saved or cleared, so the wheel redraws its natal glyphs. */
export const NATAL_EVENT = "retrospect:natal";

export interface StoredBirth {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  offset: number; // hours east of UTC at birth place
  lat: string;
  lon: string;
}

/** The saved birth, or null: none, storage blocked, or a corrupted entry. */
export function readStoredBirth(): StoredBirth | null {
  try {
    const raw = window.localStorage.getItem(NATAL_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<StoredBirth>;
    return typeof b?.date === "string" && b.date ? (b as StoredBirth) : null;
  } catch {
    return null;
  }
}
