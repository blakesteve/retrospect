import { ImageResponse } from "next/og";
import { buildReport } from "@/lib/report";
import { getPhenomenon, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS } from "@/lib/analysis/metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/og?u=username&body=mercury
 *
 * The share card: paste a report link anywhere and this is what unfurls.
 * Computes the user's real verdict server-side (cache-warm after any visit).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = (url.searchParams.get("u") ?? "").trim().slice(0, 50);
  const bodyParam = url.searchParams.get("body") ?? "mercury";
  const phen = getPhenomenon(bodyParam) ?? getPhenomenon("mercury")!;
  const metric = METRICS[phen.metric];

  let index: string = "?.??";
  let headline = "Consult the ephemeris.";
  let sub = "Does the sky run your listening? Find out.";
  if (username) {
    try {
      const report = await buildReport(username, {
        thresholdDays: metric.slider?.default ?? 365,
        level: "track",
        body: phen.key,
        excludeNoise: true,
      });
      if (report && Number.isFinite(report.index)) {
        index = report.index.toFixed(2);
        headline = report.verdict.headline;
        sub = report.verdict.detail;
      }
    } catch {
      // fall through to the generic card
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0b1026",
          color: "#f2efe6",
          padding: 60,
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#83816f", letterSpacing: 8, textTransform: "uppercase" }}>
          {`The ${phen.title} ${metric.name} of`}
        </div>
        <div style={{ display: "flex", fontSize: 54, marginTop: 12 }}>{username || "Retrospect"}</div>
        <div style={{ display: "flex", fontSize: 160, color: "#d4af37", marginTop: 8 }}>
          {`${index}×`}
        </div>
        <div style={{ display: "flex", fontSize: 40, marginTop: 8, textAlign: "center" }}>{headline}</div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            marginTop: 10,
            color: "#b9b6ab",
            textAlign: "center",
            maxWidth: 900,
          }}
        >
          {sub}
        </div>
        <div style={{ display: "flex", fontSize: 22, marginTop: 34, color: "#83816f" }}>
          {`${phen.glyph}  retrospect · entertainment with error bars`}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
