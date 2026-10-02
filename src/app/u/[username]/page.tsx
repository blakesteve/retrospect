import type { Metadata } from "next";
import { Tonight } from "@/components/listener/Tonight";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return {
    title: `${name} · Retrospect`,
    description: `The sky behind ${name}'s Last.fm history, and an honest answer to whether any of it moved them.`,
    openGraph: {
      images: [`/api/og?u=${encodeURIComponent(name)}`],
    },
  };
}

/** Tonight (spec 8.4), inside the listener shell from the layout. */
export default function TonightPage() {
  return <Tonight />;
}
