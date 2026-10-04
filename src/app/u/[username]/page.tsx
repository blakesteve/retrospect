import type { Metadata } from "next";
import { Tonight } from "@/components/listener/Tonight";
import { cardFromPage, cardImage } from "@/lib/share/card";

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  const query = await searchParams;
  // A shared link (`?song=`, `?night=` or `?q=`, with the sharer's `tz`)
  // unfurls as that card, in that zone (8.7.5, 7.1); the page alone, as the
  // listener's generic card.
  const tz = typeof query.tz === "string" ? query.tz : "UTC";
  return {
    title: `${name} · Retrospect`,
    description: `The sky behind ${name}'s Last.fm history, and an honest answer to whether any of it moved them.`,
    openGraph: {
      images: [cardImage(name, cardFromPage(query), tz)],
    },
  };
}

/** Tonight (spec 8.4), inside the listener shell from the layout. */
export default function TonightPage() {
  return <Tonight />;
}
