"use client";

import { useEffect } from "react";
import { useListener } from "@/components/listener/Shell";
import type { SheetBodyProps } from "@/components/listener/SheetHost";
import { ForYou } from "@/components/listener/Tonight";
import { MoonDrawing, SkyWheel } from "@/components/listener/sky";

/* The Tonight tile's sample (spec 8.1): the real sky right now, with the
   sample listener's lines. The host opens it once the sky has loaded. */

export default function TonightSample({ setBusy }: SheetBodyProps) {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  useEffect(() => setBusy(false), [setBusy]);
  if (!sky) return null;
  return (
    <div className="pb-4">
      {sky.heading && <p className="font-display text-[26px] leading-tight text-ink [text-wrap:balance]">{sky.heading}</p>}
      {sky.timeLine && <p className="mt-1 text-[13px] text-ink-2">{sky.timeLine}</p>}
      <div className="mt-4 flex justify-center">
        <SkyWheel bodies={sky.sky.bodies} size={300} onPlanet={(body) => L.open({ kind: "planet", value: body.toLowerCase() })} />
      </div>
      {sky.moon && (
        <div className="mt-4 flex items-center gap-3">
          <MoonDrawing phaseAngle={sky.sky.moon.phaseAngle} size={40} />
          <p className="text-[14.5px] leading-snug text-ink">{sky.moon.line}</p>
        </div>
      )}
      <ForYou />
    </div>
  );
}
