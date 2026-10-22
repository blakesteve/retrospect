"use client";

import { useEffect } from "react";
import { Trouble } from "./error";
import "./globals.css";

/* The root layout itself failed, so this draws the whole document in its
   place: the layout's classes, the app's styles and error.tsx's words. No
   Try again: drawing the same layout again fails the same way, and the link
   back is a full load. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>Something went wrong · Retrospect</title>
        <Trouble />
      </body>
    </html>
  );
}
