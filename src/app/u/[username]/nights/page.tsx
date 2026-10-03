import type { Metadata } from "next";
import { EveryNight } from "@/components/listener/EveryNight";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return {
    title: `Every night · ${name} · Retrospect`,
    description: `Every night of ${name}'s Last.fm history under its sky: the Moon, the storms and the songs first heard.`,
    openGraph: {
      images: [`/api/og?u=${encodeURIComponent(name)}`],
    },
  };
}

/** Every night (spec 8.5), inside the listener shell from the layout. */
export default function EveryNightPage() {
  return <EveryNight />;
}
