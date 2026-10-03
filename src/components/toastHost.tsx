"use client";

import { createRoot } from "react-dom/client";
import { Toaster, toast } from "@blakesteve/roster";

/* Roster's toaster, mounted on first use (see invalidLink.ts). Its own root,
   so whichever page asks needn't carry it; react-hot-toast's queue is
   module-wide, so a toast raised before the toaster draws still shows. Over
   the top of the page, clear of Every night's dock and "Surprise me". One
   at a time: a second bad link replaces the first. */

const ID = "invalid-link";
let mounted = false;

function mount() {
  if (mounted) return;
  mounted = true;
  const el = document.createElement("div");
  document.body.appendChild(el);
  createRoot(el).render(<Toaster position="top-center" />);
}

export function say(message: string) {
  mount();
  // Eight seconds, not the toaster's four: it may be the first thing a
  // shared link shows. Dismissible, as every Roster toast is by default.
  toast.warning(message, { id: ID, duration: 8000 });
}

export function clear() {
  toast.dismiss(ID);
}
