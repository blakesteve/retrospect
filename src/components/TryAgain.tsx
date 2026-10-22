"use client";

import { Button } from "@blakesteve/roster";

/** The error page's Try again, loaded only when that page draws (error.tsx). */
export default function TryAgain({ onClick }: { onClick: () => void }) {
  return (
    <Button size="lg" onClick={onClick}>
      Try again
    </Button>
  );
}
