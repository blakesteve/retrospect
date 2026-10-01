import { NextResponse } from "next/server";
import { fetchApodDay } from "@/lib/space/sources";
import { readMonth, type ApodDay } from "@/lib/space/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/apod?date=YYYY-MM-DD: NASA's Astronomy Picture of the Day for that
 * day, as its title, its credit and a link to the day's page. Never the
 * picture itself (architect, 1 Oct 2026): NASA's new APOD source repeats the
 * credit as the copyright, so a public-domain picture can't be told from
 * someone else's.
 *
 * Read from the stored month (`space/apod/`) when it's there, else asked of
 * science.nasa.gov once and kept in memory. The old api.nasa.gov APOD already
 * returned "NASA Science" and NASA's logo for every date, and is archived on
 * 1 Dec 2026.
 */

type ApodResult = ApodDay & { requestedDate: string };

/* What each date found, and until when to trust it. A day found, or missed
   long ago, holds for the process; a miss on today or yesterday (maybe not
   posted yet) for 10 minutes; a failure for a minute. So no request makes
   more than one call to NASA a minute for any date, and the map can't
   outgrow the dates APOD has. */
const cache = new Map<string, { result: ApodResult | null | "unreachable"; until: number }>();
const MINUTE = 60_000;

const notFound = () => NextResponse.json({ error: "no picture that day" }, { status: 404 });
const answer = (result: ApodResult | null | "unreachable") =>
  result === "unreachable"
    ? NextResponse.json({ error: "NASA unreachable" }, { status: 502 })
    : result
      ? NextResponse.json(result)
      : notFound();

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  // A real calendar date: Date.parse takes Feb 31 and rolls it over.
  const t = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const real = Number.isFinite(t) && new Date(t).toISOString().startsWith(date);
  if (!real) return NextResponse.json({ error: "date must be a real YYYY-MM-DD" }, { status: 400 });
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (date < "1995-06-16" || date > today) return notFound();
  const hit = cache.get(date);
  if (hit && hit.until > now) return answer(hit.result);

  let result: ApodResult | null | "unreachable";
  try {
    const stored = (await readMonth("apod", date.slice(0, 7)))?.records.find((d) => d.date === date);
    const day = stored ?? (await fetchApodDay(date));
    result = day ? { ...day, requestedDate: date } : null;
  } catch {
    result = "unreachable";
  }
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const until =
    result === "unreachable" ? now + MINUTE : result || date < yesterday ? Infinity : now + 10 * MINUTE;
  cache.set(date, { result, until });
  return answer(result);
}
