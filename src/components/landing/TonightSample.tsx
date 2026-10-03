"use client";

import { useEffect, useState } from "react";
import { useListener } from "@/components/listener/Shell";
import type { SheetBodyProps } from "@/components/listener/SheetHost";
import { ForYou, useForYouRows } from "@/components/listener/Tonight";
import { namesMoonSign } from "@/lib/client/forYou";
import { MoonDrawing, SkyWheel, WheelKey } from "@/components/listener/sky";

/* The Tonight tile's sample (spec 8.1): the real sky right now, with the
   sample listener's lines, in Tonight's order (8.4). The host opens it once
   the sky has loaded. */

export default function TonightSample({ setBusy }: SheetBodyProps) {
  const L = useListener();
  const sky = L.skyNow.state === "ready" ? L.skyNow.data : null;
  const rows = useForYouRows();
  const [hover, setHover] = useState<readonly string[] | null>(null);
  useEffect(() => setBusy(false), [setBusy]);
  if (!sky) return null;
  const moonLine = sky.moon ? (namesMoonSign(rows) ? (sky.moon.lineNoSign ?? sky.moon.line) : sky.moon.line) : null;
  return (
    <div className="pb-4">
      {sky.heading && <p className="font-display text-[26px] leading-tight text-ink [text-wrap:balance]">{sky.heading}</p>}
      {sky.timeLine && <p className="mt-1 text-[13px] text-ink-2">{sky.timeLine}</p>}
      <div className="mt-4 flex flex-col items-center">
        <SkyWheel
          bodies={sky.sky.bodies}
          size={280}
          className="size-[280px] min-[400px]:size-[300px]"
          onPlanet={(body) => L.open({ kind: "planet", value: body.toLowerCase() })}
          highlight={hover}
        />
        <WheelKey bodies={sky.sky.bodies} className="mt-2" />
      </div>
      <ForYou rows={rows} onHighlight={setHover} />
      {moonLine && (
        <div className="mt-4 flex items-center gap-3">
          <MoonDrawing phaseAngle={sky.sky.moon.phaseAngle} size={40} />
          <p className="text-[14.5px] leading-snug text-ink">{moonLine}</p>
        </div>
      )}
    </div>
  );
}
