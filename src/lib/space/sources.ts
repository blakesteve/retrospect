import type { Approach, ApodDay, EpicDay, Fireball, Flare, SdoDay, SpaceSource, Storm } from "./store";

/**
 * Fetching each source NASA or JPL publishes (spec 7.3, corrected 1 Oct 2026).
 * None needs a key. Every fetch has a timeout and throws on a failed reply,
 * so a refresh that fails keeps serving what's stored. A row that won't read
 * is left out and logged, never thrown: one bad row would otherwise stop a
 * source's backfill at that month for good.
 *
 * - DONKI moved on 30 Sept 2026 to `ccmc.gsfc.nasa.gov/DONKI-API/get/...`
 *   (same parameters and JSON); api.nasa.gov's copy now redirects to the
 *   announcement. It refuses a range over 60 days, so it's read by month,
 *   and it limits how fast it's asked (below).
 * - APOD moved to science.nasa.gov's `apod-basic`. Its `copyright` repeats
 *   `credit`, so it can't say which pictures are public domain: Retrospect
 *   never shows the picture, only the title, the credit and a link.
 */

const DONKI = "https://ccmc.gsfc.nasa.gov/DONKI-API/get";
const JPL = "https://ssd-api.jpl.nasa.gov";
const EPIC = "https://epic.gsfc.nasa.gov";
const SDO = "https://sdo.gsfc.nasa.gov/assets/img/browse";
const APOD = "https://science.nasa.gov/wp-json/wp/v2/apod-basic";

/** Each source's documented first date (spec 7.3): before it, a night is
    "unknown", never "none". DONKI's are its first records, and SDO's is the
    first day its browse-image archive serves: every day before 2016 is a
    404, though SDO itself flew from 2010 (both checked 1 Oct 2026). */
export const FIRST_DATES: Record<SpaceSource, string> = {
  "donki-gst": "2010-04-05",
  "donki-flr": "2010-04-03",
  "jpl-cad": "1900-01-01",
  "jpl-fireball": "1988-04-15",
  epic: "2015-06-13",
  sdo: "2016-01-01",
  apod: "1995-06-16",
};

/** Where the backfill starts: the source's first month, or January 2002,
    the month before Last.fm's first scrobbles, whichever is later. */
export const BACKFILL_FROM: Record<SpaceSource, string> = Object.fromEntries(
  Object.entries(FIRST_DATES).map(([s, d]) => [s, d.slice(0, 7) < "2002-01" ? "2002-01" : d.slice(0, 7)]),
) as Record<SpaceSource, string>;

const TIMEOUT_MS = 20_000;

/* CCMC's DONKI answers 429 once its allowance runs out: about 100 calls,
   refilled at about 1.4 a second (measured 1 Oct 2026 from its
   x-rate-limit-remaining header), and other callers may share it. So a pass
   stops asking with a few left, and the next carries on once it's refilled.
   The refill is counted a little under what was measured, to stay clear. */
const DONKI_RESERVE = 10;
const DONKI_REFILL_PER_S = 1.2;
let donkiLeft: { remaining: number; at: number } | null = null;

export class RateLimited extends Error {}

/** A reply that wasn't OK, with its status: a 404 is "none", not a failure. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Test hook: forget what DONKI last said about its allowance. */
export function resetDonkiAllowance(): void {
  donkiLeft = null;
}

async function getText(url: string): Promise<string> {
  const { host, pathname } = new URL(url);
  const donki = url.startsWith(DONKI);
  if (donki && donkiLeft) {
    const now = donkiLeft.remaining + ((Date.now() - donkiLeft.at) / 1000) * DONKI_REFILL_PER_S;
    if (now <= DONKI_RESERVE) throw new RateLimited(`DONKI's rate limit: waiting for it to refill`);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (donki) {
    const header = res.headers.get("x-rate-limit-remaining");
    const left = res.status === 429 ? 0 : header === null ? NaN : Number(header);
    donkiLeft = Number.isFinite(left) ? { remaining: left, at: Date.now() } : null;
  }
  if (res.status === 429) throw new RateLimited(`429 from ${host}${pathname}`);
  if (!res.ok) throw new HttpError(res.status, `${res.status} from ${host}${pathname}`);
  return res.text();
}

const notFound = (err: unknown) => err instanceof HttpError && err.status === 404;

/** Each row through `read`, leaving out (and logging) any that won't read. */
function readRows<T, R>(source: string, rows: T[] | null | undefined, read: (row: T) => R | null): R[] {
  const out: R[] = [];
  let bad = 0;
  for (const row of rows ?? []) {
    try {
      const r = read(row);
      if (r === null) bad++;
      else out.push(r);
    } catch {
      bad++;
    }
  }
  if (bad > 0) console.warn(`[retrospect] ${source}: left out ${bad} row(s) that wouldn't read`);
  return out;
}

async function getJson<T>(url: string): Promise<T> {
  const text = await getText(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`not JSON from ${new URL(url).host}${new URL(url).pathname}`);
  }
}

/** "2024-05-10T15:00Z" and "2024-05-10 15:00:00" as ISO with seconds. */
function iso(t: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
  if (!m) throw new Error(`unreadable time ${JSON.stringify(t)}`);
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`;
}

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/* ---- DONKI ---------------------------------------------------------------- */

interface DonkiStorm {
  gstID: string;
  startTime: string;
  allKpIndex?: { observedTime: string; kpIndex: number }[] | null;
}

export async function fetchStorms(month: string): Promise<Storm[]> {
  const rows = await getJson<DonkiStorm[] | null>(`${DONKI}/GST?startDate=${month}-01&endDate=${lastDay(month)}`);
  return readRows(`DONKI storms ${month}`, rows, (g) => ({
    id: g.gstID,
    start: iso(g.startTime),
    readings: readRows(`DONKI storm ${g.gstID}`, g.allKpIndex, (k) =>
      Number.isFinite(k.kpIndex) ? { time: iso(k.observedTime), kp: k.kpIndex } : null,
    ),
  }));
}

interface DonkiFlare {
  flrID: string;
  beginTime: string;
  peakTime: string | null;
  classType: string | null;
}

export async function fetchFlares(month: string): Promise<Flare[]> {
  const rows = await getJson<DonkiFlare[] | null>(`${DONKI}/FLR?startDate=${month}-01&endDate=${lastDay(month)}`);
  // A flare without a class is one DONKI hasn't graded: nothing to keep.
  return readRows(`DONKI flares ${month}`, (rows ?? []).filter((f) => f.classType), (f) => ({
    id: f.flrID,
    peak: iso(f.peakTime ?? f.beginTime),
    class: f.classType!,
  }));
}

/* ---- JPL ------------------------------------------------------------------ */

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/* JPL reads a bare date-max as that day's 00:00, so it would leave the last
   day out (checked 1 Oct 2026: Jun 29, 2024 to Jun 29 finds nothing, to
   23:59:59 finds 2024 MK). Both dates here are inclusive. */
const jplRange = (from: string, to: string) => `date-min=${from}&date-max=${to}T23:59:59`;

/** Close approaches within 0.05 AU from one date to another (YYYY-MM-DD, inclusive). */
export async function fetchApproaches(from: string, to: string): Promise<Approach[]> {
  const res = await getJson<{ fields: string[]; data?: (string | null)[][] }>(
    `${JPL}/cad.api?${jplRange(from, to)}&dist-max=0.05`,
  );
  const at = (name: string) => res.fields.indexOf(name);
  return readRows("JPL close approaches", res.data, (r) => {
    // "2024-Jun-29 13:49"
    const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2})$/.exec(r[at("cd")] ?? "");
    const dist = r[at("dist")];
    // Number(null) is 0: a missing distance would read as a direct hit.
    const au = dist === null || dist === undefined || dist === "" ? NaN : Number(dist);
    if (!m || !MONTHS[m[2]] || !Number.isFinite(au)) return null;
    const h = r[at("h")];
    return {
      name: (r[at("des")] ?? "").trim(),
      time: `${m[1]}-${MONTHS[m[2]]}-${m[3]}T${m[4]}:00Z`,
      au,
      h: h === null || h === undefined ? null : Number(h),
    };
  });
}

/** Fireballs from one date to another (YYYY-MM-DD, inclusive). */
export async function fetchFireballs(from: string, to: string): Promise<Fireball[]> {
  const res = await getJson<{ fields: string[]; data?: (string | null)[][] }>(`${JPL}/fireball.api?${jplRange(from, to)}`);
  const at = (name: string) => res.fields.indexOf(name);
  return readRows("JPL fireballs", res.data, (r) => ({
    time: iso(r[at("date")] ?? ""),
    kt: r[at("impact-e")] === null ? null : Number(r[at("impact-e")]),
  }));
}

/* ---- EPIC ----------------------------------------------------------------- */

export async function fetchEpicDates(): Promise<string[]> {
  return getJson<string[]>(`${EPIC}/api/natural/available`);
}

/** One day's photos of Earth; a day EPIC has none for is an empty day. */
export async function fetchEpicDay(date: string): Promise<EpicDay> {
  try {
    const rows = await getJson<{ image: string; date: string; centroid_coordinates?: { lat: number; lon: number } }[]>(
      `${EPIC}/api/natural/date/${date}`,
    );
    return {
      date,
      images: readRows(`EPIC ${date}`, rows, (r) =>
        r.centroid_coordinates && typeof r.image === "string"
          ? { name: r.image, time: iso(r.date), lat: r.centroid_coordinates.lat, lon: r.centroid_coordinates.lon }
          : null,
      ),
    };
  } catch (err) {
    if (notFound(err)) return { date, images: [] };
    throw err;
  }
}

/* ---- SDO ------------------------------------------------------------------ */

/** The day's AIA 171 browse image nearest `at` (an ISO time on that day), or
    null when SDO has none that day, or no folder for it. */
export async function fetchSdoNearest(date: string, at: string): Promise<SdoDay | null> {
  const [y, m, d] = date.split("-");
  const dir = `${SDO}/${y}/${m}/${d}/`;
  let html: string;
  try {
    html = await getText(dir);
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
  const stamp = `${y}${m}${d}`;
  const target = Date.parse(at);
  let best: SdoDay | null = null;
  let bestGap = Infinity;
  for (const [, hh, mm, ss] of html.matchAll(new RegExp(`${stamp}_(\\d{2})(\\d{2})(\\d{2})_1024_0171\\.jpg`, "g"))) {
    const time = `${date}T${hh}:${mm}:${ss}Z`;
    const gap = Math.abs(Date.parse(time) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = { date, time, url: `${dir}${stamp}_${hh}${mm}${ss}_1024_0171.jpg` };
    }
  }
  return best;
}

/* ---- APOD ----------------------------------------------------------------- */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text from the source's HTML: tags dropped, entities decoded, spaces closed. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        // fromCodePoint throws past U+10FFFF: such an entity stays as written.
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[e.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

interface ApodRow {
  date: string;
  title: string;
  credit?: string | null;
  media_type?: string | null;
  permalink?: string | null;
  url?: string | null;
}

/** "Image Credit: Apollo 11, NASA" is the credit "Apollo 11, NASA". */
const creditOf = (html: string) =>
  plainText(html)
    .replace(/^(?:(?:Image|Video|Illustration|Animation)\s+)?Credits?(?:\s*(?:&|and)\s*(?:Copyright|Licen[cs]e))?\s*:\s*/i, "")
    .replace(/\s+,/g, ",");

const toApod = (r: ApodRow): ApodDay => ({
  date: r.date,
  title: plainText(r.title),
  credit: creditOf(r.credit ?? ""),
  mediaType: r.media_type ?? "image",
  link: r.permalink ?? r.url ?? "https://science.nasa.gov/apod/",
});

/** One page of the archive, newest first, 25 days a page. */
export async function fetchApodPage(page: number): Promise<ApodDay[]> {
  const rows = await getJson<ApodRow[]>(`${APOD}?per_page=25&page=${page}`);
  return readRows(`APOD page ${page}`, rows, (r) => (/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? toApod(r) : null));
}

/** One day, by the archive's YYMMDD id, or null when there's no entry. */
export async function fetchApodDay(date: string): Promise<ApodDay | null> {
  const id = date.slice(2).replace(/-/g, "");
  try {
    const row = await getJson<ApodRow>(`${APOD}/${id}`);
    return row?.date === date ? toApod(row) : null;
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
}
