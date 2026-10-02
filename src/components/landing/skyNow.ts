/**
 * The real sky right now, in the sample listener's zone (spec 8.1: "Today's
 * real sky"), fetched once per page and shared by the Tonight tile, which
 * draws it, and the Tonight sample, which reads it.
 */
import type { SkyNow } from "@/components/listener/api";
import { SAMPLE_ZONE } from "./sampleUrls";

let pending: Promise<SkyNow> | null = null;

export function loadSkyNow(): Promise<SkyNow> {
  pending ??= fetch(`/api/sky/now?tz=${encodeURIComponent(SAMPLE_ZONE)}`).then((res) => {
    if (!res.ok) throw new Error(`sky now: ${res.status}`);
    return res.json() as Promise<SkyNow>;
  });
  // A failure isn't kept: the next caller (a retry) asks again.
  pending.catch(() => (pending = null));
  return pending;
}
