import { emptyCompact, type DonkiCompact } from "./compact";
import { FIRST_DATES } from "./sources";
import { monthOf, monthsBetween } from "./store";

/**
 * A whole DONKI log for tests: every month from DONKI's first records through
 * `refreshedAt` is present, empty unless a Kp reading or an X flare is given
 * for it, so `nasaLogFrom` takes it as complete. Times are ISO, in UTC; each
 * goes in the month it falls in. A Kp reading is a modern one, covering the
 * 3 hours before its time.
 */
export function synthCompact(
  refreshedAt: string,
  { kp = [], xflares = [] }: { kp?: [string, number][]; xflares?: [string, string][] } = {},
): DonkiCompact {
  const c = emptyCompact();
  c.refreshedAt = refreshedAt;
  for (const m of monthsBetween(FIRST_DATES["donki-gst"].slice(0, 7), monthOf(refreshedAt))) c.kp[m] = [];
  for (const m of monthsBetween(FIRST_DATES["donki-flr"].slice(0, 7), monthOf(refreshedAt))) c.xflares[m] = [];
  for (const [t, k] of kp) (c.kp[monthOf(t)] ??= []).push([Date.parse(t) / 1000 - 3 * 3600, Date.parse(t) / 1000, k]);
  for (const [t, cls] of xflares) (c.xflares[monthOf(t)] ??= []).push([Date.parse(t) / 1000, cls]);
  return c;
}
