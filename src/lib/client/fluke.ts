/**
 * The fluke meter's fill (spec 8.9): four notches, filled from the left up
 * to the likelihood phrase, so more fill means stronger evidence. The client
 * draws it; the phrases are the answers payload's (9.1).
 */

/** The four phrases, weakest evidence first. */
export const FLUKE_PHRASES = ["Could easily be chance.", "Could be chance.", "Unlikely to be chance.", "Very unlikely to be chance."] as const;

/** The notch labels, in the same order, left to right: the phrases whole
    (9.1, "labeled in words"). Cut to "Could easily be" and "Very unlikely",
    they never said what could be, and read as a puzzle (Blake, 3 Oct 2026). */
export const FLUKE_LABELS = ["Could easily be chance", "Could be chance", "Unlikely to be chance", "Very unlikely to be chance"] as const;

/** What the meter answers, over it: the scale names its subject before its notches do. */
export const FLUKE_CAPTION = "Could it be chance? The fuller the bar, the less it looks like chance.";

/** Notches filled for a phrase: 1 for "Could easily be chance." up to 4; 0 for anything else. */
export const flukeFill = (likelihood: string) => FLUKE_PHRASES.indexOf(likelihood as (typeof FLUKE_PHRASES)[number]) + 1;
