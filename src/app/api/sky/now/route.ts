import { NextResponse } from "next/server";
import { QUESTIONS } from "@/lib/answers/questions";
import { dateIn, timeIn } from "@/lib/listener/words";
import { readNasaLog } from "@/lib/space/compact";
import { refreshNasaAfter } from "@/lib/space/refresh";
import { comingUp } from "@/lib/sky/comingUp";
import { skyAt } from "@/lib/sky/sky";
import { requestZone, zoneClock } from "@/lib/zone";

export const dynamic = "force-dynamic";

/**
 * GET /api/sky/now?tz=America/Chicago: the sky right now (spec 7.4), the
 * questions whose condition holds now (7 and 8 by tonight's night so far:
 * a storm reading or an X-flare peak since 4 a.m.), and "coming up": the
 * next 45 days, at most 6, each with its date and time in the zone.
 */
export async function GET(req: Request) {
  try {
    const { zone, fellBack } = requestZone(new URL(req.url).searchParams);
    const now = Math.floor(Date.now() / 1000);
    const sky = skyAt(new Date(now * 1000));
    const clock = zoneClock(zone, now);
    const tonightFrom = clock.nightStart(clock.nightOf(now));

    const nasa = await readNasaLog().catch(() => null);
    refreshNasaAfter(nasa);
    const held = new Set<string>(sky.conditions);
    if (nasa?.kp.some(([s, e]) => e >= tonightFrom && s <= now)) held.add("storms");
    if (nasa?.xflares.some(([peak]) => peak >= tonightFrom && peak <= now)) held.add("flares");

    return NextResponse.json({
      zone,
      zoneFellBack: fellBack,
      sky,
      questionsHeld: QUESTIONS.map((q) => q.id).filter((id) => held.has(id)),
      nasa: nasa ? "ok" : "unavailable",
      comingUp: comingUp(now).map((i) => ({ ...i, date: dateIn(zone, i.time), at: timeIn(zone, i.time) })),
    });
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "server" }, { status: 500 });
  }
}
