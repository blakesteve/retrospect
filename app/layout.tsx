import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"),
  title: "Retrospect — Your Music Taste vs. the Actual Sky",
  description:
    "Retrospect turns your Last.fm history into a music horoscope backed by real math. Does Mercury retrograde change what you play? Find out, with proof.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* Matches the other apps on the account: page views only, no cookies,
            and it no-ops off Vercel so local runs stay quiet. */}
        <Analytics />
      </body>
    </html>
  );
}
