import { emptyCompact, patchFlares, patchStorms, readCompact, writeCompact, type DonkiCompact } from "./compact";
import {
  BACKFILL_FROM,
  FIRST_DATES,
  RateLimited,
  fetchApodPage,
  fetchApproaches,
  fetchEpicDates,
  fetchEpicDay,
  fetchFireballs,
  fetchFlares,
  fetchSdoNearest,
  fetchStorms,
} from "./sources";
import {
  SPACE_PREFIX,
  changing,
  monthEnd,
  monthOf,
  monthsBetween,
  readMonth,
  readSpaceJson,
  storedMonths,
  writeMonth,
  writeSpaceJson,
  type SpaceMonth,
  type SpaceRecords,
  type SpaceSource,
} from "./store";

/**
 * Filling and refreshing NASA's data (spec 7.3), in one budgeted pass that
 * does what's most needed first and stops when the time runs out. The next
 * pass picks up where it stopped.
 *
 * 1. DONKI, which questions 7 and 8 need: every month DONKI can still change
 *    when more than 3 hours old, then any missing month back to April 2010.
 * 2. Daily: APOD's newest page, and close approaches and fireballs for every
 *    month that can still change.
 * 3. The rest of the backfill: close approaches and fireballs back to 2002 a
 *    year per call, APOD page by page, the Sun on every storm or X-flare day,
 *    and EPIC's photos of Earth back to June 2015, newest first.
 *
 * A month can still change until it's been read a week after it ended:
 * sources log late, and a month read only before that could miss its last
 * days for good. A failed unit is skipped and retried next pass; a rate
 * limit, a timeout or three failures in a row end that source's turn.
 *
 * Production fills itself this way: the daily cron (`/api/cron/space`) runs a
 * pass, and so does the answers route after its response, for DONKI only.
 * `npm run space -- --all` runs passes until nothing's left, against
 * whichever store the environment names.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DONKI_STALE_MS = 3 * HOUR;
/** Under a day: Vercel fires a daily cron anywhere in its hour, so a 24-hour
    threshold would skip every other day. */
const DAILY_MS = 20 * HOUR;
/** EPIC posts a day's photos a day or two late: days this recent are read again daily. */
const EPIC_REREAD_MS = 3 * DAY;

const DONKI = ["donki-gst", "donki-flr"] as const;
const JPL = ["jpl-cad", "jpl-fireball"] as const;
const SDO_DONE_KEY = `${SPACE_PREFIX}sdo-done.json`;
const EPIC_DONE_KEY = `${SPACE_PREFIX}epic-done.json`;
const APOD_CURSOR_KEY = `${SPACE_PREFIX}apod-backfill.json`;

const lastDayOf = (month: string) => new Date(monthEnd(month) - DAY).toISOString().slice(0, 10);

export interface WorkSummary {
  /** Another pass was already running in this process, or one ran too recently. */
  skipped: boolean;
  ms: number;
  fetches: number;
  /** Months written, as "source/YYYY-MM". */
  wrote: string[];
  failed: string[];
  /** Whether everything was done: nothing missing, nothing stale, nothing failed. */
  done: boolean;
}

export interface WorkOptions {
  /** Counted from the call, so time spent waiting (`wait`) comes out of it. */
  budgetMs: number;
  /** Only these sources (the answers route refreshes DONKI alone). */
  only?: SpaceSource[];
  /** Skip when a pass started in this process less than this long ago. The
      answers route asks on every view, so without it an outage at NASA would
      hold every view's function open for a fetch timeout. */
  minGapMs?: number;
  /** Wait for a pass already running here, then run, rather than skip: the
      daily cron's pass is the only one that fills anything but DONKI. */
  wait?: boolean;
}

let running: Promise<unknown> | null = null;
let lastStarted = -Infinity;

/** Test hook: forget any pass this process ran. */
export function resetSpaceWork(): void {
  running = null;
  lastStarted = -Infinity;
}

const SKIPPED: WorkSummary = { skipped: true, ms: 0, fetches: 0, wrote: [], failed: [], done: false };

/** One pass at a time in this process. Another instance may run one too;
    writes are whole files, and the log reconciles a pass that lost a race. */
export async function runSpaceWork(opts: WorkOptions): Promise<WorkSummary> {
  const deadline = Date.now() + opts.budgetMs;
  while (opts.wait && running) await running.catch(() => undefined);
  if (running || (opts.minGapMs !== undefined && Date.now() - lastStarted < opts.minGapMs)) return { ...SKIPPED };
  lastStarted = Date.now();
  const p = pass(opts, deadline);
  running = p.finally(() => {
    running = null;
  });
  return p;
}

async function pass({ only }: WorkOptions, deadline: number): Promise<WorkSummary> {
  const started = Date.now();
  const summary: WorkSummary = { skipped: false, ms: 0, fetches: 0, wrote: [], failed: [], done: true };
  const want = (s: SpaceSource) => !only || only.includes(s);
  const timeLeft = () => Date.now() < deadline;
  const nowIso = new Date(started).toISOString();
  const today = nowIso.slice(0, 10);
  const thisMonth = monthOf(nowIso);

  /** Runs one unit of work if there's time, counting what it fetched. */
  const attempt = async (label: string, job: () => Promise<number>): Promise<"ok" | "failed" | "stop"> => {
    if (!timeLeft()) {
      summary.done = false;
      return "stop";
    }
    try {
      summary.fetches += await job();
      return "ok";
    } catch (err) {
      summary.failed.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      summary.done = false;
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return err instanceof RateLimited || timedOut ? "stop" : "failed";
    }
  };
  /** Units in order, until one says stop or three fail in a row; false if it stopped early. */
  const each = async <T,>(items: T[], label: (item: T) => string, job: (item: T) => Promise<number>) => {
    let fails = 0;
    for (const item of items) {
      const outcome = await attempt(label(item), () => job(item));
      if (outcome === "stop") return false;
      fails = outcome === "failed" ? fails + 1 : 0;
      if (fails >= 3) return false;
    }
    return true;
  };
  const write = async <S extends SpaceSource>(file: SpaceMonth<S>) => {
    await writeMonth(file);
    summary.wrote.push(`${file.source}/${file.month}`);
  };
  const monthFile = <S extends SpaceSource>(source: S, month: string, records: SpaceRecords[S][]): SpaceMonth<S> => ({
    source,
    month,
    firstDate: FIRST_DATES[source],
    refreshedAt: new Date().toISOString(),
    records,
  });

  /* ---- 1. DONKI ---------------------------------------------------------- */
  if (want("donki-gst") || want("donki-flr")) {
    const compact = (await readCompact()) ?? emptyCompact();
    let changed = false;
    for (const source of DONKI) {
      if (!want(source)) continue;
      const have = await storedMonths(source);
      const patchedAt = source === "donki-gst" ? compact.kpAt : compact.xflaresAt;
      const refetch = (m: string) => {
        const readAt = have.get(m);
        return readAt === undefined || (changing(m, readAt) && started - readAt >= DONKI_STALE_MS);
      };
      /* A stored month the log doesn't hold, or holds older than stored, is
         patched in from storage; so is a storm month from a log written
         before storms' starts were kept. */
      const repatch = (m: string) =>
        have.get(m)! > (patchedAt[m] ? Date.parse(patchedAt[m]) : -Infinity) + 60_000 ||
        (source === "donki-gst" && !(m in compact.starts));
      const todo = monthsBetween(BACKFILL_FROM[source], thisMonth).filter((m) => refetch(m) || repatch(m));
      // Months that can still change first: they're what keeps the log current.
      const live = (m: string) => !have.has(m) ? m === thisMonth : changing(m, have.get(m)!);
      todo.sort((a, b) => Number(live(b)) - Number(live(a)) || a.localeCompare(b));
      await each(
        todo,
        (m) => `${source} ${m}`,
        async (m) => {
          const stored = refetch(m) ? null : await readMonth(source, m);
          if (source === "donki-gst") {
            const file = (stored as SpaceMonth<"donki-gst"> | null) ?? monthFile(source, m, await fetchStorms(m));
            if (!stored) await write(file);
            patchStorms(compact, m, file.records, file.refreshedAt);
          } else {
            const file = (stored as SpaceMonth<"donki-flr"> | null) ?? monthFile(source, m, await fetchFlares(m));
            if (!stored) await write(file);
            patchFlares(compact, m, file.records, file.refreshedAt);
          }
          changed = true;
          return stored ? 0 : 1;
        },
      );
    }
    /* The log is whole up to the oldest read, as the log holds it, of any
       month DONKI can still change: this month, and any month not yet read a
       week after it ended. A month that missed its last reads keeps the
       stamp back until it's read again. */
    const lists = await Promise.all(DONKI.map((s) => storedMonths(s)));
    let whole = lists.every((list) => list.has(thisMonth));
    const reads: number[] = [];
    DONKI.forEach((source, i) => {
      const patchedAt = source === "donki-gst" ? compact.kpAt : compact.xflaresAt;
      for (const [m, readAt] of lists[i]) {
        if (!changing(m, readAt)) continue;
        if (patchedAt[m]) reads.push(Date.parse(patchedAt[m]));
        else whole = false;
      }
    });
    if (whole && reads.length > 0) {
      const stamp = new Date(Math.min(...reads)).toISOString();
      if (stamp !== compact.refreshedAt) {
        compact.refreshedAt = stamp;
        changed = true;
      }
    }
    if (changed) await writeCompact(compact);
  }

  /* ---- 2. Daily ---------------------------------------------------------- */
  if (want("apod")) {
    const have = await storedMonths("apod");
    if (!have.has(thisMonth) || started - have.get(thisMonth)! >= DAILY_MS) {
      await attempt("apod newest", async () => {
        await mergeApod(await fetchApodPage(1), write, monthFile);
        return 1;
      });
    }
  }
  const fetchJpl = (source: (typeof JPL)[number], from: string, to: string) =>
    source === "jpl-cad" ? fetchApproaches(from, to) : fetchFireballs(from, to);
  for (const source of JPL) {
    if (!want(source)) continue;
    const have = await storedMonths(source);
    const months = [thisMonth, ...[...have].filter(([m, at]) => m !== thisMonth && changing(m, at)).map(([m]) => m)];
    const due = months.filter((m) => !have.has(m) || started - have.get(m)! >= DAILY_MS);
    await each(
      due,
      (m) => `${source} ${m}`,
      async (m) => {
        const rows = await fetchJpl(source, `${m}-01`, m === thisMonth ? today : lastDayOf(m));
        await write(monthFile(source, m, rows as SpaceRecords[typeof source][]));
        return 1;
      },
    );
  }

  /* ---- 3. The rest of the backfill ---------------------------------------- */
  // Close approaches and fireballs: a year per call, each month written, empty ones too.
  for (const source of JPL) {
    if (!want(source)) continue;
    const have = await storedMonths(source);
    const missing = monthsBetween(BACKFILL_FROM[source], thisMonth).filter((m) => m !== thisMonth && !have.has(m));
    await each(
      [...new Set(missing.map((m) => m.slice(0, 4)))],
      (year) => `${source} ${year}`,
      async (year) => {
        const rows = (await fetchJpl(source, `${year}-01-01`, `${year}-12-31`)) as { time: string }[];
        for (const m of missing.filter((x) => x.startsWith(year))) {
          await write(monthFile(source, m, rows.filter((r) => monthOf(r.time) === m) as SpaceRecords[typeof source][]));
        }
        return 1;
      },
    );
  }

  // APOD, a page at a time, newest to oldest, from where the last pass stopped.
  if (want("apod")) {
    const cursor = (await readSpaceJson<{ page: number; done: boolean }>(APOD_CURSOR_KEY)) ?? { page: 1, done: false };
    while (!cursor.done) {
      const outcome = await attempt(`apod page ${cursor.page}`, async () => {
        const days = await fetchApodPage(cursor.page);
        await mergeApod(days, write, monthFile);
        if (days.length === 0 || days.some((d) => d.date.slice(0, 7) < BACKFILL_FROM.apod)) cursor.done = true;
        else cursor.page++;
        await writeSpaceJson(APOD_CURSOR_KEY, cursor);
        return 1;
      });
      // A page that fails is asked again next pass: skipping it would lose its days.
      if (outcome !== "ok") break;
    }
  }

  // The Sun on every storm or X-flare day since SDO began, newest first.
  if (want("sdo")) {
    const compact = await readCompact();
    if (compact) {
      const done = new Set((await readSpaceJson<{ days: string[] }>(SDO_DONE_KEY))?.days ?? []);
      const todo = [...sdoDays(compact)].filter(([d]) => d >= FIRST_DATES.sdo && !done.has(d));
      await fillByMonth("sdo", todo, ([d]) => d, done, SDO_DONE_KEY, async ([day, at]) =>
        (await fetchSdoNearest(day, at)) ?? { date: day, time: at, url: null },
      );
    }
  }

  // EPIC: every day it has, newest first, and the last few days again daily.
  if (want("epic")) {
    let available: string[] | null = null;
    await attempt("epic dates", async () => {
      available = await fetchEpicDates();
      return 1;
    });
    if (available) {
      // EPIC's list of dates is kept too: a date it doesn't list has no photo, "none" (7.3).
      const stored = (await readSpaceJson<{ days: string[]; rereadAt?: string; available?: string[] }>(EPIC_DONE_KEY)) ?? { days: [] };
      const index = { ...stored, available: [...(available as string[])].sort() };
      const done = new Set(index.days);
      const rereadDue = !index.rereadAt || started - Date.parse(index.rereadAt) >= DAILY_MS;
      const recentFrom = new Date(started - EPIC_REREAD_MS).toISOString().slice(0, 10);
      const recent = (available as string[]).filter((d) => d >= recentFrom);
      const todo = (available as string[]).filter((d) => d >= FIRST_DATES.epic && (!done.has(d) || (rereadDue && d >= recentFrom)));
      const finished = await fillByMonth("epic", todo, (d) => d, done, EPIC_DONE_KEY, (d) => fetchEpicDay(d), () => ({
        ...index,
        days: [...done].sort(),
      }));
      if (finished && rereadDue && recent.length > 0) {
        await writeSpaceJson(EPIC_DONE_KEY, { ...index, days: [...done].sort(), rereadAt: nowIso });
      } else if (JSON.stringify(stored.available ?? []) !== JSON.stringify(index.available)) {
        await writeSpaceJson(EPIC_DONE_KEY, { ...index, days: [...done].sort() });
      }
    }
  }

  summary.ms = Date.now() - started;
  return summary;

  /**
   * Day-by-day sources (SDO, EPIC): each due day fetched and merged into its
   * month, newest month first, every month written as far as it got. An
   * index of finished days spares a pass from reading every month file to
   * find what's left. False if it stopped early.
   */
  async function fillByMonth<S extends "sdo" | "epic", T>(
    source: S,
    items: T[],
    dayOf: (item: T) => string,
    done: Set<string>,
    indexKey: string,
    fetchDay: (item: T) => Promise<SpaceRecords[S]>,
    indexValue: () => unknown = () => ({ days: [...done].sort() }),
  ): Promise<boolean> {
    const byMonth = new Map<string, T[]>();
    for (const item of items) {
      const m = dayOf(item).slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(item);
    }
    for (const m of [...byMonth.keys()].sort().reverse()) {
      if (!timeLeft()) {
        summary.done = false;
        return false;
      }
      const stored = await readMonth(source, m);
      const records = new Map((stored?.records ?? []).map((r) => [(r as { date: string }).date, r]));
      for (const d of records.keys()) done.add(d);
      const fetched: string[] = [];
      const ok = await each(
        byMonth.get(m)!.sort((a, b) => dayOf(b).localeCompare(dayOf(a))),
        (item) => `${source} ${dayOf(item)}`,
        async (item) => {
          records.set(dayOf(item), await fetchDay(item));
          fetched.push(dayOf(item));
          return 1;
        },
      );
      if (fetched.length > 0) {
        const sorted = [...records.values()].sort((a, b) =>
          (a as { date: string }).date.localeCompare((b as { date: string }).date),
        );
        await write(monthFile(source, m, sorted as SpaceRecords[S][]));
        for (const d of fetched) done.add(d);
        await writeSpaceJson(indexKey, indexValue());
      }
      if (!ok) return false;
    }
    return true;
  }
}

/** APOD days into their month files, replacing any day already stored. */
async function mergeApod(
  days: SpaceRecords["apod"][],
  write: (file: SpaceMonth<"apod">) => Promise<void>,
  monthFile: (source: "apod", month: string, records: SpaceRecords["apod"][]) => SpaceMonth<"apod">,
): Promise<void> {
  const byMonth = new Map<string, SpaceRecords["apod"][]>();
  for (const d of days) {
    const m = d.date.slice(0, 7);
    if (m < BACKFILL_FROM.apod) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(d);
  }
  for (const [m, add] of byMonth) {
    const stored = await readMonth("apod", m);
    const merged = new Map((stored?.records ?? []).map((r) => [r.date, r]));
    for (const d of add) merged.set(d.date, d);
    await write(monthFile("apod", m, [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))));
  }
}

/**
 * The UTC days that need a picture of the Sun, and the time to aim for on
 * each: an X flare's peak, or the middle of the day's strongest Kp reading.
 */
export function sdoDays(c: DonkiCompact): Map<string, string> {
  const out = new Map<string, { at: number; kp: number; flare: boolean }>();
  for (const [from, to, kp] of Object.values(c.kp).flat()) {
    const mid = (from + to) / 2;
    const day = new Date(mid * 1000).toISOString().slice(0, 10);
    const cur = out.get(day);
    if (!cur || (!cur.flare && kp > cur.kp)) out.set(day, { at: mid, kp, flare: false });
  }
  for (const [peak] of Object.values(c.xflares).flat()) {
    const day = new Date(peak * 1000).toISOString().slice(0, 10);
    if (!out.get(day)?.flare) out.set(day, { at: peak, kp: 0, flare: true });
  }
  return new Map([...out].map(([day, v]) => [day, new Date(v.at * 1000).toISOString()]));
}
