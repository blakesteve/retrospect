import { WILD_ASTEROID_METERS } from "@/lib/listener/highlights";
import { lunarDistances, metersFromH } from "@/lib/listener/spaceNights";
import eclipses from "@/lib/sky/data/eclipses.json";
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
  fetchSdoDay,
  fetchStorms,
} from "./sources";
import {
  SPACE_PREFIX,
  changing,
  monthEnd,
  monthOf,
  monthsBetween,
  readMonth,
  readMonths,
  readSpaceJson,
  storedMonths,
  writeMonth,
  writeSpaceJson,
  PROGRESS_KEY,
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
 * 3. The rest of the backfill, most wanted first: close approaches and
 *    fireballs back to 2002 a year per call, the Sun at every storm reading
 *    and X flare, APOD back a year, EPIC's days around storms, flares,
 *    eclipses and close asteroids and its last year; then the rest of APOD
 *    and of EPIC (back to June 2015), each newest first.
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
/** The moments SDO has been read for (`sdoMoments`). The index before
    moments, `sdo-done.json`, listed days, so the fill reads every moment once. */
const SDO_MOMENTS_KEY = `${SPACE_PREFIX}sdo-moments-done.json`;
/** A full pass's hold on the fill while it runs (`leased`). */
const LEASE_KEY = `${SPACE_PREFIX}fill-lease.json`;
const EPIC_DONE_KEY = `${SPACE_PREFIX}epic-done.json`;
const APOD_CURSOR_KEY = `${SPACE_PREFIX}apod-backfill.json`;
/** How far APOD's backfill has come: the next page, and the oldest day read. */
interface ApodCursor {
  page: number;
  done: boolean;
  reached?: string;
}

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
  /** A full pass skipped for another one running elsewhere: its lease's end. */
  heldUntil?: string;
  /** What's still to fetch, by source, as this pass left it: months for
      DONKI, calls for JPL, pages for APOD (an estimate), event moments for
      SDO, days for EPIC, with "epic-priority" the days that come first. A
      source the pass didn't reach is left out. */
  left: Record<string, number>;
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

const SKIPPED: WorkSummary = { skipped: true, ms: 0, fetches: 0, wrote: [], failed: [], done: false, left: {} };

/** One pass at a time in this process. Another instance may run one too;
    writes are whole files, and the log reconciles a pass that lost a race. */
export async function runSpaceWork(opts: WorkOptions): Promise<WorkSummary> {
  const deadline = Date.now() + opts.budgetMs;
  while (opts.wait && running) await running.catch(() => undefined);
  if (running || (opts.minGapMs !== undefined && Date.now() - lastStarted < opts.minGapMs)) return { ...SKIPPED };
  lastStarted = Date.now();
  const p = opts.only ? pass(opts, deadline) : leased(opts, deadline);
  running = p.finally(() => {
    running = null;
  });
  // The caller handles `p`. This derived promise rejects with it, and with no
  // handler a failed pass (the store down) would be an unhandled rejection.
  running.catch(() => undefined);
  return p;
}

/**
 * A full pass holds a lease in the bucket while it runs, so one started on
 * another instance (a "Run" press during the daily pass) skips rather than
 * write the same months and indexes over it: two at once can mark EPIC days
 * done that their month file then loses. The lease ends a minute after the
 * pass's deadline even if the function dies. Best effort: two passes that
 * start within the same read can both take it. DONKI-only passes don't ask:
 * the log reconciles a pass that lost a race.
 */
async function leased(opts: WorkOptions, deadline: number): Promise<WorkSummary> {
  const held = await readSpaceJson<{ until: number; by: string }>(LEASE_KEY);
  if (held && held.until > Date.now()) return { ...SKIPPED, heldUntil: new Date(held.until).toISOString() };
  const by = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeSpaceJson(LEASE_KEY, { until: deadline + 60_000, by });
  try {
    return await pass(opts, deadline);
  } finally {
    const mine = await readSpaceJson<{ by: string }>(LEASE_KEY).catch(() => null);
    if (mine?.by === by) await writeSpaceJson(LEASE_KEY, { until: 0, by }).catch(() => undefined);
  }
}

async function pass({ only }: WorkOptions, deadline: number): Promise<WorkSummary> {
  const started = Date.now();
  const summary: WorkSummary = { skipped: false, ms: 0, fetches: 0, wrote: [], failed: [], done: true, left: {} };
  const left = summary.left;
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
  /** Units in order, until one says stop or three fail in a row; false if
      it stopped early. `left[counted]`, when given, counts down per unit done. */
  const each = async <T,>(items: T[], label: (item: T) => string, job: (item: T) => Promise<number>, counted?: string) => {
    let fails = 0;
    for (const item of items) {
      const outcome = await attempt(label(item), () => job(item));
      if (outcome === "stop") return false;
      if (outcome === "ok" && counted) left[counted]--;
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
      left[source] = todo.length;
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
        source,
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
    left[source] = due.length;
    await each(
      due,
      (m) => `${source} ${m}`,
      async (m) => {
        const rows = await fetchJpl(source, `${m}-01`, m === thisMonth ? today : lastDayOf(m));
        await write(monthFile(source, m, rows as SpaceRecords[typeof source][]));
        return 1;
      },
      source,
    );
  }

  /* ---- 3. The backfill, most wanted first --------------------------------- */
  /* Storm, flare, eclipse and wild nights and the last 12 months first, then
     everything else, each newest first (architect, 2 Oct 2026): JPL's years
     (a call a year, and they name the close asteroids), SDO's moments (each a
     storm reading or a flare), APOD back a year, EPIC's wanted days; then the
     rest of APOD and of EPIC. */
  const yearAgo = new Date(started - 365 * DAY).toISOString().slice(0, 10);

  // Close approaches and fireballs: a year per call, each month written, empty ones too.
  for (const source of JPL) {
    if (!want(source)) continue;
    const have = await storedMonths(source);
    const missing = monthsBetween(BACKFILL_FROM[source], thisMonth).filter((m) => m !== thisMonth && !have.has(m));
    const years = [...new Set(missing.map((m) => m.slice(0, 4)))];
    left[source] = (left[source] ?? 0) + years.length;
    await each(
      years,
      (year) => `${source} ${year}`,
      async (year) => {
        const rows = (await fetchJpl(source, `${year}-01-01`, `${year}-12-31`)) as { time: string }[];
        for (const m of missing.filter((x) => x.startsWith(year))) {
          await write(monthFile(source, m, rows.filter((r) => monthOf(r.time) === m) as SpaceRecords[typeof source][]));
        }
        return 1;
      },
      source,
    );
  }

  // The Sun at every X flare and storm reading since SDO began, newest first:
  // a picture per moment, so each night can show its own (`sunsByNight`).
  if (want("sdo")) {
    const compact = await readCompact();
    if (compact) {
      const done = new Set((await readSpaceJson<{ moments: string[] }>(SDO_MOMENTS_KEY))?.moments ?? []);
      const todo = [...sdoMoments(compact)]
        .filter(([day]) => day >= FIRST_DATES.sdo)
        .map(([day, ats]) => [day, ats.filter((at) => !done.has(at))] as const)
        .filter(([, ats]) => ats.length > 0);
      left.sdo = todo.reduce((n, [, ats]) => n + ats.length, 0);
      await fillByMonth(
        "sdo",
        todo,
        ([day]) => day,
        done,
        SDO_MOMENTS_KEY,
        ([day, ats]) => fetchSdoDay(day, [...ats]),
        (r) => r.at ?? null,
        ([, ats]) => [...ats],
        () => ({ moments: [...done].sort() }),
        ["sdo"],
      );
    }
  }

  // APOD, a page at a time, newest to oldest, from where the last pass
  // stopped: back a year here, the rest after EPIC's wanted days.
  const cursor = want("apod") ? ((await readSpaceJson<ApodCursor>(APOD_CURSOR_KEY)) ?? { page: 1, done: false }) : null;
  const apodPages = async (enough: (c: ApodCursor) => boolean) => {
    while (cursor && !cursor.done && !enough(cursor)) {
      const outcome = await attempt(`apod page ${cursor.page}`, async () => {
        const days = await fetchApodPage(cursor.page);
        await mergeApod(days, write, monthFile);
        if (days.length === 0 || days.some((d) => d.date.slice(0, 7) < BACKFILL_FROM.apod)) cursor.done = true;
        else cursor.page++;
        for (const d of days) if (!cursor.reached || d.date < cursor.reached) cursor.reached = d.date;
        await writeSpaceJson(APOD_CURSOR_KEY, cursor);
        return 1;
      });
      // A page that fails is asked again next pass: skipping it would lose its days.
      if (outcome !== "ok") break;
    }
    if (cursor) {
      // An estimate: about 25 days a page, back to where the backfill starts.
      const pages = Math.ceil((started - Date.parse(`${BACKFILL_FROM.apod}-01T00:00:00Z`)) / DAY / 25);
      left.apod = cursor.done ? 0 : Math.max(1, pages - cursor.page + 1);
    }
  };
  await apodPages((c) => !!c.reached && c.reached < yearAgo);

  // EPIC: every day it has, the wanted ones first, and the last few days again daily.
  let epic: { rest: string[]; fill: (days: string[], counted: string[]) => Promise<boolean>; finish: (finished: boolean) => Promise<void> } | null =
    null;
  let epicFirstDone = false;
  if (want("epic")) {
    let available: string[] | null = null;
    await attempt("epic dates", async () => {
      available = await fetchEpicDates();
      return 1;
    });
    if (available && !timeLeft()) summary.done = false;
    else if (available) {
      // EPIC's list of dates is kept too: a date it doesn't list has no photo, "none" (7.3).
      const stored = (await readSpaceJson<{ days: string[]; rereadAt?: string; available?: string[] }>(EPIC_DONE_KEY)) ?? { days: [] };
      const index = { ...stored, available: [...(available as string[])].sort() };
      const done = new Set(index.days);
      const rereadDue = !index.rereadAt || started - Date.parse(index.rereadAt) >= DAILY_MS;
      const recentFrom = new Date(started - EPIC_REREAD_MS).toISOString().slice(0, 10);
      const recent = (available as string[]).filter((d) => d >= recentFrom);
      const todo = (available as string[]).filter((d) => d >= FIRST_DATES.epic && (!done.has(d) || (rereadDue && d >= recentFrom)));
      const wanted = todo.some((d) => d < yearAgo) ? await epicWanted(await readCompact()) : new Set<string>();
      const first = todo.filter((d) => d >= yearAgo || wanted.has(d));
      left.epic = todo.length;
      left["epic-priority"] = first.length;
      const fill = (days: string[], counted: string[]) =>
        fillByMonth(
          "epic",
          days,
          (d) => d,
          done,
          EPIC_DONE_KEY,
          async (d) => [await fetchEpicDay(d)],
          (r) => r.date,
          (d) => [d],
          () => ({ ...index, days: [...done].sort() }),
          counted,
        );
      const finish = async (finished: boolean) => {
        if (finished && rereadDue && recent.length > 0) {
          await writeSpaceJson(EPIC_DONE_KEY, { ...index, days: [...done].sort(), rereadAt: nowIso });
        } else if (JSON.stringify(stored.available ?? []) !== JSON.stringify(index.available)) {
          await writeSpaceJson(EPIC_DONE_KEY, { ...index, days: [...done].sort() });
        }
      };
      epic = { rest: todo.filter((d) => d < yearAgo && !wanted.has(d)), fill, finish };
      epicFirstDone = await fill(first, ["epic", "epic-priority"]);
    }
  }

  // Then everything else: the rest of APOD, the rest of EPIC.
  await apodPages(() => false);
  if (epic) await epic.finish(epicFirstDone && (await epic.fill(epic.rest, ["epic"])));

  summary.ms = Date.now() - started;
  // A full pass leaves a readable trail; the answers route's DONKI-only passes don't.
  if (!only) await recordProgress(summary, nowIso).catch((err) => console.error("[retrospect] fill progress wouldn't save:", err));
  return summary;

  /**
   * Day-by-day sources (SDO, EPIC): each due day fetched and merged into its
   * month, newest month first, every month written as far as it got. A day
   * can bring several records (SDO's moments), each under `keyOf`; a stored
   * record the key can't name (an SDO day from before moments) is kept until
   * its own day is read again, so a month written partway keeps the rest. An
   * index of finished keys spares a pass from reading every month file to
   * find what's left. False if it stopped early.
   */
  async function fillByMonth<S extends "sdo" | "epic", T>(
    source: S,
    items: T[],
    dayOf: (item: T) => string,
    done: Set<string>,
    indexKey: string,
    fetchDay: (item: T) => Promise<SpaceRecords[S][]>,
    keyOf: (record: SpaceRecords[S]) => string | null,
    keysOf: (item: T) => string[],
    indexValue: () => unknown,
    counted: string[],
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
      const records = new Map<string, SpaceRecords[S]>();
      for (const r of (stored?.records ?? []) as SpaceRecords[S][]) {
        const key = keyOf(r);
        if (key) done.add(key);
        records.set(key ?? `~${r.date}`, r);
      }
      const fetched: string[] = [];
      const ok = await each(
        byMonth.get(m)!.sort((a, b) => dayOf(b).localeCompare(dayOf(a))),
        (item) => `${source} ${dayOf(item)}`,
        async (item) => {
          const got = await fetchDay(item);
          records.delete(`~${dayOf(item)}`);
          for (const r of got) records.set(keyOf(r)!, r);
          fetched.push(...keysOf(item));
          for (const c of counted) left[c] -= keysOf(item).length;
          return 1;
        },
      );
      if (fetched.length > 0) {
        const sorted = [...records.entries()]
          .sort(([ka, a], [kb, b]) => a.date.localeCompare(b.date) || ka.localeCompare(kb))
          .map(([, r]) => r);
        await write(monthFile(source, m, sorted));
        for (const key of fetched) done.add(key);
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
 * The moments that need a picture of the Sun, by UTC day: every X flare's
 * peak and the middle of every Kp reading (architect, 2 Oct 2026), so a
 * night in any zone finds one taken during its own biggest event.
 */
export function sdoMoments(c: DonkiCompact): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const add = (t: number) => {
    const iso = new Date(t * 1000).toISOString();
    const day = iso.slice(0, 10);
    if (!out.has(day)) out.set(day, new Set());
    out.get(day)!.add(iso);
  };
  for (const [from, to] of Object.values(c.kp).flat()) add((from + to) / 2);
  for (const [peak] of Object.values(c.xflares).flat()) add(peak);
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)).map(([day, s]) => [day, [...s].sort()]));
}

/**
 * The EPIC days that come first: the days around storms, X flares, eclipses
 * and asteroids of about 50 m closer than the Moon, which make nights wild
 * (7.5). A night's date can be its event's UTC date or the one either side,
 * so each event brings three days.
 */
async function epicWanted(compact: DonkiCompact | null): Promise<Set<string>> {
  const moments: number[] = [];
  if (compact) {
    for (const [from, to] of Object.values(compact.kp).flat()) moments.push((from + to) / 2);
    for (const [peak] of Object.values(compact.xflares).flat()) moments.push(peak);
  }
  for (const e of eclipses.events) moments.push(Date.parse(e.peak) / 1000);
  for (const file of (await readMonths("jpl-cad", [...(await storedMonths("jpl-cad")).keys()])).values()) {
    for (const a of file.records) {
      if (lunarDistances(a.au) < 1 && a.h !== null && metersFromH(a.h) >= WILD_ASTEROID_METERS) moments.push(Date.parse(a.time) / 1000);
    }
  }
  const out = new Set<string>();
  for (const t of moments) for (const k of [-1, 0, 1]) out.add(new Date((t + k * 86_400) * 1000).toISOString().slice(0, 10));
  return out;
}

interface Progress {
  updatedAt: string;
  /** The latest count each source reported, and when. */
  left: Record<string, { count: number; at: string }>;
  /** The latest full passes, newest first. */
  passes: { at: string; ms: number; fetches: number; wrote: number; failed: number; done: boolean }[];
}

/** One full pass into the progress file (`/api/space/progress`). */
async function recordProgress(s: WorkSummary, at: string): Promise<void> {
  const p = (await readSpaceJson<Progress>(PROGRESS_KEY)) ?? { updatedAt: at, left: {}, passes: [] };
  for (const [source, count] of Object.entries(s.left)) p.left[source] = { count: Math.max(0, count), at };
  p.passes = [{ at, ms: s.ms, fetches: s.fetches, wrote: s.wrote.length, failed: s.failed.length, done: s.done }, ...p.passes].slice(0, 30);
  p.updatedAt = at;
  await writeSpaceJson(PROGRESS_KEY, p);
}
