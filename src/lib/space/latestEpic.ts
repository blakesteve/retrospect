import { zoneLongitude } from "@/lib/listener/spaceNights";
import { dateIn } from "@/lib/listener/words";
import { zoneClock } from "@/lib/zone";
import { monthsBetween, readMonths, type EpicDay } from "./store";

/**
 * Tonight's photo of Earth (spec 8.4): the latest EPIC image from the last 3
 * days, read from the stored month files (7.3). NASA posts EPIC a day or two
 * late and has had long gaps (most of mid-July to October 2025), so nothing
 * that recent is null and the horizon is left out. SERVER ONLY.
 */

const DAY = 86_400;

/** How far back tonight's photo of Earth may be. */
export const EPIC_RECENT_DAYS = 3;

export interface LatestEpic {
  url: string;
  /** When it was taken, in the listener's zone: "Sept 30". */
  date: string;
  /** "Earth on Sept 30, from a million miles out" */
  line: string;
  credit: string;
}

type EpicImage = EpicDay["images"][number];

const monthOfUts = (uts: number) => new Date(uts * 1000).toISOString().slice(0, 7);

const angle = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Of the images taken in the 3 days up to `now`, the latest day's, and of
 * that day's, the one whose centroid longitude is nearest the zone's (7.3,
 * as the nights route picks a night's). Null when there's none, and null
 * when the store can't be read: the sky still shows without it.
 */
export async function latestEpic(zone: string, now: number): Promise<LatestEpic | null> {
  try {
    const from = now - EPIC_RECENT_DAYS * DAY;
    const files = await readMonths("epic", monthsBetween(monthOfUts(from), monthOfUts(now)));
    const byDate = new Map<string, EpicImage[]>();
    for (const file of files.values()) {
      for (const day of file.records) {
        for (const image of day.images) {
          const t = Date.parse(image.time) / 1000;
          if (!(t >= from && t <= now)) continue;
          byDate.set(day.date, [...(byDate.get(day.date) ?? []), image]);
        }
      }
    }
    const latest = [...byDate.keys()].sort().at(-1);
    if (!latest) return null;
    const longitude = zoneLongitude(zoneClock(zone, now), new Date(now * 1000).getUTCFullYear());
    const best = byDate.get(latest)!.reduce((a, b) => (angle(b.lon, longitude) < angle(a.lon, longitude) ? b : a));
    const [y, m, d] = latest.split("-");
    const date = dateIn(zone, Date.parse(best.time) / 1000).replace(/, \d{4}$/, "");
    return {
      url: `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${best.name}.jpg`,
      date,
      line: `Earth on ${date}, from a million miles out`,
      credit: "NASA EPIC team",
    };
  } catch (err) {
    console.warn("[retrospect] tonight's EPIC photo didn't load:", err);
    return null;
  }
}
