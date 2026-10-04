import type { Metadata } from "next";
import { SkyView } from "@/components/listener/SkyView";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return {
    title: `Sky · ${name} · Retrospect`,
    description: `${name}'s Last.fm history on the real sky: the planets on every night, and their songs as stars.`,
    openGraph: {
      images: [`/api/og?u=${encodeURIComponent(name)}`],
    },
  };
}

/** Sky (spec 8.6), inside the listener shell from the layout. */
export default function SkyPage() {
  return <SkyView />;
}
