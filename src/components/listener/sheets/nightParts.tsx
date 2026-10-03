"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Apod } from "@/components/Apod";
import { useListener } from "../Shell";
import { getJson, type Night, type Nights, type SkyAt } from "../api";
import { monthOf, tonightDate } from "../format";
import { loadedYear, yearUrl } from "../nightsCache";
import { Icon, StormMeter, Terms } from "../pieces";
import { FactLabel } from "../cards";
import { Rail } from "../rail";
import { MoonDrawing, phaseName } from "../sky";
import { dateIn, timeIn } from "@/lib/listener/words";

/* What the song and night sheets share: a night's photos, its space weather
   and visitors (8.7.1 item 4, 8.7.2 items 2 and 5). */

/** The sources' documented first days (src/lib/space/sources.ts), copied:
    the client can't import that module. */
const EPIC_FROM = "2015-06-13";
const DONKI_FROM = "2010-04-03";

export type NightLoad = { state: "loading" } | { state: "failed" } | { state: "ready"; night: Night | null; month: Night[] };

/** One night, from its year when Every night has it (`nightsCache.ts`),
    else fetched with its month from the nights route (7.4). */
export function useNight(date: string | null): NightLoad {
  const L = useListener();
  // Keyed by date, so a new date reads as loading without resetting state.
  const [result, setResult] = useState<{ date: string; load: NightLoad } | null>(null);
  const setLoad = (load: NightLoad) => date && setResult({ date, load });
  const year = date ? loadedYear(yearUrl(L, Number(date.slice(0, 4)))) : undefined;
  const cached: NightLoad | null =
    date && year
      ? { state: "ready", night: year.nights.find((n) => n.date === date) ?? null, month: year.nights.filter((n) => n.date.startsWith(monthOf(date))) }
      : null;
  useEffect(() => {
    if (!date || cached) return;
    const ac = new AbortController();
    const m = monthOf(date);
    (async () => {
      for (let i = 0; i < 30; i++) {
        const data = await getJson<Nights>(L.listenerUrl("nights", `&from=${m}&to=${m}`), { signal: ac.signal });
        if (data.status !== "computing") {
          const month = data.nights ?? [];
          setLoad({ state: "ready", night: month.find((n) => n.date === date) ?? null, month });
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("still computing");
    })().catch(() => !ac.signal.aborted && setLoad({ state: "failed" }));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setLoad closes over date; a cached year needs no fetch
  }, [date, L.listenerUrl]);
  if (cached) return cached;
  return result && result.date === date ? result.load : { state: "loading" };
}

/** The sky at an instant (7.2), cached by the browser for good. */
export function useSkyAt(uts: number | null): SkyAt | null | "failed" {
  const [sky, setSky] = useState<{ uts: number; sky: SkyAt | "failed" } | null>(null);
  useEffect(() => {
    if (uts === null) return;
    const ac = new AbortController();
    getJson<SkyAt>(`/api/sky/at?t=${Math.floor(uts)}`, { signal: ac.signal })
      .then((s) => setSky({ uts, sky: s }))
      .catch(() => !ac.signal.aborted && setSky({ uts, sky: "failed" }));
    return () => ac.abort();
  }, [uts]);
  return sky && sky.uts === uts ? sky.sky : null;
}

/** The night's photos: EPIC, then the curated photo, then SDO's Sun (8.7.1).
    None: the drawn sky and the coverage line (7.3, 14). */
export function Gallery({ night }: { night: Night }) {
  const { zone } = useListener();
  const epic = typeof night.space.epic === "object" ? night.space.epic : null;
  const epicAt = epic ? Math.floor(Date.parse(epic.time) / 1000) : 0;
  const photos = [
    ...(epic ? [{ url: epic.url, caption: `Earth from DSCOVR, ${timeIn(zone, epicAt)}, ${dateIn(zone, epicAt)}`, credit: epic.credit }] : []),
    ...night.space.photos.map((p) => ({ url: p.url, caption: p.caption, credit: p.credit })),
  ];
  if (photos.length === 0) {
    // Before EPIC's first day the night is unknown (7.3, 14). After it,
    // "unknown" means the fill hasn't read that day yet: no line, rather
    // than words the spec doesn't have.
    const coverage =
      night.date < EPIC_FROM ? "DSCOVR's photos of Earth start in 2015." : night.space.epic === "none" ? "NASA has no DSCOVR photo for that day." : null;
    return (
      <div className="-mx-5 flex flex-col items-center bg-[var(--deep)] py-6">
        <MoonDrawing phaseAngle={night.moon.phaseAngle} size={96} />
        {coverage && <p className="mt-3 text-[13px] text-ink-2">{coverage}</p>}
        {night.space.sunNote && <p className="mt-1 text-[13px] text-ink-2">{night.space.sunNote}</p>}
        <Terms names={["DSCOVR"]} />
      </div>
    );
  }
  // One photo a view, with "2 of 5" (8.7.1, 12).
  return (
    <>
      <Rail label={night.date === tonightDate(zone) ? "Photos of tonight" : "Photos of that night"} noun="photo" gallery gutter={20}>
        {photos.map((p) => (
          <figure key={p.url}>
            {/* eslint-disable-next-line @next/next/no-img-element -- NASA's own CDN, credited */}
            <img src={p.url} alt={p.caption} loading="lazy" draggable={false} className="aspect-square w-full rounded-2xl bg-[var(--deep)] object-contain" />
            <figcaption className="mt-2 text-[12px] leading-snug text-ink-2">
              {p.caption}
              {p.credit ? ` · ${p.credit}` : ""}
            </figcaption>
          </figure>
        ))}
      </Rail>
      {night.space.sunNote && <p className="mt-2 text-[13px] text-ink-2">{night.space.sunNote}</p>}
    </>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-gold">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-2">{label}</p>
        <div className="mt-1 text-[15px] leading-relaxed text-ink">{children}</div>
      </div>
    </li>
  );
}

/** "Waning gibbous, 95% lit, in Taurus" for a night's Moon at 9 p.m. */
export const moonText = (m: Night["moon"]) => `${phaseName(m.phaseAngle)}, ${Math.round(m.illumination * 100)}% lit, in ${m.sign}`;

/** The Moon, space weather and visitors for a night (8.7.1 item 4). */
export function NightFacts({
  night,
  aspects,
  relativeTo,
  sofar,
}: {
  night: Night;
  aspects?: SkyAt["aspects"];
  /** A first play's moment: fireballs read "about five hours earlier". */
  relativeTo?: number;
  /** Tonight's night says "so far" (8.7.2). */
  sofar?: boolean;
}) {
  const s = night.space;
  const so = sofar ? " so far" : "";
  return (
    <ul className="divide-y divide-[var(--line)]">
      <Fact icon={<MoonDrawing phaseAngle={night.moon.phaseAngle} size={22} />} label="The Moon">
        {moonText(night.moon)}
      </Fact>
      {(s.stormLine || s.kp !== null) && (
        <Fact icon={<Icon name="storm" />} label="Space weather">
          {s.kp !== null && <StormMeter kp={s.kp} />}
          <p className="mt-1">
            {s.stormLine}
            {so}
          </p>
          <Terms names={["Kp", "G1 to G5"]} />
        </Fact>
      )}
      {/* Before NASA's log starts, a night is unknown, never "no storm" (7.3).
          After it, an unknown night means the log didn't load: the line hides (8.4). */}
      {s.known.storms === false && s.stormLine === null && night.date < DONKI_FROM && (
        <Fact icon={<Icon name="storm" />} label="Space weather">
          NASA&rsquo;s storm log starts in 2010.
        </Fact>
      )}
      {s.biggestFlare ? (
        <Fact icon={<Icon name="flare" />} label="Biggest solar flare">
          <FactLabel tone={s.biggestFlare.startsWith("X") ? "var(--flare)" : undefined}>{s.biggestFlare}</FactLabel>
          <Terms names={["Flare classes"]} />
        </Fact>
      ) : (
        s.known.flares && (
          <Fact icon={<Icon name="flare" />} label="Biggest solar flare">
            No flare in NASA&rsquo;s log that night{so}
          </Fact>
        )
      )}
      {s.asteroid && (
        <Fact icon={<Icon name="asteroid" />} label="Nearest asteroid">
          <span className="[&]:break-normal">{s.asteroid.line}</span>
          <Terms names={["Lunar distance"]} />
        </Fact>
      )}
      {s.fireballs.map((fb) => (
        <Fact key={fb.time} icon={<Icon name="fireball" />} label="A fireball">
          {relativeTo !== undefined ? fireballLine(fb.time, relativeTo) : `A fireball lit up the sky at ${fb.at}.`}
        </Fact>
      ))}
      {aspects && aspects.length > 0 && (
        <Fact icon={<Icon name="sparkle" />} label="Angles between them">
          {aspects.map((a) => `${a.a} and ${a.b} in ${a.name}, ${a.off.toFixed(1)}° from exact`).join("; ")}
          <Terms names={["Trine, sextile"]} />
        </Fact>
      )}
      <li className="py-3">
        <Apod date={night.date} />
      </li>
    </ul>
  );
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** "A fireball lit up the sky about five hours earlier." (8.7.1) */
function fireballLine(fbUts: number, at: number): string {
  const hours = Math.round(Math.abs(at - fbUts) / 3600);
  if (hours === 0) return "A fireball lit up the sky within the hour.";
  const n = hours < WORDS.length ? WORDS[hours] : String(hours);
  return `A fireball lit up the sky about ${n} hour${hours === 1 ? "" : "s"} ${fbUts < at ? "earlier" : "later"}.`;
}
