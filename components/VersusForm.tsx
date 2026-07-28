"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@blakesteve/roster";

export function VersusForm() {
  const router = useRouter();
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  const inputCls =
    "flex-1 min-w-0 rounded-md bg-surface-1 border border-[var(--hairline)] px-3 py-2 " +
    "text-ink text-sm placeholder:text-ink-3 outline-none focus:border-gold transition-colors";

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
        <input value={a} onChange={(e) => setA(e.target.value)} placeholder="you" aria-label="First Last.fm username" className={inputCls} />
        <span className="text-gold font-display">vs</span>
        <input value={b} onChange={(e) => setB(e.target.value)} placeholder="your rival" aria-label="Second Last.fm username" className={inputCls} />
        <Button type="submit" colorScheme="primary" variant="outline" size="sm">
          Fight
        </Button>
      </div>
    </form>
  );
}
