import type { NasaLog } from "@/lib/space/compact";
import { SPACE_PHOTOS } from "@/lib/space/curated";
import { kpLabel, stormGrade } from "@/lib/space/kp";
import { monthsBetween, readMonths, type SpaceMonth } from "@/lib/space/store";
import { dignityPhrase, type Sign } from "@/lib/sky/sky";
import { signWindows } from "@/lib/sky/windows";
import { nightName, nightWeekday, zoneClock, type ZoneClock } from "@/lib/zone";
import type { WildNight } from "./highlights";
import type { ListenerRecord } from "./record";
import { kickerDate, lengthWords, WEEKDAYS, wildCardLine } from "./sentences";
import { flareSize, readEpicIndex, spaceNights, zoneLongitude, type SpaceNight } from "./spaceNights";
import { aboutMeters, dateIn, nightDate, timeIn } from "./words";

/**
 * Tonight's listener data (spec 8.4): the wild night cards and the Surprise
 * me pool (7.5). SERVER ONLY.
 *
 * - A wild night card carries the night's plays against the usual for its
 *   weekday, its date, the kind of event heading it (for the icon) and the
 *   first photo of the night sheet's gallery (8.7.1), or null for a drawn sky.
 * - The pool is every song card with a highlight chip, every wild night, and
 *   fact cards: a count over the history, then one dated example from a night
 *   the listener played something, so the client can open that night's sheet
 *   with the fact as its lead line. Facts only, never a cause.
 */

/* ---- Photos --------------------------------------------------------------- */

export interface CardPhoto {
  url: string;
  credit: string;
  /** Every caption says when the photo was taken (7.3). */
  caption: string;
}

/** SDO's Sun, as the fill stored it: a picture and when it was taken. */
export interface SunPhoto {
  url: string;
  time: number;
}

/** The UTC months whose SDO files can hold a picture taken during nights
    `first` to `last`: a night runs 4 a.m. to 4 a.m. local, so its pictures
    can be filed under the UTC day, and month, either side of its date. */
export function sunMonths(clock: ZoneClock, first: number, last: number): string[] {
  const month = (uts: number) => new Date(uts * 1000).toISOString().slice(0, 7);
  return monthsBetween(month(clock.nightStart(first)), month(clock.nightStart(last + 1) - 1));
}

/**
 * SDO's Sun for each night, by the listener's clock (8.7.1, 7.3; ClickUp
 * 86e3jdkeg). The fill files a picture under the UTC day of the event it
 * aims at, an X flare's peak or the day's strongest Kp reading, so the UTC
 * date can name the wrong night: Chicago's May 10, 2024 storm night has the
 * X5.8 picture filed under May 11. Each picture goes to the night it was
 * taken in. Two in one night: the one nearer that night's biggest X flare,
 * or its strongest Kp reading, as the fill itself prefers; the earlier with
 * no log.
 */
export function sunsByNight(files: Iterable<SpaceMonth<"sdo">>, clock: ZoneClock, nasa: NasaLog | null): Map<number, SunPhoto> {
  const byNight = new Map<number, SunPhoto[]>();
  for (const file of files) {
    for (const d of file.records) {
      if (!d.url) continue;
      const time = Date.parse(d.time) / 1000;
      const n = clock.nightOf(time);
      byNight.set(n, [...(byNight.get(n) ?? []), { url: d.url, time }]);
    }
  }
  const out = new Map<number, SunPhoto>();
  for (const [n, suns] of byNight) {
    suns.sort((a, b) => a.time - b.time);
    const aim = nasa ? nightAim(nasa, clock, n) : null;
    out.set(n, aim === null ? suns[0] : suns.reduce((a, b) => (Math.abs(b.time - aim) < Math.abs(a.time - aim) ? b : a)));
  }
  return out;
}

/** The moment a night's Sun should show: its biggest X flare's peak, else the
    middle of its strongest Kp reading, else null. */
function nightAim(nasa: NasaLog, clock: ZoneClock, n: number): number | null {
  let flare: [number, string] | null = null;
  for (const f of nasa.xflares) if (clock.nightOf(f[0]) === n && (!flare || flareSize(f[1]) > flareSize(flare[1]))) flare = f;
  if (flare) return flare[0];
  let storm: [number, number, number] | null = null;
  for (const k of nasa.kp) {
    const mid = (k[0] + k[1]) / 2;
    if (clock.nightOf(mid) === n && (!storm || k[2] > storm[2])) storm = k;
  }
  return storm ? (storm[0] + storm[1]) / 2 : null;
}

/**
 * A night's gallery in the night sheet's order (8.7.1): EPIC's Earth, then
 * the curated photo of the night's event, then SDO's Sun on a storm or
 * X-flare night.
 */
export function nightGallery(night: number, space: SpaceNight | undefined, sun: SunPhoto | undefined, clock: ZoneClock): CardPhoto[] {
  const zone = clock.zone;
  const out: CardPhoto[] = [];
  if (space && typeof space.epic === "object") {
    const t = Date.parse(space.epic.time) / 1000;
    out.push({
      url: space.epic.url,
      credit: space.epic.credit,
      caption: `Earth at ${timeIn(zone, t)} on ${dateIn(zone, t)}, from NASA's EPIC camera, a million miles out.`,
    });
  }
  for (const p of SPACE_PHOTOS) {
    if (p.showOn === "night" && p.eventAt && clock.nightOf(Date.parse(p.eventAt) / 1000) === night) {
      out.push({ url: p.image, credit: p.credit, caption: p.caption });
    }
  }
  if (sun && space && (space.kp !== null || space.xFlare)) {
    out.push({
      url: sun.url,
      credit: "NASA/SDO and the AIA science team",
      caption: `The Sun at ${timeIn(zone, sun.time)} on ${dateIn(zone, sun.time)}, from NASA's Solar Dynamics Observatory.`,
    });
  }
  return out;
}

/**
 * Each night's first gallery photo, or null. NASA's facts are read per night
 * as the nights route reads them, so a card shows the photo its sheet opens on.
 * The shared files (SDO's months, EPIC's index) are read once per call, and a
 * read that fails costs only what it feeds: a night whose facts won't read
 * still gets its curated photo, and the other nights keep theirs.
 */
export async function firstPhotos(clock: ZoneClock, nights: number[], nasa: NasaLog | null): Promise<Map<number, CardPhoto | null>> {
  const out = new Map<number, CardPhoto | null>();
  if (nights.length === 0) return out;
  const year = (n: number) => Number(nightName(n).slice(0, 4));
  const failed = (what: string) => (err: unknown) => {
    console.error(`[retrospect] ${what} wouldn't read for the wild night photos:`, err);
    return null;
  };
  const [sdo, epicIndex] = await Promise.all([
    readMonths("sdo", [...new Set(nights.flatMap((n) => sunMonths(clock, n, n)))]).catch(failed("SDO's months")),
    readEpicIndex().catch(failed("EPIC's index")),
  ]);
  const sun = sunsByNight(sdo?.values() ?? [], clock, nasa);
  const spaces = await Promise.allSettled(
    nights.map((n) => spaceNights(clock, n, n, nasa, { epic: true, longitude: zoneLongitude(clock, year(n)), epicIndex })),
  );
  nights.forEach((n, i) => {
    const s = spaces[i];
    if (s.status === "rejected") failed(`${nightName(n)}'s facts`)(s.reason);
    const space = s.status === "fulfilled" ? s.value.get(n) : undefined;
    out.set(n, nightGallery(n, space, sun.get(n), clock)[0] ?? null);
  });
  return out;
}

/* ---- Wild night cards ----------------------------------------------------- */

export type WildKind = "eclipse" | "storm" | "flare" | "asteroid";

/** The event heading a wild night, from its rank (7.5): 0 to 2 are
    eclipses, 3 and 4 storms, 5 a flare, 6 an asteroid. */
export const wildKind = (rank: number): WildKind =>
  rank <= 2 ? "eclipse" : rank <= 4 ? "storm" : rank === 5 ? "flare" : "asteroid";

export interface WildCard {
  date: string;
  rank: number;
  title: string;
  story: string | null;
  eventId: string | null;
  plays: number;
  /** The usual for that weekday, or null. */
  usual: number | null;
  /** "39 songs · a usual Friday is 50". */
  line: string;
  /** "Fri, May 10, 2024". */
  dateLine: string;
  kind: WildKind;
  photo: CardPhoto | null;
}

/** The wild night row's cards (8.4), in the order given. */
export function wildCards(
  record: Pick<ListenerRecord, "nights" | "usual">,
  wild: WildNight[],
  photos: Map<number, CardPhoto | null>,
): WildCard[] {
  const plays = new Map(record.nights.map(([n, p]) => [n, p]));
  return wild.map((w) => {
    const count = plays.get(w.night) ?? 0;
    const usual = record.usual[nightWeekday(w.night)] ?? null;
    return {
      date: nightName(w.night),
      rank: w.rank,
      title: w.title,
      story: w.story,
      eventId: w.eventId,
      plays: count,
      usual,
      line: wildCardLine(count, WEEKDAYS[nightWeekday(w.night)], usual),
      dateLine: kickerDate(w.night),
      kind: wildKind(w.rank),
      photo: photos.get(w.night) ?? null,
    };
  });
}

/* ---- Facts ---------------------------------------------------------------- */

/**
 * What the Surprise facts name, found when the record is computed: the
 * flybys and fireballs come from NASA's month files over the whole history,
 * too many to read per request. Facts, not sentences, so a change of words
 * needs no new record. Each example is on a night the listener played
 * something, since the client opens that night's sheet.
 */
export interface FactSeeds {
  /** The biggest nearest pass within 0.01 AU, with a size, on a night you
      listened. Counted by `counts.flybys`. */
  flyby: { night: number; time: number; meters: number } | null;
  /** The night you listened with the highest Kp in NASA's log. Counted by
      `counts.storms`. */
  storm: { night: number; kp: number } | null;
  /** The log's X flares on the history's nights, and the biggest on a night
      you listened. */
  xflare: { count: number; night: number; peak: number; cls: string } | null;
  /** The history's eclipses, and one on a night you listened, in the wild
      nights' order (7.5), then partial and penumbral. */
  eclipse: { count: number; night: number; kind: string; time: number } | null;
  /** JPL's fireballs on the history's nights, and the biggest on a night you
      listened. */
  fireball: { count: number; night: number; time: number } | null;
  /** Venus's latest change of sign on a night you listened. Counted by
      `counts.venusSignChanges`. */
  venus: { night: number; time: number; sign: Sign } | null;
}

export const NO_FACTS: FactSeeds = { flyby: null, storm: null, xflare: null, eclipse: null, fireball: null, venus: null };

export interface FactInputs {
  clock: ZoneClock;
  /** The history's first and last play. */
  first: number;
  last: number;
  listened: (night: number) => boolean;
  /** NASA's facts for every night of the history (`spaceNights`). */
  space: Map<number, SpaceNight>;
  /** The history's eclipses, by night (`skyNights`). */
  eclipses: Map<number, { kind: string; time: number }>;
  /** NASA's log's X flares: [peak, class]. */
  xflares: [number, string][];
}

const ECLIPSE_ORDER = ["total solar", "annular solar", "total lunar", "partial solar", "partial lunar", "penumbral lunar"];
const eclipseOrder = (kind: string) => {
  const i = ECLIPSE_ORDER.indexOf(kind);
  return i < 0 ? ECLIPSE_ORDER.length : i;
};

/** The candidate scoring highest, the newest on a tie. */
function best<T extends { at: number }>(candidates: T[], score: (c: T) => number): T | null {
  let top: T | null = null;
  for (const c of candidates) {
    if (!top || score(c) > score(top) || (score(c) === score(top) && c.at > top.at)) top = c;
  }
  return top;
}

/** The Surprise facts' examples, for the record (7.5). */
export function factSeeds(i: FactInputs): FactSeeds {
  const nightOf = (t: number) => i.clock.nightOf(t);
  const heard = [...i.space].filter(([n]) => i.listened(n));

  const flyby = best(
    heard.flatMap(([night, s]) =>
      s.flybys > 0 && s.asteroid && s.asteroid.meters !== null ? [{ night, at: s.asteroid.time, meters: s.asteroid.meters }] : [],
    ),
    (c) => c.meters,
  );
  const storm = best(
    heard.flatMap(([night, s]) => (s.kp !== null ? [{ night, at: night, kp: s.kp }] : [])),
    (c) => c.kp,
  );
  const flares = i.xflares.filter(([peak]) => i.space.has(nightOf(peak)));
  const flare = best(
    flares.filter(([peak]) => i.listened(nightOf(peak))).map(([peak, cls]) => ({ at: peak, cls })),
    (c) => flareSize(c.cls),
  );
  const eclipse = best(
    [...i.eclipses].filter(([n]) => i.listened(n)).map(([night, e]) => ({ night, at: e.time, kind: e.kind })),
    (c) => -eclipseOrder(c.kind),
  );
  const fireballs = [...i.space].flatMap(([night, s]) => s.fireballs.map((f) => ({ night, at: f.time, kt: f.kt })));
  const fireball = best(
    fireballs.filter((f) => i.listened(f.night)),
    (f) => f.kt ?? -1,
  );
  // The changes `counts.venusSignChanges` counts: after the first play, up to the last.
  const venus = best(
    signWindows
      .filter((w) => w.body === "Venus")
      .map((w) => ({ at: Date.parse(w.start) / 1000, sign: w.sign }))
      .filter((c) => c.at > i.first && c.at <= i.last && i.listened(nightOf(c.at))),
    () => 0,
  );

  return {
    flyby: flyby && { night: flyby.night, time: flyby.at, meters: flyby.meters },
    storm: storm && { night: storm.night, kp: storm.kp },
    xflare: flare && { count: flares.length, night: nightOf(flare.at), peak: flare.at, cls: flare.cls },
    eclipse: eclipse && { count: i.eclipses.size, night: eclipse.night, kind: eclipse.kind, time: eclipse.at },
    fireball: fireball && { count: fireballs.length, night: fireball.night, time: fireball.at },
    venus: venus && { night: nightOf(venus.at), time: venus.at, sign: venus.sign },
  };
}

export interface FactItem {
  id: string;
  kind: "fact";
  /** The night it names, "YYYY-MM-DD": the client opens its sheet. */
  date: string;
  text: string;
  /** A curated photo that's a Surprise fact only (7.3), never a night's. */
  photo?: CardPhoto;
}

const counted = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const oneOf = (n: number) => (n === 1 ? "it" : "one of them");
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n.toLocaleString("en-US")} times`);

/**
 * The Surprise facts (7.5): "1,655 asteroid flybys closer than about 4 lunar
 * distances in these three years. On Jun 29, 2024, one of them was about 140
 * m wide." Each count is over the history, each example on a night with
 * plays. A record stored before the facts were (version 1) gives only the
 * curated photo's, which reads the nights alone.
 */
export function factItems(r: Pick<ListenerRecord, "zone" | "historyStart" | "historyEnd" | "counts" | "surpriseFacts" | "nights">): FactItem[] {
  if (r.nights.length === 0) return [];
  const clock = zoneClock(r.zone, r.historyStart, r.historyEnd);
  const zone = clock.zone;
  const length = lengthWords(r.historyStart, r.historyEnd);
  const span = length === "A few weeks" ? "these few weeks" : `these ${length.toLowerCase()}`;
  /* "On Jun 29, 2024" for an instant; "On the night of May 14, 2024" when
     it fell after midnight, so the date always names the night that opens. */
  const onDay = (t: number) => {
    const day = dateIn(zone, t);
    const night = nightDate(nightName(clock.nightOf(t)));
    return day === night ? `On ${day}` : `On the night of ${night}`;
  };
  const seeds = r.surpriseFacts ?? NO_FACTS;
  const out: FactItem[] = [];
  const add = (id: string, night: number, text: string) => out.push({ id: `fact:${id}`, kind: "fact", date: nightName(night), text });

  const { flyby, storm, xflare, eclipse, fireball, venus } = seeds;
  const { flybys, storms, venusSignChanges } = r.counts;
  if (flyby && flybys > 0) {
    add(
      "flybys",
      flyby.night,
      `${counted(flybys, "asteroid flyby", "asteroid flybys")} closer than about 4 lunar distances in ${span}. ${onDay(flyby.time)}, ${oneOf(flybys)} was ${aboutMeters(flyby.meters)} wide.`,
    );
  }
  if (storm && storms > 0) {
    const grade = stormGrade(storm.kp);
    add(
      "storms",
      storm.night,
      `${counted(storms, "solar storm", "solar storms")} in NASA's log in ${span}. On the night of ${nightDate(nightName(storm.night))}, ${oneOf(storms)} reached ${kpLabel(storm.kp)}: a ${grade ?? "minor"} storm${grade === "G5" ? ", the top of the scale" : ""}.`,
    );
  }
  if (xflare) {
    add(
      "xflares",
      xflare.night,
      `${counted(xflare.count, "X-class flare", "X-class flares")} in NASA's log in ${span}. ${onDay(xflare.peak)}, ${oneOf(xflare.count)} reached ${xflare.cls}, peaking at ${timeIn(zone, xflare.peak)}.`,
    );
  }
  if (eclipse) {
    add(
      "eclipses",
      eclipse.night,
      `${counted(eclipse.count, "eclipse", "eclipses")} in ${span}. ${onDay(eclipse.time)}, ${oneOf(eclipse.count)} was ${article(eclipse.kind)} ${eclipse.kind} eclipse.`,
    );
  }
  if (fireball) {
    add(
      "fireballs",
      fireball.night,
      `${counted(fireball.count, "fireball", "fireballs")} in JPL's log in ${span}. ${onDay(fireball.time)}, ${oneOf(fireball.count)} lit up the sky at ${timeIn(zone, fireball.time)}.`,
    );
  }
  if (venus && venusSignChanges > 0) {
    const standing = dignityPhrase("Venus", venus.sign);
    add(
      "venus",
      venus.night,
      `Venus changed sign ${times(venusSignChanges)} in ${span}. ${onDay(venus.time)}, she entered ${venus.sign}${standing === "a neutral sign" ? "" : `, where she's ${standing}`}.`,
    );
  }
  // A curated photo for Surprise facts only (7.3), on the first night you listened while it was taken.
  for (const p of SPACE_PHOTOS) {
    if (p.showOn !== "fact") continue;
    const heard = r.nights.find(([n]) => nightName(n) >= p.taken.from && nightName(n) <= p.taken.to);
    if (!heard) continue;
    out.push({
      id: `fact:photo:${p.nasaId}`,
      kind: "fact",
      date: nightName(heard[0]),
      text: p.caption,
      photo: { url: p.image, credit: p.credit, caption: p.caption },
    });
  }
  return out;
}

/* ---- Surprise me ---------------------------------------------------------- */

export type SurpriseItem =
  | { id: string; kind: "song"; songId: string }
  | { id: string; kind: "night"; date: string }
  | FactItem;

/**
 * The Surprise me pool (7.5): every song card with a highlight chip, every
 * wild night, then the facts. An item's id stays the same from one load to
 * the next, so the client can avoid showing one twice in a row.
 */
export function surprisePool(record: ListenerRecord): SurpriseItem[] {
  const songs: SurpriseItem[] = [];
  const seen = new Set<string>();
  for (const s of [...record.songs.row, ...record.songs.listed]) {
    if (!s.highlight || seen.has(s.songId)) continue;
    seen.add(s.songId);
    songs.push({ id: `song:${s.songId}`, kind: "song", songId: s.songId });
  }
  const nights: SurpriseItem[] = record.wild.map((w) => ({ id: `night:${nightName(w.night)}`, kind: "night", date: nightName(w.night) }));
  return [...songs, ...nights, ...factItems(record)];
}
