"use client";

import { useEffect } from "react";
import { BirthChartPanel } from "@/components/BirthChartPanel";
import { NATAL_EVENT } from "@/lib/client/natalStore";
import type { SheetBodyProps } from "../SheetHost";

/* "Add your birth chart" (spec 8.6 item 5): today's panel in a sheet. Its
   math loads with it (13). Saving tells the Sky wheel, which draws the
   natal planets just inside the sign ring. Nothing about a birth leaves
   this browser. */

export default function ChartSheet({ setTitle, setBusy }: SheetBodyProps) {
  useEffect(() => {
    setTitle("Your birth chart");
    setBusy(false);
  }, [setTitle, setBusy]);
  return (
    <div>
      <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
        Your Sun, Moon, Mercury, Venus and Mars at the minute you were born, and your rising sign if you add a place. Worked out in this browser and kept only
        here: nothing about your birth is sent anywhere.
      </p>
      <BirthChartPanel onChart={() => window.dispatchEvent(new Event(NATAL_EVENT))} />
    </div>
  );
}
