import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/user/:name/avatar — the user's Last.fm profile image, if any. */
const cache = new Map<string, string | null>();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey || !username) return NextResponse.json({ imageUrl: null });

  const key = username.toLowerCase();
  if (cache.has(key)) return NextResponse.json({ imageUrl: cache.get(key) });

  try {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.search = new URLSearchParams({
      method: "user.getinfo",
      user: username,
      api_key: apiKey,
      format: "json",
    }).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ imageUrl: null });
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const json: any = await res.json();
    const images: { size: string; ["#text"]: string }[] = json?.user?.image ?? [];
    const best =
      images.find((i) => i.size === "extralarge")?.["#text"] ||
      images.at(-1)?.["#text"] ||
      null;
    const imageUrl = best && best.length > 0 ? best : null;
    cache.set(key, imageUrl);
    return NextResponse.json({ imageUrl });
  } catch {
    return NextResponse.json({ imageUrl: null });
  }
}
