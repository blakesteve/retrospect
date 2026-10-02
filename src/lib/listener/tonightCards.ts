import type { NasaLog } from "@/lib/space/compact";
import { SPACE_PHOTOS } from "@/lib/space/curated";
import { kpLabel, stormGrade } from "@/lib/space/kp";
import { readMonths } from "@/lib/space/store";
import { dignityPhrase, type Sign } from "@/lib/sky/sky";
import { signWindows } from "@/lib/sky/windows";
import { nightName, nightWeekday, zoneClock, type ZoneClock } from "@/lib/zone";
import type { WildNight } from "./highlights";
import type { ListenerRecord } from "./record";
import { kickerDate, lengthWords, WEEKDAYS, wildCardLine } from "./sentences";
import { flareSize, spaceNights, zoneLongitude, type SpaceNight } from "./spaceNights";
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

/** SDO's Sun for a day, as the fill stored it. */
export interface SunPhoto {
  url: string;
  time: number;
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
 */
export async function firstPhotos(clock: ZoneClock, nights: number[], nasa: NasaLog | null): Promise<Map<number, CardPhoto | null>> {
  const out = new Map<number, CardPhoto | null>();
  if (nights.length === 0) return out;
  const year = (n: number) => Number(nightName(n).slice(0, 4));
  const [sdo, spaces] = await Promise.all([
    readMonths("sdo", [...new Set(nights.map((n) => nightName(n).slice(0, 7)))]),
    Promise.all(nights.map((n) => spaceNights(clock, n, n, nasa, { epic: true, longitude: zoneLongitude(clock, year(n)) }))),
  ]);
  const sun = new Map<string, SunPhoto>();
  for (const file of sdo.values()) {
    for (const d of file.records) if (d.url) sun.set(d.date, { url: d.url, time: Date.parse(d.time) / 1000 });
  }
  nights.forEach((n, i) => out.set(n, nightGallery(n, spaces[i].get(n), sun.get(nightName(n)), clock)[0] ?? null));
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
