/* Every night's data, a year at a time (spec 7.4, 8.5: 20 years is 7,300
   nights), kept for the visit so the calendar, a night's sheet and its
   previous and next share one request per year. A failed year is forgotten,
   so "Try again" asks afresh. */

import type { SkyFilterId } from "@/lib/client/nights";
import { getJson, type Night, type Nights, type NightsCombo } from "./api";
import type { Listener } from "./Shell";
import { tonightDate } from "./format";

export interface NightsYear {
  nights: Night[];
  meta: Nights;
}

const years = new Map<string, Promise<NightsYear>>();
const settled = new Map<string, NightsYear>();
const combos = new Map<string, Promise<NightsCombo>>();

/** Retry a route that says it's still computing, for up to a minute. */
async function ready<T extends { status?: string }>(url: string): Promise<T> {
  for (let i = 0; i < 30; i++) {
    const data = await getJson<T>(url);
    if (data.status !== "computing") return data;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("still computing");
}

/** The query a year asks with: January to December, or to tonight's month
    ("YYYY-MM"). Never the history's first month: the route starts at the
    first night itself, so a first night learned later changes no URL. */
export function yearRange(year: number, last: string): string {
  const to = `${year}-12` > last ? last : `${year}-12`;
  return `&from=${year}-01&to=${to}`;
}

/** A year's nights, fetched once. url is the listener's nights URL with the year's range. */
export function nightsYear(url: string): Promise<NightsYear> {
  let p = years.get(url);
  if (!p) {
    p = ready<Nights>(url).then((meta) => {
      const y = { nights: meta.nights ?? [], meta };
      settled.set(url, y);
      return y;
    });
    p.catch(() => years.delete(url));
    years.set(url, p);
  }
  return p;
}

/** A year already loaded, or undefined. */
export const loadedYear = (url: string) => settled.get(url);

/** One sky filter and one genre together (7.6), fetched once. */
export function nightsCombo(url: string): Promise<NightsCombo> {
  let p = combos.get(url);
  if (!p) {
    p = ready<NightsCombo>(url);
    p.catch(() => combos.delete(url));
    combos.set(url, p);
  }
  return p;
}

/** The history's first night, tonight, and the months between ("YYYY-MM"). */
export function historySpan(L: Pick<Listener, "zone" | "sync">) {
  const tonight = tonightDate(L.zone);
  const first = L.sync?.oldestUts != null ? tonightDate(L.zone, L.sync.oldestUts * 1000) : tonight;
  return { first, tonight, firstMonth: first.slice(0, 7), lastMonth: tonight.slice(0, 7) };
}

/** The nights URL for a year of the history, the same one the calendar asks with. */
export function yearUrl(L: Pick<Listener, "zone" | "sync" | "listenerUrl">, year: number): string {
  return L.listenerUrl("nights", yearRange(year, historySpan(L).lastMonth));
}

/** A night the filters on light (8.5): one you listened on, with the sky filter's condition and 3 plays of the genre. */
export const isLit = (n: Night, filter: string | null, genre: string | null) =>
  n.plays > 0 && (!filter || n.filters.includes(filter)) && (!genre || (n.genreFilters ?? []).includes(genre));

/** The sky filters, NASA's marked: a table, not the calendar's words
    (`lib/client/nights.ts`), which the sheets would each copy (13.2). */
const FROM_NASA = {
  storm: true,
  xflare: true,
  eclipse: false,
  fullmoon: false,
  newmoon: false,
  firstplay: false,
  wild: false,
  venushome: false,
  marshome: false,
  moonstrong: false,
  asteroid: true,
  fireball: true,
} as const satisfies Record<SkyFilterId, boolean>;

/** Every night's filters as the page applies them (8.5): a sky filter it
    knows, NASA's only while NASA's data loaded, and a genre listed in the
    history. Anything else in the URL lights nothing. */
export function litSelection(params: URLSearchParams, meta: Nights | null): { filter: SkyFilterId | null; genre: string | null } {
  const nasaOk = meta?.nasa !== "unavailable";
  const raw = params.get("filter");
  // One the history has nights for: a filter with none would fold every month.
  const known = raw && Object.hasOwn(FROM_NASA, raw) && (!meta?.filterCounts || (meta.filterCounts[raw] ?? 0) > 0);
  const filter = known && (nasaOk || !FROM_NASA[raw as SkyFilterId]) ? (raw as SkyFilterId) : null;
  const g = params.get("genre");
  const genre = g && (!meta?.genreCounts || (meta.genreCounts[g] ?? 0) > 0) ? g : null;
  return { filter, genre };
}

/** The URL for one sky filter and one genre together (7.6). */
export const comboUrl = (L: Pick<Listener, "listenerUrl">, filter: string, genre: string) =>
  L.listenerUrl("nights", `&filter=${filter}&genre=${encodeURIComponent(genre)}`);
