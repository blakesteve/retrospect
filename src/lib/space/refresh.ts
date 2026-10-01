import { after } from "next/server";
import type { NasaLog } from "./compact";
import { runSpaceWork } from "./work";

const NASA_STALE_MS = 3 * 60 * 60 * 1000;
const NASA_GAP_MS = 5 * 60 * 1000;

/**
 * Keep NASA's log current without making anyone wait: after the response,
 * refresh DONKI when the log is over 3 hours old, or carry on filling it
 * while it's incomplete (7.3). One pass at a time, and one per 5 minutes,
 * per process. Every route that reads the log calls this.
 */
export function refreshNasaAfter(nasa: NasaLog | null): void {
  if (nasa && Date.now() - nasa.refreshedAt * 1000 <= NASA_STALE_MS) return;
  after(() => runSpaceWork({ budgetMs: 20_000, only: ["donki-gst", "donki-flr"], minGapMs: NASA_GAP_MS }).then(() => undefined));
}
