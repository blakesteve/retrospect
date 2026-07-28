"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Checkbox, Disclosure, Select } from "@blakesteve/roster";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS, type MetricKey } from "@/lib/analysis/metrics";
import { BirthChartPanel } from "./BirthChartPanel";

/**
 * The front door: username + Consult, with the full reading configurable up
 * front — sky, measure, era, noise filter, and birth chart. Everything flows
 * into the report via the URL (birth data via localStorage, never the URL).
 */
export function UsernameForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState<PhenomenonKey>("mercury");
  const [metric, setMetric] = useState<"classic" | MetricKey>("classic");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [excludeNoise, setExcludeNoise] = useState(true);

  const monthCls =
    "rounded-md bg-surface-1 border border-[var(--hairline)] px-2 py-1.5 text-ink text-xs " +
    "outline-none focus:border-gold transition-colors";

  return (
    <form
      className="flex flex-col items-center w-full max-w-xl gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        const params = new URLSearchParams();
        if (body !== "mercury") params.set("body", body);
        if (metric !== "classic") params.set("metric", metric);
        if (fromMonth) params.set("from", fromMonth);
        if (toMonth) params.set("to", toMonth);
        if (excludeNoise) params.set("noise", "exclude");
        const q = params.toString();
        router.push(`/u/${encodeURIComponent(trimmed)}${q ? `?${q}` : ""}`);
      }}
    >
      <div className="flex w-full max-w-md gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="your Last.fm username"
          aria-label="Last.fm username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 rounded-md bg-surface-1 border border-[var(--hairline)] px-4 py-3
                     text-ink placeholder:text-ink-3 outline-none focus:border-gold transition-colors"
        />
        <Button type="submit" colorScheme="primary" variant="solid" size="lg">
          Consult
        </Button>
      </div>

      <Disclosure
        title="⚙ Configure your reading (optional)"
        className="w-full text-left"
      >
        <div className="flex flex-col gap-4 pt-2">
          <div className="grid sm:grid-cols-2 gap-3">
            <Select
              label="Sky on trial"
              value={body}
              onChange={(v) => setBody(v as PhenomenonKey)}
              options={PHENOMENON_KEYS.map((k) => ({
                value: k,
                label: `${PHENOMENA[k].glyph} ${PHENOMENA[k].title}`,
              }))}
            />
            <Select
              label="Measure"
              value={metric}
              onChange={(v) => setMetric(v as "classic" | MetricKey)}
              options={[
                {
                  value: "classic",
                  label: `✦ Classic pairing (${METRICS[PHENOMENA[body].metric].name})`,
                },
                ...(Object.keys(METRICS) as MetricKey[]).map((k) => ({
                  value: k,
                  label: METRICS[k].name,
                })),
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <span className="text-ink-3">Focus on an era (optional):</span>
            <input
              type="month"
              value={fromMonth}
              max={toMonth || undefined}
              onChange={(e) => setFromMonth(e.target.value)}
              aria-label="Era start month"
              className={monthCls}
            />
            <span className="text-ink-3">&ndash;</span>
            <input
              type="month"
              value={toMonth}
              min={fromMonth || undefined}
              onChange={(e) => setToMonth(e.target.value)}
              aria-label="Era end month"
              className={monthCls}
            />
            <span className="text-ink-3 italic">
              &ldquo;that stretch of 2023 when I was going through it&rdquo;
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <Checkbox checked={excludeNoise} onChange={setExcludeNoise} />
            🌧 ignore sleep &amp; noise tracks (rain sounds, white noise, ASMR)
          </label>

          <BirthChartPanel onChart={() => {}} />
        </div>
      </Disclosure>
    </form>
  );
}
