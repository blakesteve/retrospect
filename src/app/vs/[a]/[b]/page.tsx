import { Suspense } from "react";
import type { Metadata } from "next";
import { Compare } from "@/components/compare/Compare";
import { Wordmark } from "@/components/Wordmark";

interface Props {
  params: Promise<{ a: string; b: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { a, b } = await params;
  const ua = decodeURIComponent(a);
  const ub = decodeURIComponent(b);
  return {
    title: `${ua} and ${ub} · Retrospect`,
    description: `Same sky, different people: ${ua} and ${ub} on the same 12 questions about the sky and their listening.`,
    // Compare unfurls as the generic card, with no one's name or answers (8.7.5).
    openGraph: { images: ["/api/og"] },
  };
}

/** Compare (spec 8.8), at the duel's old URL so its links still open. */
export default async function ComparePage({ params }: Props) {
  const { a, b } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <nav className="mb-8">
        <Wordmark />
      </nav>
      {/* The compare sheet is a URL (`?q=`), read with useSearchParams. */}
      <Suspense fallback={null}>
        <Compare a={decodeURIComponent(a)} b={decodeURIComponent(b)} />
      </Suspense>
    </main>
  );
}
