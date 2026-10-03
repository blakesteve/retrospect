import { NextResponse } from "next/server";
import { QUESTIONS } from "@/lib/answers/questions";
import { guarded, loadListener } from "@/lib/listener/serve";
import { conditionNotes, moonAt, nightChanges, ninePm, skyNights } from "@/lib/listener/skyNights";
import { spaceNights, zoneLongitude } from "@/lib/listener/spaceNights";
import { sunMonths, sunsByNight } from "@/lib/listener/tonightCards";
import { aboutMeters, dateIn, lunarDistanceWords, timeIn } from "@/lib/listener/words";
import { FILTERS, nightsByMonth, type FilterId } from "@/lib/listener/record";
import { kpLabel } from "@/lib/space/kp";
import { FIRST_DATES } from "@/lib/space/sources";
import { SPACE_PHOTOS } from "@/lib/space/curated";
import { monthsBetween, readMonths } from "@/lib/space/store";
import { nightName, nightWeekday, zoneClock } from "@/lib/zone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A request covers at most a year: 20 years is 7,300 nights (7.4). */
const MAX_MONTHS = 12;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * GET /api/user/:name/nights?from=2024-01&to=2024-12&tz=America/Chicago:
 * every night of those months in the listener's history, up to tonight
 * (spec 7.4, 8.5, 8.7.2). Each night: its plays against the usual for its
 * weekday, after-midnight plays, the songs first heard (with pairings), the
 * Moon at 9 p.m., every sign change and station during the night with its
 * time, the questions whose condition held (with when, for one that began or
 * ended that night), the filters it lights, its wild title (with whether the
 * zone saw its eclipse, which ranks it, 7.5), its genre mix, and NASA's facts
 * with the night's photos. Plus, on every request: the history's first night
 * in the zone, and whether NASA's log read ("unavailable" hides its filters,
 * 8.5). With counts=1, each filter's and genre's lit nights over the whole
 * history, in all and per month: the calendar asks once a visit, with its
 * first year, never with every year (8.5).
 *
 * GET /api/user/:name/nights?filter=storm&genre=shoegaze&tz=America/Chicago,
 * with no months: the nights one sky filter and one listed genre light
 * together (8.5, 7.6), over the whole history, in all and per month.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const url = new URL(req.url);
    const has = (key: string) => url.searchParams.has(key);
    if (has("filter") || has("genre")) return filterWithGenre(req, (await params).name, url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!MONTH.test(from) || !MONTH.test(to) || from > to || monthsBetween(from, to).length > MAX_MONTHS) {
      return NextResponse.json({ error: `from and to must be months (YYYY-MM), at most ${MAX_MONTHS} apart` }, { status: 400 });
    }
    const counts = url.searchParams.get("counts");
    if (counts !== null && counts !== "1") return NextResponse.json({ error: "counts must be 1, or left out" }, { status: 400 });
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack, nasa } = loaded;

    const clock = zoneClock(zone, record.historyStart, record.historyEnd);
    const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
    const [ty, tm] = to.split("-").map(Number);
    const first = Math.max(day(`${from}-01`), clock.nightOf(record.historyStart));
    const tonight = clock.nightOf(Date.now() / 1000);
    const last = Math.min(Math.round(Date.UTC(ty, tm, 1) / 86_400_000) - 1, tonight);
    const base = {
      status,
      zone,
      zoneFellBack,
      // The history's first night, so the calendar needn't infer it. Null
      // only when every play is noise.
      first: record.plays > 0 ? nightName(clock.nightOf(record.historyStart)) : null,
      // As sky/now says it: the log didn't read, or isn't whole yet.
      nasa: nasa ? ("ok" as const) : ("unavailable" as const),
      ...(counts === "1" && {
        filterCounts: record.filterCounts,
        // A version 3 record, served while it's rebuilt, has no months yet:
        // null, which the page reads as not known, never as nothing lit.
        filterMonths: record.filterMonths ?? null,
        genreCounts: record.genreCounts,
        genreMonths: record.genreMonths ?? null,
      }),
    };
    if (last < first) return NextResponse.json({ ...base, nights: [] });

    const sky = skyNights(clock, first, last);
    const changes = nightChanges(clock, first, last, Date.now() / 1000);
    const notes = conditionNotes(clock, first, last);
    const space = await spaceNights(clock, first, last, nasa, {
      allFlares: true,
      epic: true,
      longitude: zoneLongitude(clock, Number(from.slice(0, 4))),
    });
    // SDO's Sun, for the gallery on a storm or flare night (8.7.1), by the night it was taken in.
    const sun = sunsByNight((await readMonths("sdo", sunMonths(clock, first, last))).values(), clock, nasa);
    const tally = new Map(record.nights.map(([n, plays, after]) => [n, { plays, after }]));
    const wild = new Map(record.wild.map((w) => [w.night, w]));
    const songs = new Map(record.songs.listed.map((s) => [s.songId, s]));

    const nights = [];
    for (let n = first; n <= last; n++) {
      const t = tally.get(n);
      const s = space.get(n)!;
      const date = nightName(n);
      const eclipse = sky.eclipse.get(n) ?? null;
      const held = new Set<string>();
      for (const [id, set] of sky.conditions) if (set.has(n)) held.add(id);
      if (s.known.storms && s.kp !== null) held.add("storms");
      if (s.known.flares && s.xFlare) held.add("flares");
      const filters: FilterId[] = [];
      if (t) {
        if (s.kp !== null) filters.push("storm");
        if (s.xFlare) filters.push("xflare");
        if (eclipse) filters.push("eclipse");
        if (sky.fullMoon.has(n)) filters.push("fullmoon");
        if (sky.newMoon.has(n)) filters.push("newmoon");
        if (record.firstPlays[n]) filters.push("firstplay");
        if (wild.has(n)) filters.push("wild");
        if (held.has("venushome")) filters.push("venushome");
        if (sky.marsHome.has(n)) filters.push("marshome");
        if (held.has("moonstrong")) filters.push("moonstrong");
        if (s.asteroid && s.asteroid.ld < 1) filters.push("asteroid");
        if (s.fireballs.length) filters.push("fireball");
      }
      const w = wild.get(n);
      const photos = [
        ...SPACE_PHOTOS.filter((p) => p.showOn === "night" && p.eventAt && clock.nightOf(Date.parse(p.eventAt) / 1000) === n).map((p) => ({
          kind: "curated" as const,
          url: p.image,
          page: p.page,
          caption: p.caption,
          credit: p.credit,
        })),
        ...(sun.has(n) && (s.kp !== null || s.xFlare)
          ? [
              {
                kind: "sdo" as const,
                url: sun.get(n)!.url,
                page: null,
                // Every caption says when it was taken (7.3).
                caption: `The Sun at ${timeIn(zone, sun.get(n)!.time)} on ${dateIn(zone, sun.get(n)!.time)}, from NASA's Solar Dynamics Observatory.`,
                credit: "NASA/SDO and the AIA science team",
              },
            ]
          : []),
      ];
      nights.push({
        date,
        plays: t?.plays ?? 0,
        afterMidnight: t?.after ?? 0,
        usualForWeekday: record.usual[nightWeekday(n)],
        firstPlays: (record.firstPlays[n] ?? []).map((id) => {
          const song = songs.get(id)!;
          return { songId: id, artist: song.artist, track: song.track, pairing: song.pairing };
        }),
        moon: moonAt(ninePm(clock, n)),
        changes: changes.get(n) ?? [],
        eclipse,
        conditions: QUESTIONS.map((q) => q.id).filter((id) => held.has(id)),
        // A condition that began or ended inside the night says when (8.7.2).
        conditionNotes: notes.get(n) ?? {},
        filters,
        // Whether the zone saw its eclipse ranks it (7.5); a version 2 record's missing flag reads as seen.
        wild: w ? { rank: w.rank, visible: w.visible ?? true, title: w.title, story: w.story } : null,
        genres: record.mixes[n] ?? [],
        // The listed genres it lights in "Your genres" (3 plays or more), 8.5.
        genreFilters: record.genreHits[n] ?? [],
        space: {
          known: s.known,
          kp: s.kp,
          // "Kp 6-", as NOAA writes it, for a door's name (11).
          kpText: s.kp !== null ? kpLabel(s.kp) : null,
          stormGrade: s.stormGrade,
          stormLine:
            s.kp !== null
              ? `${kpLabel(s.kp)}: a ${s.stormGrade ?? "minor"} storm${s.stormGrade === "G5" ? ", the top of the scale" : ""}`
              : s.known.storms
                ? // Tonight's sheet says "tonight" where a past night says "that night" (8.7.2).
                  `No storm in NASA's log ${n === tonight ? "tonight" : "that night"}`
                : null,
          biggestFlare: s.biggestFlare,
          xFlare: s.xFlare,
          asteroid: s.asteroid
            ? {
                ...s.asteroid,
                line: [
                  s.asteroid.name,
                  lunarDistanceWords(s.asteroid.ld),
                  s.asteroid.meters === null ? null : `${aboutMeters(s.asteroid.meters)} wide`,
                  `closest at ${timeIn(zone, s.asteroid.time)}`,
                ]
                  .filter(Boolean)
                  .join(", "),
              }
            : null,
          fireballs: s.fireballs.map((f) => ({ ...f, at: timeIn(zone, f.time) })),
          epic: s.epic,
          photos,
          // SDO's coverage (7.3; architect, 2 Oct 2026): before its browse
          // archive, a storm or flare night says why there's no Sun; after
          // it, a night without one shows none and says nothing. Dec 31,
          // 2015's storm night west of Greenwich has one anyway, taken just
          // after midnight UTC, and needs no note.
          sunNote:
            date < FIRST_DATES.sdo && (s.kp !== null || s.xFlare) && !photos.some((p) => p.kind === "sdo") ? "NASA's daily Sun photos start in 2016." : null,
        },
      });
    }
    return NextResponse.json({ ...base, nights });
  });
}

/**
 * One sky filter and one listed genre together (8.5, 7.6): the nights you
 * listened on that the filter lights and that held 3 plays or more of the
 * genre (the nights `genreFilters` names), from the record's per-filter
 * nights and `genreHits`.
 */
async function filterWithGenre(req: Request, name: string, url: URL): Promise<NextResponse> {
  const filter = url.searchParams.get("filter") ?? "";
  const genre = url.searchParams.get("genre") ?? "";
  if (url.searchParams.has("from") || url.searchParams.has("to")) {
    return NextResponse.json({ error: "Ask for months (from and to) or for a filter with a genre, not both" }, { status: 400 });
  }
  if (url.searchParams.has("counts")) {
    return NextResponse.json({ error: "counts comes with a year's months, not with a filter and a genre" }, { status: 400 });
  }
  if (!(FILTERS as readonly string[]).includes(filter)) {
    return NextResponse.json({ error: `filter must be one of ${FILTERS.join(", ")}` }, { status: 400 });
  }
  const loaded = await loadListener(req, name);
  if (loaded.kind === "response") return loaded.response;
  const { record, status, zone, zoneFellBack } = loaded;
  if (!Object.hasOwn(record.genreCounts, genre)) {
    return NextResponse.json({ error: "genre must be one of your listed genres (genreCounts)" }, { status: 400 });
  }
  // A version 3 record, served while it's rebuilt, keeps no per-filter nights.
  if (!record.filterNights) return NextResponse.json({ status: "computing", zone, zoneFellBack });
  const nights = record.filterNights[filter as FilterId].filter((n) => record.genreHits[n]?.includes(genre));
  return NextResponse.json({ status, zone, zoneFellBack, filter, genre, count: nights.length, months: nightsByMonth(nights) });
}
