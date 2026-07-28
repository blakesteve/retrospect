import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/art?artist=…&track=…
 *
 * Album art for a track via Last.fm track.getInfo (artist images were removed
 * from the Last.fm API years ago; album art still works). Cached in memory.
 * Returns { imageUrl: string | null } — null is a normal answer, not an error.
 */
const cache = new Map<string, string | null>();

function pickImage(images?: { size: string; ["#text"]: string }[]): string | null {
  if (!images) return null;
  const best =
    images.find((i) => i.size === "extralarge")?.["#text"] ||
    images.find((i) => i.size === "large")?.["#text"] ||
    images.at(-1)?.["#text"] ||
    null;
  return best && best.length > 0 ? best : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const artist = url.searchParams.get("artist")?.trim();
  const track = url.searchParams.get("track")?.trim();
  if (!artist || !track) {
    return NextResponse.json({ error: "artist and track required" }, { status: 400 });
  }
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return NextResponse.json({ imageUrl: null });

  const key = `${artist}|${track}`.toLowerCase();
  if (cache.has(key)) return NextResponse.json({ imageUrl: cache.get(key) });

  try {
    const lastfm = new URL("https://ws.audioscrobbler.com/2.0/");
    lastfm.search = new URLSearchParams({
      method: "track.getInfo",
      artist,
      track,
      api_key: apiKey,
      format: "json",
      autocorrect: "1",
    }).toString();
    const res = await fetch(lastfm, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ imageUrl: null });
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const json: any = await res.json();
    let imageUrl = pickImage(json?.track?.album?.image);

    // No album art (singles, ambient uploads, obscurities)? Fall back to the
    // artist's top album's art — usually close enough to look right.
    if (!imageUrl) {
      const top = new URL("https://ws.audioscrobbler.com/2.0/");
      top.search = new URLSearchParams({
        method: "artist.getTopAlbums",
        artist,
        api_key: apiKey,
        format: "json",
        autocorrect: "1",
        limit: "1",
      }).toString();
      const topRes = await fetch(top, { cache: "no-store" });
      if (topRes.ok) {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const topJson: any = await topRes.json();
        imageUrl = pickImage(topJson?.topalbums?.album?.[0]?.image);
      }
    }

    cache.set(key, imageUrl);
    return NextResponse.json({ imageUrl });
  } catch {
    return NextResponse.json({ imageUrl: null });
  }
}
