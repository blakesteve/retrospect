"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input } from "@blakesteve/roster";

export function VersusForm() {
  const router = useRouter();
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  /* `size="sm"` on the fields and on the Fight button is the height match —
     the same trick as the front door, one size down. The surface, hairline and
     gold focus all come from `--roster-control-*`, so the only thing left to
     say by hand is the placeholder ink. */
  const fieldProps = {
    variant: "outline",
    size: "sm",
    className: "flex-1 min-w-0",
    inputClassName: "placeholder:text-ink-3",
  } as const;

  return (
    <form
      className="mt-10 flex flex-col items-center gap-2 w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const ua = a.trim();
        const ub = b.trim();
        if (ua && ub) {
          router.push(`/vs/${encodeURIComponent(ua)}/${encodeURIComponent(ub)}`);
        }
      }}
    >
      <p className="text-ink-3 text-xs uppercase tracking-[0.2em]">
        Or settle it: whose sky is stronger?
      </p>
      <div className="flex w-full items-center gap-2">
        <Input
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder="you"
          aria-label="First Last.fm username"
          {...fieldProps}
        />
        <span className="text-gold font-display">vs</span>
        <Input
          value={b}
          onChange={(e) => setB(e.target.value)}
          placeholder="your rival"
          aria-label="Second Last.fm username"
          {...fieldProps}
        />
        <Button type="submit" colorScheme="primary" variant="outline" size="sm">
          Fight
        </Button>
      </div>
    </form>
  );
}
