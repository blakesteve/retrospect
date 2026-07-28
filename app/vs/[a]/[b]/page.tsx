import type { Metadata } from "next";
import { Versus } from "@/components/Versus";
import { Wordmark } from "@/components/Wordmark";

interface Props {
  params: Promise<{ a: string; b: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { a, b } = await params;
  const ua = decodeURIComponent(a);
  const ub = decodeURIComponent(b);
  return {
    title: `${ua} vs ${ub} · Retrospect`,
    description: `Whose listening does the sky actually control? ${ua} and ${ub} put five celestial phenomena on trial.`,
  };
}

export default async function VersusPage({ params }: Props) {
  const { a, b } = await params;
  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-12">
      <nav className="mb-10">
        <Wordmark />
      </nav>
      <Versus a={decodeURIComponent(a)} b={decodeURIComponent(b)} />
    </main>
  );
}
