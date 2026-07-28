import { NextResponse } from "next/server";
import { buildReport } from "@/lib/report";
import type { NostalgiaLevel } from "@/lib/analysis/nostalgia";
import { getPhenomenon, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import type { MetricKey } from "@/lib/analysis/metrics";

export const dynamic = "force-dynamic";
// The 2,000-scramble permutation test needs a few seconds per trial on big libraries.
export const maxDuration = 60;

/** GET /api/user/:name/report?threshold=365&level=track */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const username = decodeURIComponent(name).trim();
  const url = new URL(req.url);

  const threshold = Number(url.searchParams.get("threshold") ?? 365);
  if (!Number.isFinite(threshold) || threshold < 30 || threshold > 3650) {
    return NextResponse.json({ error: "threshold must be 30–3650 days" }, { status: 400 });
  }
  const level = (url.searchParams.get("level") ?? "track") as NostalgiaLevel;
  if (level !== "track" && level !== "artist") {
    return NextResponse.json({ error: "level must be track|artist" }, { status: 400 });
  }

  // Accept "YYYY" or "YYYY-MM"; normalize to month strings.
  const parseRange = (name: string, end: boolean): string | undefined => {
    const raw = url.searchParams.get(name)?.trim();
    if (!raw) return undefined;
    if (/^\d{4}$/.test(raw)) return `${raw}-${end ? "12" : "01"}`;
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
    return undefined;
  };
  const fromMonth = parseRange("from", false);
  const toMonth = parseRange("to", true);
  if (fromMonth && toMonth && fromMonth > toMonth) {
    return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
  }

  const excludeNoise = url.searchParams.get("noise") === "exclude";

  const bodyParam = url.searchParams.get("body") ?? "mercury";
  if (!getPhenomenon(bodyParam)) {
    return NextResponse.json(
      { error: "body must be mercury|venus|mars|fullmoon" },
      { status: 400 }
    );
  }

  const metricParam = url.searchParams.get("metric");
  const VALID_METRICS = ["nostalgia", "oldflame", "intensity", "nightowl", "discovery"];
  if (metricParam && !VALID_METRICS.includes(metricParam)) {
    return NextResponse.json({ error: `metric must be one of ${VALID_METRICS.join("|")}` }, { status: 400 });
  }

  const tzRaw = Number(url.searchParams.get("tzm") ?? 0);
  const tzOffsetMinutes = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 840 ? tzRaw : 0;

  const report = await buildReport(username, {
    thresholdDays: threshold,
    level,
    body: bodyParam as PhenomenonKey,
    metric: (metricParam as MetricKey | null) ?? undefined,
    tzOffsetMinutes,
    fromMonth,
    toMonth,
    excludeNoise,
  });
  if (!report) {
    return NextResponse.json({ error: "No scrobbles synced yet" }, { status: 404 });
  }
  return NextResponse.json(report);
}
