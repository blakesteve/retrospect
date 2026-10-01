import { NextResponse } from "next/server";
import { skyAt } from "@/lib/sky/sky";
import { SKY_RANGE } from "@/lib/sky/windows";

export const dynamic = "force-dynamic";

/**
 * GET /api/sky/at?t={unix seconds}: the sky at an instant (spec 7.2, 7.4):
 * each body's sign, degree and minute, dignity and retrograde flag; the
 * Moon's phase, light and sign; the aspects within 3°; and `questionsHeld`,
 * the sky questions whose condition holds then (7 and 8 are NASA's, by
 * night, and come with the nights). A pure function of the instant, so it's
 * cached for good. 2002 through 2035, the sky data's range.
 */
export function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("t") ?? "";
  const t = Number(raw);
  if (!/^\d+$/.test(raw) || t * 1000 < SKY_RANGE.from || t * 1000 >= SKY_RANGE.to) {
    return NextResponse.json({ error: "t must be Unix seconds from 2002 through 2035" }, { status: 400 });
  }
  const sky = skyAt(new Date(t * 1000));
  return NextResponse.json(
    { ...sky, questionsHeld: sky.conditions },
    { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
