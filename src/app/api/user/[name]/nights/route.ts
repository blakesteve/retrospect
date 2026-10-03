import { NextResponse } from "next/server";
import { QUESTIONS } from "@/lib/answers/questions";
import { guarded, loadListener } from "@/lib/listener/serve";
import { conditionNotes, moonAt, nightChanges, ninePm, skyNights } from "@/lib/listener/skyNights";
import { spaceNights, zoneLongitude } from "@/lib/listener/spaceNights";
import { sunMonths, sunsByNight } from "@/lib/listener/tonightCards";
import { aboutMeters, dateIn, lunarDistanceWords, timeIn } from "@/lib/listener/words";
import { type FilterId } from "@/lib/listener/record";
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
 * ended that night), the filters it lights, its wild title, its genre mix,
 * and NASA's facts with the night's photos. Plus the filter counts for the
 * whole history.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return guarded(async () => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!MONTH.test(from) || !MONTH.test(to) || from > to || monthsBetween(from, to).length > MAX_MONTHS) {
      return NextResponse.json({ error: `from and to must be months (YYYY-MM), at most ${MAX_MONTHS} apart` }, { status: 400 });
    }
    const loaded = await loadListener(req, (await params).name);
    if (loaded.kind === "response") return loaded.response;
    const { record, status, zone, zoneFellBack, nasa } = loaded;

    const clock = zoneClock(zone, record.historyStart, record.historyEnd);
    const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
    const [ty, tm] = to.split("-").map(Number);
    const first = Math.max(day(`${from}-01`), clock.nightOf(record.historyStart));
    const last = Math.min(Math.round(Date.UTC(ty, tm, 1) / 86_400_000) - 1, clock.nightOf(Date.now() / 1000));
    const base = {
      status,
      zone,
      zoneFellBack,
      filterCounts: record.filterCounts,
      genreCounts: record.genreCounts,
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
        wild: w ? { rank: w.rank, title: w.title, story: w.story } : null,
        genres: record.mixes[n] ?? [],
        // The listed genres it lights in "Your genres" (3 plays or more), 8.5.
        genreFilters: record.genreHits[n] ?? [],
        space: {
          known: s.known,
          kp: s.kp,
          stormGrade: s.stormGrade,
          stormLine:
            s.kp !== null
              ? `${kpLabel(s.kp)}: a ${s.stormGrade ?? "minor"} storm${s.stormGrade === "G5" ? ", the top of the scale" : ""}`
              : s.known.storms
                ? "No storm in NASA's log that night"
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
            date < FIRST_DATES.sdo && (s.kp !== null || s.xFlare) && !photos.some((p) => p.kind === "sdo")
              ? "NASA's daily Sun photos start in 2016."
              : null,
        },
      });
    }
    return NextResponse.json({ ...base, nights });
  });
}
