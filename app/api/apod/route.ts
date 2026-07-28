import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/apod?date=YYYY-MM-DD
 *
 * NASA's Astronomy Picture of the Day, with two mercies the raw API lacks:
 * the image URL is verified to actually load (video days often carry dead
 * decade-old thumbnails), and if the requested day is a dud we walk to the
 * nearest day with a working picture (±2 days). Responses cached in memory.
 * Works with DEMO_KEY (30 req/hr); set NASA_API_KEY for a real one.
 */
const cache = new Map<string, ApodResult | null>();

interface ApodResult {
  /** The day whose picture this actually is. */
  date: string;
  /** The day originally asked for. */
  requestedDate: string;
  title: string;
  imageUrl: string;
  explanation: string | null;
  copyright: string | null;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchDay(date: string, key: string): Promise<Omit<ApodResult, "requestedDate"> | null> {
  const nasa = new URL("https://api.nasa.gov/planetary/apod");
  nasa.search = new URLSearchParams({ api_key: key, date, thumbs: "true" }).toString();
  const res = await fetch(nasa, { cache: "no-store" });
  if (!res.ok) return null;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const json: any = await res.json();
  const imageUrl: string | null =
    json.media_type === "image" ? (json.url ?? null) : (json.thumbnail_url ?? null);
  if (!imageUrl) return null;

  // Verify the image actually resolves — dead thumbnails are common.
  try {
    const head = await fetch(imageUrl, { method: "HEAD", cache: "no-store" });
    if (!head.ok) return null;
  } catch {
    return null;
  }

  const explanation: string | null =
    typeof json.explanation === "string"
      ? json.explanation.split(/(?<=\.)\s/)[0]?.slice(0, 220) ?? null
      : null;
  return {
    date,
    title: json.title ?? "Astronomy Picture of the Day",
    imageUrl,
    explanation,
    copyright: json.copyright?.trim() ?? null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date < "1995-06-16" || date > today) {
    return NextResponse.json({ error: "date out of APOD range" }, { status: 400 });
  }

  if (cache.has(date)) {
    const hit = cache.get(date);
    return hit
      ? NextResponse.json(hit)
      : NextResponse.json({ error: "no picture available" }, { status: 404 });
  }

  const key = process.env.NASA_API_KEY ?? "DEMO_KEY";
  try {
    for (const offset of [0, -1, 1, -2]) {
      const candidate = shiftDate(date, offset);
      if (candidate < "1995-06-16" || candidate > today) continue;
      const day = await fetchDay(candidate, key);
      if (day) {
        const result: ApodResult = { ...day, requestedDate: date };
        cache.set(date, result);
        return NextResponse.json(result);
      }
    }
    cache.set(date, null);
    return NextResponse.json({ error: "no picture available" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "NASA unreachable" }, { status: 502 });
  }
}
