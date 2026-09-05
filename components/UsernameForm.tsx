"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Checkbox, Disclosure, Input, Select } from "@blakesteve/roster";
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
      {/* `items-center` because Roster's Button pins its own height and will not
          stretch, so without it the pair is top-aligned and the button rides
          high. `size="lg"` on both is the height match: Roster 4.8.0 gave
          `Input` the same size scale as `Button`, and `lg` is `h-11` on each,
          so the two read as one control rather than two that happen to sit
          side by side. That, and `outline` reading `--roster-control-*`
          instead of hardcoding its own border and fill, is what let this stop
          being a raw element. */}
      <div className="flex w-full max-w-md items-center gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="your Last.fm username"
          aria-label="Last.fm username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          variant="outline"
          size="lg"
          className="flex-1"
          /* The one thing the tokens do not cover: `outline` hardcodes a gray
             placeholder, and this app's muted ink is a cooler blue. */
          inputClassName="placeholder:text-ink-3"
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
              /* `Select`'s trigger reads the same `--roster-control-*` tokens
                 as `Input`, but its dropdown panel does not — that one is still
                 hardcoded to Roster's grays, which this app remaps. Left alone,
                 the trigger would sit on `--surface-1` with a gold hairline and
                 the menu falling out of it on a different surface entirely.
                 So the tokens are reset to the grays the menu uses, locally,
                 until Roster's menu is themeable. That is the same gap that
                 keeps the UTC-offset field in `BirthChartPanel` a native
                 `<select>`. */
              triggerClassName="[--roster-control-bg:var(--roster-gray-800)] [--roster-control-border:var(--roster-gray-700)]"
              label="Sky on trial"
              value={body}
              onChange={(v) => setBody(v as PhenomenonKey)}
              options={PHENOMENON_KEYS.map((k) => ({
                value: k,
                label: `${PHENOMENA[k].glyph} ${PHENOMENA[k].title}`,
              }))}
            />
            <Select
              triggerClassName="[--roster-control-bg:var(--roster-gray-800)] [--roster-control-border:var(--roster-gray-700)]"
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
            <Input
              type="month"
              value={fromMonth}
              max={toMonth || undefined}
              onChange={(e) => setFromMonth(e.target.value)}
              aria-label="Era start month"
              variant="outline"
              size="sm"
              /* `Input`'s field wrapper is `w-full`, so in a flex row each one
                 takes a whole line unless told otherwise. */
              className="w-auto"
              inputClassName="text-xs"
            />
            <span className="text-ink-3">&ndash;</span>
            <Input
              type="month"
              value={toMonth}
              min={fromMonth || undefined}
              onChange={(e) => setToMonth(e.target.value)}
              aria-label="Era end month"
              variant="outline"
              size="sm"
              className="w-auto"
              inputClassName="text-xs"
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
