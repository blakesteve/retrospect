"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether this visitor wants p-values shown. Off by default: the app reads
 * in plain English, and the p-value is for someone who knows what it means
 * and asks for it. There are no accounts, so it lives in this browser.
 *
 * Browser storage can be missing or throw (a private window, blocked site
 * data), so the choice is also kept in memory: the toggle still works for the
 * visit, it just won't be remembered.
 */

const KEY = "retrospect:show-p-values";
const CHANGED = "retrospect:p-values-changed";
let memory = false;

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    // Nothing stored: either never set, or storage refused the write.
    return stored === null ? memory : stored === "1";
  } catch {
    return memory;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function setShowPValues(on: boolean): void {
  memory = on;
  try {
    // "0" rather than removing the key, so another open tab reads "off"
    // instead of falling back to its own memory.
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Kept in memory for this visit.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The server renders with p-values off, so the page never hydrates into a
    mismatch; a visitor who turned them on sees them right after. */
export function useShowPValues(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
