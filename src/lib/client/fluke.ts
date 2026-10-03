/**
 * The fluke meter's fill (spec 8.9): four notches, filled from the left up
 * to the likelihood phrase, so more fill means stronger evidence. The client
 * draws it; the phrases are the answers payload's (9.1).
 */

/** The four phrases, weakest evidence first. */
export const FLUKE_PHRASES = ["Could easily be chance.", "Could be chance.", "Unlikely to be chance.", "Very unlikely to be chance."] as const;

/** The notch labels, in the same order, left to right. */
export const FLUKE_LABELS = ["Could easily be", "Could be", "Unlikely", "Very unlikely"] as const;

/** Notches filled for a phrase: 1 for "Could easily be chance." up to 4; 0 for anything else. */
export const flukeFill = (likelihood: string) => FLUKE_PHRASES.indexOf(likelihood as (typeof FLUKE_PHRASES)[number]) + 1;
