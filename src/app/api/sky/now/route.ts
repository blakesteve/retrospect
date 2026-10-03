import { NextResponse } from "next/server";
import { QUESTIONS } from "@/lib/answers/questions";
import { dateIn, timeIn } from "@/lib/listener/words";
import { readNasaLog } from "@/lib/space/compact";
import { latestEpic } from "@/lib/space/latestEpic";
import { refreshNasaAfter } from "@/lib/space/refresh";
import { comingUp } from "@/lib/sky/comingUp";
import { skyAt } from "@/lib/sky/sky";
import { tonightSky } from "@/lib/sky/tonight";
import { requestZone, zoneClock } from "@/lib/zone";

export const dynamic = "force-dynamic";

/**
 * GET /api/sky/now?tz=America/Chicago: the sky right now (spec 7.4), the
 * questions whose condition holds now (7 and 8 by tonight's night so far:
 * a storm reading or an X-flare peak since 4 a.m.), and "coming up": the
 * next 45 days, at most 6, each with its date and time in the zone.
 *
 * Plus the top of Tonight (8.4), every sentence built here: the heading, the
 * time line, the Moon's line, up to three sky chips, each planet's words,
 * mutual receptions, the latest photo of Earth from the last 3 days (null
 * without one, or when NASA's data can't be read), and the "none overhead"
 * line when no question's sky holds.
 */
export async function GET(req: Request) {
  try {
    const { zone, fellBack } = requestZone(new URL(req.url).searchParams);
    const now = Math.floor(Date.now() / 1000);
    const sky = skyAt(new Date(now * 1000));
    const clock = zoneClock(zone, now);
    const tonightFrom = clock.nightStart(clock.nightOf(now));

    const [nasa, epic] = await Promise.all([readNasaLog().catch(() => null), latestEpic(zone, now)]);
    refreshNasaAfter(nasa);
    const held = new Set<string>(sky.conditions);
    if (nasa?.kp.some(([s, e]) => e >= tonightFrom && s <= now)) held.add("storms");
    if (nasa?.xflares.some(([peak]) => peak >= tonightFrom && peak <= now)) held.add("flares");
    const questionsHeld = QUESTIONS.map((q) => q.id).filter((id) => held.has(id));

    return NextResponse.json({
      zone,
      zoneFellBack: fellBack,
      sky,
      questionsHeld,
      nasa: nasa ? "ok" : "unavailable",
      comingUp: comingUp(now).map((i) => ({ ...i, date: dateIn(zone, i.time), at: timeIn(zone, i.time) })),
      ...tonightSky({ now, zone, sky, questionsHeld, nasaLoaded: nasa !== null }),
      epic,
    });
  } catch (err) {
    console.error("[retrospect] route failure:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "server" }, { status: 500 });
  }
}
