import { ImageResponse } from "next/og";
import { cardRef, CARD_SIZES, type CardSize } from "@/lib/share/card";
import { cardData } from "@/lib/share/cardData";
import { requestZone } from "@/lib/zone";
import { cardFonts } from "./cardFonts";
import { Card } from "./cards";

export const dynamic = "force-dynamic";

/**
 * GET /api/og?u={name}&card=song:{id}|night:{YYYY-MM-DD}|q:{id}&tz={zone}&size=tall
 *
 * The share cards (spec 8.7.5): 1200 by 630 for unfurls, 1080 by 1920 with
 * `size=tall` for "Save image". Read from the listener's stored record and
 * stored answers in the zone (the sharer's, which a shared link carries),
 * never computed: with nothing stored, a card the history doesn't hold, or
 * no card asked for, it's the generic card, the username and tonight's Moon.
 * `/vs/` asks for it with no name.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = (url.searchParams.get("u") ?? "").slice(0, 64);
  const ref = cardRef(url.searchParams.get("card"));
  const size: CardSize = url.searchParams.get("size") === "tall" ? "tall" : "wide";
  const { zone } = requestZone(url.searchParams);

  let data;
  try {
    data = await cardData(username, ref, zone);
  } catch (err) {
    // A store that won't read is no reason for a broken image: the generic card.
    console.error("[retrospect] share card data failed:", err);
    data = await cardData("", null, zone);
  }

  return new ImageResponse(<Card data={data} size={size} />, {
    ...CARD_SIZES[size],
    fonts: cardFonts(),
    headers: {
      /* No caching: every use asks again, so a card never outlives the
         history behind it. A removed listener's next unfurl renders the
         generic card, and an expired one's does too. This is the value
         `next/og` already sends in production, written here so the promise
         doesn't rest on a framework default. It isn't the year-long header
         `@vercel/og` sets: `next/og` wraps that response and replaces its
         headers. Vercel's CDN doesn't cache it either (no `s-maxage`).
         Chat apps keep their own copies of an unfurled image, which no
         header here controls. `og.test.ts` pins the value. */
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
