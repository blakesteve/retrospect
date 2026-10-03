import { gunzipSync, gzipSync } from "node:zlib";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { historyStamp, nasaNights } from "@/lib/answers/engine";
import { runStarts } from "@/lib/answers/nightRuns";
import { isNoiseArtist } from "@/lib/noise";
import { takeBackIfRemoved } from "@/lib/removal";
import type { NasaLog } from "@/lib/space/compact";
import { skyAt } from "@/lib/sky/sky";
import { signWindows } from "@/lib/sky/windows";
import { getBlobStore } from "@/lib/store/blob";
import { userKey } from "@/lib/store/userKeys";
import { nightName, nightWeekday, zoneClock } from "@/lib/zone";
import { genreFacts, genreMap, nightMix, NIGHT_GENRE_PLAYS, type GenreFact } from "./genres";
import {
  byWildness,
  chipFor,
  chipText,
  isStormHeaded,
  pairingFact,
  pairingSentence,
  strangeness,
  wildNight,
  type Chip,
  type FirstPlaySky,
  type NightEvents,
  type WildNight,
} from "./highlights";
import { tallyNights, usualByWeekday } from "./nights";
import { moonPhaseAt, skyNights } from "./skyNights";
import { selectSongs, songsOf, type SelectedSong } from "./songs";
import { spaceNights } from "./spaceNights";
import { factSeeds, NO_FACTS, type FactSeeds } from "./tonightCards";
import { dateIn, timeIn } from "./words";
import type { TagStore } from "@/lib/genres";

/**
 * Everything step 5's endpoints serve that depends on a listener's history
 * (spec 7.4 to 7.6), computed once per listener and zone and stored, like
 * the answers (6.6): their nights, songs, highlights, genre facts and filter
 * counts. One gzipped blob per listener, `listener/{name}.json.gz`, holds up
 * to four zones' records, registered in `userKeys.ts` so removal and expiry
 * cover it. A record behind the history, NASA's log, the tags or the version
 * is served and recomputed in the background.
 */

/** Bump when anything stored here, sentences included, changes. 2: the
    Surprise facts' examples (`surpriseFacts`). 3: each song's Moon phase,
    and wild nights ranked by whether the zone saw their eclipse (7.5). 4: a
    storm-headed wild night's storm run (6.2, 7.5), the X flares in the
    reveal's counts, and each filter's nights per month (8.5). */
export const LISTENER_VERSION = 4;
export const MAX_ZONES = 4;

/** The Every night filters (8.5), each counting nights you listened. */
export const FILTERS = [
  "storm",
  "xflare",
  "eclipse",
  "fullmoon",
  "newmoon",
  "firstplay",
  "wild",
  "venushome",
  "marshome",
  "moonstrong",
  "asteroid",
  "fireball",
] as const;
export type FilterId = (typeof FILTERS)[number];

export interface SongEntry extends SelectedSong {
  /** The artist's genre (7.6), or null. */
  genre: string | null;
  /** The night the first play belongs to. */
  firstNight: string;
  /** "First played 7:18 a.m. CDT, Thursday Oct 3, 2024" lives in the client;
      the server gives the parts it can't compute: */
  firstPlayTime: string;
  firstPlayDate: string;
  /** The highlight chip's words, or null (7.5). */
  highlight: string | null;
  /** The chip itself, for the reveal's line. */
  chip: Chip | null;
  /** The pairing sentence (9.2), or null without a chip or for an early song. */
  pairing: string | null;
  /** Its closing clause alone ("the minute an X9.0 flare peaked"), for the reveal. */
  pairingFact: string | null;
  /** The questions whose condition held at the first-play minute; for 7 and
      8, on that night. In question order. Empty for a song first played in
      the history's first 90 days, the first scrobble included: its first
      play isn't news (7.5), so no question is pointed at. */
  questionsHeld: string[];
  /** The Moon's phase angle at the first-play minute (MoonPhase: 0 new, 180
      full), to 0.01°, so a drawn sky shows her real phase (8.9). Missing
      from a version 2 record; the songs route fills it in. */
  moonPhase: number;
}

export interface ListenerRecord {
  version: number;
  zone: string;
  stamp: string;
  nasaStamp: string | null;
  /** Artists tagged once the tag fetch finished, or -1 while it's still
      going (`tagsStamp`): the genre facts move with it. */
  tagged: number;
  computedAt: number;
  /** Plays after the noise filter. */
  plays: number;
  historyStart: number;
  historyEnd: number;
  /** Nights with at least one play: [night, plays, after midnight]. */
  nights: [number, number, number][];
  /** Each night's genre mix, top 3 with 3 plays or more (7.6). */
  mixes: Record<number, { genre: string; plays: number }[]>;
  /** Songs in the listed set first played each night (door badges, 7.5). */
  firstPlays: Record<number, string[]>;
  /** The listed genres with 3 plays or more each night: the nights a genre
      filter lights (8.5), which a night's top-3 mix alone can't say. */
  genreHits: Record<number, string[]>;
  /** "A usual Friday": median plays per weekday, Sunday first. */
  usual: (number | null)[];
  songs: { state: "ready" | "too-few-plays"; settleRuleDropped: boolean; row: SongEntry[]; listed: SongEntry[] };
  /** Every wild night you listened on, wildest first (7.5). */
  wild: WildNight[];
  strangest: { songId: string; score: number } | null;
  genres: GenreFact[];
  /** Nights you listened on, per filter, and per listed genre (8.5). */
  filterCounts: Record<FilterId, number>;
  genreCounts: Record<string, number>;
  /** The same nights per month, by the month of the night's date ("2024-05"),
      months with none left out: the year strip's histogram (8.5). Every
      filter and listed genre has an entry, empty when it lights no night.
      Missing from a version 3 record. */
  filterMonths?: Record<FilterId, Record<string, number>>;
  genreMonths?: Record<string, Record<string, number>>;
  /** The nights each filter lights, in order: with `genreHits`, the nights
      one sky filter and one genre light together (8.5, 7.6). Missing from a
      version 3 record. */
  filterNights?: Record<FilterId, number[]>;
  /** The reveal's count-ups (8.3) and the filter dock's lines (8.5), within
      the history: storms by their start, X flares by their peak. `xflares`
      is missing from a version 3 record (`xflaresIn`). */
  counts: { plays: number; venusSignChanges: number; storms: number; flybys: number; xflares?: number };
  /** What the Surprise facts name (7.5). Absent from a version 1 record,
      which is still served while it's rebuilt. */
  surpriseFacts?: FactSeeds;
}

const keyOf = (username: string) => userKey("listener", username);

async function readAll(username: string): Promise<ListenerRecord[]> {
  const raw = await getBlobStore().get(keyOf(username));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(gunzipSync(raw).toString("utf8")) as { records: ListenerRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

export async function readListener(username: string, zone: string): Promise<ListenerRecord | null> {
  return (await readAll(username)).find((r) => r.zone === zone) ?? null;
}

export function isCurrentListener(r: ListenerRecord, stored: Scrobble[], nasaStamp: string | null, tagged: number): boolean {
  return r.version === LISTENER_VERSION && r.stamp === historyStamp(stored) && r.nasaStamp === nasaStamp && r.tagged === tagged;
}

/** Compute one zone's record. `stored` is the history as read, noise included. */
export async function computeListener(
  stored: Scrobble[],
  zone: string,
  nasa: NasaLog | null,
  tags: TagStore,
  tagged: number,
  now = Date.now(),
): Promise<ListenerRecord> {
  const plays = stored.filter((s) => !isNoiseArtist(s.artist));
  const base = {
    version: LISTENER_VERSION,
    zone,
    stamp: historyStamp(stored),
    nasaStamp: nasa?.stamp ?? null,
    tagged,
    computedAt: now,
    plays: plays.length,
  };
  const empty: ListenerRecord = {
    ...base,
    historyStart: 0,
    historyEnd: 0,
    nights: [],
    mixes: {},
    firstPlays: {},
    genreHits: {},
    usual: Array(7).fill(null),
    songs: { state: "too-few-plays", settleRuleDropped: false, row: [], listed: [] },
    wild: [],
    strangest: null,
    genres: [],
    filterCounts: Object.fromEntries(FILTERS.map((f) => [f, 0])) as Record<FilterId, number>,
    genreCounts: {},
    filterMonths: Object.fromEntries(FILTERS.map((f) => [f, {}])) as Record<FilterId, Record<string, number>>,
    genreMonths: {},
    filterNights: Object.fromEntries(FILTERS.map((f): [FilterId, number[]] => [f, []])) as Record<FilterId, number[]>,
    counts: { plays: 0, venusSignChanges: 0, storms: 0, flybys: 0, xflares: 0 },
    surpriseFacts: NO_FACTS,
  };
  if (plays.length === 0) return empty;

  const first = plays[0].uts;
  const last = plays[plays.length - 1].uts;
  const clock = zoneClock(zone, first, last);
  const genres = genreMap(tags);
  const tallies = tallyNights(plays, clock, (a) => genres.get(a) ?? null);
  const firstNight = clock.nightOf(first);
  const lastNight = clock.nightOf(last);

  const sky = skyNights(clock, firstNight, lastNight);
  const space = await spaceNights(clock, firstNight, lastNight, nasa);
  const eventsOf = (night: number): NightEvents => {
    const s = space.get(night);
    return {
      night,
      plays: tallies.get(night)?.plays ?? 0,
      eclipse: sky.eclipse.get(night) ?? null,
      kp: s?.kp ?? null,
      xflares: (nasa?.xflares ?? []).filter(([peak]) => clock.nightOf(peak) === night),
      asteroid: s?.asteroid ?? null,
    };
  };

  // Songs, with their chips, pairings and the questions held at first play.
  const selection = selectSongs(songsOf(plays), first);
  const fireballs = [...space.values()].flatMap((s) => s.fireballs.map((f) => f.time));
  const stormSpans = (nasa?.kp ?? []).filter(([s, e]) => e >= first - 86_400 && s <= last + 86_400);
  const stormNights = new Set([...space].filter(([, s]) => s.kp !== null).map(([n]) => n));
  const flareNights = new Set(xflareNights(nasa, clock));
  const entryOf = (s: SelectedSong): SongEntry => {
    const night = clock.nightOf(s.firstPlayUts);
    const at = skyAt(new Date(s.firstPlayUts * 1000));
    const f: FirstPlaySky = {
      uts: s.firstPlayUts,
      night: eventsOf(night),
      sky: at,
      fireballs: fireballs.filter((t) => Math.abs(t - s.firstPlayUts) <= 6 * 3600),
      flares: (nasa?.xflares ?? []).filter(([peak]) => Math.abs(peak - s.firstPlayUts) <= 3600),
    };
    // A first play in the first 90 days isn't news (7.5), the first scrobble's included.
    const news = !s.early;
    const chip = news ? chipFor(f) : null;
    const held: string[] = news ? [...at.conditions] : [];
    if (news && nasa && stormNights.has(night) && clock.nightStart(night) >= nasa.stormsFrom) held.push("storms");
    if (news && nasa && flareNights.has(night) && clock.nightStart(night) >= nasa.flaresFrom) held.push("flares");
    return {
      ...s,
      genre: genres.get(s.artist.toLowerCase()) ?? null,
      firstNight: nightName(night),
      firstPlayTime: timeIn(zone, s.firstPlayUts),
      firstPlayDate: dateIn(zone, s.firstPlayUts),
      highlight: chip ? chipText(chip) : null,
      chip,
      pairing: news ? pairingSentence(s.track, zone, f, chip, stormSpans, clock) : null,
      pairingFact: news ? pairingFact(f, chip, stormSpans, clock) : null,
      questionsHeld: ORDER.filter((id) => held.includes(id)),
      moonPhase: moonPhaseAt(s.firstPlayUts),
    };
  };
  const listed = selection.listed.map(entryOf);
  const byId = new Map(listed.map((e) => [e.songId, e]));
  const row = selection.row.map((s) => byId.get(s.songId) ?? entryOf(s));

  /* The strangest sky (7.5): the row's songs whose first play is news, the
     highest score, the more recent on a tie. No song scores: no card. */
  let best: { songId: string; score: number; uts: number } | null = null;
  for (const s of row) {
    if (s.early) continue;
    const score = strangeness({
      uts: s.firstPlayUts,
      night: eventsOf(clock.nightOf(s.firstPlayUts)),
      sky: skyAt(new Date(s.firstPlayUts * 1000)),
      fireballs: [],
      flares: (nasa?.xflares ?? []).filter(([peak]) => Math.abs(peak - s.firstPlayUts) <= 3600),
    });
    if (score > 0 && (!best || score > best.score || (score === best.score && s.firstPlayUts > best.uts))) {
      best = { songId: s.songId, score, uts: s.firstPlayUts };
    }
  }
  const strangest = best ? { songId: best.songId, score: best.score } : null;

  /* Wild nights you listened on. A storm-headed one carries its storm's run:
     the nights NASA logged a storm on, plays or not, binned as question 7
     bins them, in runs as question 7 counts its events (6.2, 7.5). */
  const stormRun = runStarts(nasa ? nasaNights("storms", nasa, clock, firstNight, lastNight) : []);
  const wild = [...tallies.keys()]
    .map((n) => wildNight(eventsOf(n), clock))
    .filter((w): w is WildNight => w !== null)
    .map((w) => (isStormHeaded(w) ? { ...w, stormRun: stormRun.get(w.night) ?? w.night } : w))
    .sort(byWildness);

  // Door badges: the listed songs' first plays, by night.
  const firstPlays: Record<number, string[]> = {};
  for (const s of listed) (firstPlays[clock.nightOf(s.firstPlayUts)] ??= []).push(s.songId);

  const facts = genreFacts(plays, genres, tallies);
  const listened = (n: number) => (tallies.get(n)?.plays ?? 0) > 0;
  const surpriseFacts = factSeeds({ clock, first, last, listened, space, eclipses: sky.eclipse, xflares: nasa?.xflares ?? [] });
  // The nights each filter lights (8.5): only nights you listened on.
  const lit = (nights: Iterable<number>) => [...new Set(nights)].filter(listened).sort((a, b) => a - b);
  const spaceWhere = (pick: (s: NonNullable<ReturnType<typeof space.get>>) => boolean) =>
    [...space].filter(([, s]) => pick(s)).map(([n]) => n);
  const filterNights: Record<FilterId, number[]> = {
    storm: lit(spaceWhere((s) => s.kp !== null)),
    xflare: lit(xflareNights(nasa, clock)),
    eclipse: lit(sky.eclipse.keys()),
    fullmoon: lit(sky.fullMoon.keys()),
    newmoon: lit(sky.newMoon.keys()),
    firstplay: lit(Object.keys(firstPlays).map(Number)),
    wild: lit(wild.map((w) => w.night)),
    venushome: lit(sky.conditions.get("venushome")!),
    marshome: lit(sky.marsHome),
    moonstrong: lit(sky.conditions.get("moonstrong")!),
    asteroid: lit(spaceWhere((s) => !!s.asteroid && s.asteroid.ld < 1)),
    fireball: lit(spaceWhere((s) => s.fireballs.length > 0)),
  };
  const filterCounts = Object.fromEntries(FILTERS.map((f) => [f, filterNights[f].length])) as Record<FilterId, number>;
  const filterMonths = Object.fromEntries(FILTERS.map((f) => [f, nightsByMonth(filterNights[f])])) as Record<FilterId, Record<string, number>>;
  const genreCounts: Record<string, number> = {};
  const genreMonths: Record<string, Record<string, number>> = {};
  const genreHits: Record<number, string[]> = {};
  const nightsInOrder = [...tallies.values()].sort((a, b) => a.night - b.night);
  for (const g of facts) {
    const hits = nightsInOrder.filter((t) => (t.genres.get(g.genre) ?? 0) >= NIGHT_GENRE_PLAYS).map((t) => t.night);
    genreCounts[g.genre] = hits.length;
    genreMonths[g.genre] = nightsByMonth(hits);
    for (const n of hits) (genreHits[n] ??= []).push(g.genre);
  }

  const mixes: Record<number, { genre: string; plays: number }[]> = {};
  for (const t of tallies.values()) {
    const mix = nightMix(t);
    if (mix.length) mixes[t.night] = mix;
  }

  return {
    ...base,
    historyStart: first,
    historyEnd: last,
    nights: nightsInOrder.map((t) => [t.night, t.plays, t.afterMidnight]),
    mixes,
    firstPlays,
    genreHits,
    usual: usualByWeekday(tallies.values()),
    songs: { state: selection.state, settleRuleDropped: selection.settleRuleDropped, row, listed },
    wild,
    strangest,
    genres: facts,
    filterCounts,
    genreCounts,
    filterMonths,
    genreMonths,
    filterNights,
    counts: {
      plays: plays.length,
      venusSignChanges: signWindows.filter((w) => w.body === "Venus" && Date.parse(w.start) / 1000 > first && Date.parse(w.start) / 1000 <= last).length,
      // "NASA logged {n} solar storms in this time" (8.5): storms that began between the first play and the last.
      storms: (nasa?.stormStarts ?? []).filter((t) => t >= first && t <= last).length,
      flybys: [...space.values()].reduce((n, s) => n + s.flybys, 0),
      xflares: xflaresIn(nasa, first, last),
    },
    surpriseFacts,
  };
}

/** "NASA logged {n} X-class flares in this time" (8.5): the X flares that
    peaked between the first play and the last, the span the storms count
    uses. Also fills in a version 3 record's count while it's rebuilt. */
export function xflaresIn(nasa: NasaLog | null, first: number, last: number): number {
  return (nasa?.xflares ?? []).filter(([peak]) => peak >= first && peak <= last).length;
}

/** Nights per month, by the month of the night's date ("2024-05"), from
    nights in order; months with none are left out. */
export function nightsByMonth(nights: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of nights) {
    const month = nightName(n).slice(0, 7);
    out[month] = (out[month] ?? 0) + 1;
  }
  return out;
}

/** The nights of the log's X-flare peaks. */
function xflareNights(nasa: NasaLog | null, clock: ReturnType<typeof zoneClock>): number[] {
  return (nasa?.xflares ?? []).map(([peak]) => clock.nightOf(peak));
}

const ORDER = [
  "mercury",
  "fullmoon",
  "newmoon",
  "venushome",
  "moonstrong",
  "venusmars",
  "storms",
  "flares",
  "marswater",
  "venusdet",
  "venusrx",
  "marsrx",
];

/* Writes for one name, one at a time in this process, as for the answers. */
const writing = new Map<string, Promise<unknown>>();
function oneAtATime<T>(username: string, job: () => Promise<T>): Promise<T> {
  const key = username.toLowerCase();
  const next = (writing.get(key) ?? Promise.resolve()).then(job, job);
  writing.set(key, next);
  // then(cleanup, cleanup), not finally: a finally's own promise would reject
  // unhandled when a write fails, beside the caller's handled one.
  const cleanup = () => {
    if (writing.get(key) === next) writing.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

/** Compute and store one zone's record; taken back if the name was removed
    after `startedAt` (`takeBackIfRemoved`). */
export async function computeAndStoreListener(
  username: string,
  zone: string,
  stored: Scrobble[],
  startedAt: number,
  nasa: NasaLog | null,
  tags: TagStore,
  tagged: number,
): Promise<ListenerRecord> {
  const record = await computeListener(stored, zone, nasa, tags, tagged);
  await oneAtATime(username, async () => {
    const others = (await readAll(username)).filter((r) => r.zone !== zone);
    const records = [record, ...others].slice(0, MAX_ZONES);
    await getBlobStore().put(keyOf(username), gzipSync(Buffer.from(JSON.stringify({ records }))));
    await takeBackIfRemoved(username, startedAt, [keyOf(username)]);
  });
  return record;
}

const running = new Map<string, Promise<ListenerRecord>>();

/** One computation per listener, zone and inputs at a time in this process. */
export function computeListenerOnce(
  username: string,
  zone: string,
  stored: Scrobble[],
  startedAt: number,
  nasa: NasaLog | null,
  tags: TagStore,
  tagged: number,
): Promise<ListenerRecord> {
  const key = `${username.toLowerCase()}|${zone}|${historyStamp(stored)}|${nasa?.stamp ?? ""}|${tagged}`;
  let job = running.get(key);
  if (!job) {
    job = computeAndStoreListener(username, zone, stored, startedAt, nasa, tags, tagged).finally(() => running.delete(key));
    running.set(key, job);
  }
  return job;
}

/** A night's weekday usual, for the nights endpoint. */
export const usualFor = (r: ListenerRecord, night: number) => r.usual[nightWeekday(night)];
