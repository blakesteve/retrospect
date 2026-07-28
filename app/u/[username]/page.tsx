import type { Metadata } from "next";
import { Suspense } from "react";
import { Report } from "@/components/Report";
import { Wordmark } from "@/components/Wordmark";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  return {
    title: `${name} · Retrospect`,
    description: `Is ${name}'s music nostalgia ruled by Mercury retrograde? The data has opinions.`,
    openGraph: {
      images: [`/api/og?u=${encodeURIComponent(name)}`],
    },
  };
}

export default async function UserPage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-12">
      <nav className="mb-10">
        <Wordmark />
      </nav>
      <Suspense fallback={null}>
        <Report username={name} />
      </Suspense>
    </main>
  );
}
