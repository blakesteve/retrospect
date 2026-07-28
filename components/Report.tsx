"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Checkbox, LiquidTabs, Spinner } from "@blakesteve/roster";
import type { Report as ReportData } from "@/lib/report";
import { PHENOMENA, PHENOMENON_KEYS, type PhenomenonKey } from "@/lib/ephemeris/phenomena";
import { METRICS, type MetricKey } from "@/lib/analysis/metrics";
import { GripMeter } from "./GripMeter";
import { BirthChartPanel } from "./BirthChartPanel";
import { GenresPanel } from "./GenresPanel";
import { SkyScan } from "./SkyScan";
import { ListeningProfile } from "./ListeningProfile";
import type { NatalChart } from "@/lib/astro/natal";
import { Histogram } from "./Histogram";
import { Timeline } from "./Timeline";
import { SyncScreen } from "./SyncScreen";
import { Apod } from "./Apod";
import { AlbumArt } from "./AlbumArt";
import { AstrologyCorner } from "./AstrologyCorner";
import { StoryIntro } from "./StoryIntro";

interface SyncStatus {
  status: "syncing" | "ready" | "error";
  pagesDone: number;
  totalPages: number;
  totalScrobbles: number;
  newestUts: number | null;
  oldestUts: number | null;
  error: string | null;
}

const fmtDate = (uts: number) =>
  new Date(uts * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short" });

/**
 * Verdict tiers: confirmed (survived the scramble test), a LEAD (big effect
 * that chance could still fake — usually rare-event metrics), or null.
 */
function verdictTier(r: ReportData): "confirmed" | "lead" | "null" | "unclear" {
  if (r.verdict.headline.includes("withhold") || !Number.isFinite(r.index)) return "unclear";
  if (r.verdict.significant) return "confirmed";
  const pct = Math.abs(r.index - 1) * 100;
  return pct >= 10 && r.p < 0.35 ? "lead" : "null";
}

/** Deterministic phrase variety: stable per trial, different across trials. */
function phraseSeed(r: ReportData): number {
  const s = `${r.username}|${r.body}|${r.metric}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
const pickPhrase = <T,>(seed: number, salt: number, arr: T[]): T =>
  arr[(seed + salt) % arr.length];

// The day string is already bucketed in the user's timezone server-side —
// render it verbatim (UTC formatting), never re-shifted by the browser.
const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

/** Ease the hero number up from 1.00. */
function useCountUp(target: number, duration = 1600): number {
  const [value, setValue] = useState(1);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(1 + (target - 1) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return Number.isFinite(target) ? value : NaN;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function Report({ username }: { username: string }) {
  const searchParams = useSearchParams();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [threshold, setThreshold] = useState(365);
  const [level, setLevel] = useState<"track" | "artist">("track");
  // Everything configurable up front arrives via the URL from the landing page.
  const [body, setBody] = useState<PhenomenonKey>(() => {
    const b = searchParams.get("body");
    return b && PHENOMENON_KEYS.includes(b as PhenomenonKey) ? (b as PhenomenonKey) : "mercury";
  });
  const [metricChoice, setMetricChoice] = useState<MetricKey | null>(() => {
    const m = searchParams.get("metric");
    return m && m in METRICS ? (m as MetricKey) : null;
  });
  const [natal, setNatal] = useState<NatalChart | null>(null);
  const [fromMonth, setFromMonth] = useState<string>(() => {
    const f = searchParams.get("from") ?? "";
    return MONTH_RE.test(f) ? f : "";
  });
  const [toMonth, setToMonth] = useState<string>(() => {
    const t = searchParams.get("to") ?? "";
    return MONTH_RE.test(t) ? t : "";
  });
  const [excludeNoise, setExcludeNoise] = useState(
    () => searchParams.get("noise") === "exclude"
  );
  const [showStory, setShowStory] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Poll /status — each poll also advances the sync one budgeted chunk.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/user/${encodeURIComponent(username)}/status`);
          if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
          const s: SyncStatus = await res.json();
          if (cancelled) return;
          setSync(s);
          if (s.status === "ready") return;
          if (s.status === "error") {
            setFatal(s.error ?? "Sync failed");
            return;
          }
        } catch (err) {
          if (cancelled) return;
          setFatal(err instanceof Error ? err.message : String(err));
          return;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [username]);

  const fetchReport = useCallback(
    async (
      t: number,
      l: string,
      b: PhenomenonKey,
      m: MetricKey | null,
      from: string,
      to: string,
      noNoise: boolean
    ) => {
      setRecomputing(true);
      try {
        const params = new URLSearchParams({
          threshold: String(t),
          level: l,
          body: b,
          metric: m ?? PHENOMENA[b].metric,
          tzm: String(-new Date().getTimezoneOffset()),
        });
        if (from) params.set("from", String(from));
        if (to) params.set("to", String(to));
        if (noNoise) params.set("noise", "exclude");
        const res = await fetch(
          `/api/user/${encodeURIComponent(username)}/report?${params}`
        );
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const data: ReportData = await res.json();
        if (alive.current) setReport(data);
      } catch (err) {
        if (alive.current) setFatal(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive.current) setRecomputing(false);
      }
    },
    [username]
  );

  useEffect(() => {
    if (sync?.status !== "ready") return;
    const id = setTimeout(
      () => fetchReport(threshold, level, body, metricChoice, fromMonth, toMonth, excludeNoise),
      0
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.status]);

  // Debounced refetch when any control changes.
  useEffect(() => {
    if (!report) return;
    const id = setTimeout(
      () => fetchReport(threshold, level, body, metricChoice, fromMonth, toMonth, excludeNoise),
      350
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, level, body, metricChoice, fromMonth, toMonth, excludeNoise]);

  // Switching phenomenon returns to its classic metric (but not on mount —
  // the URL may have delivered an explicit metric); switching either resets
  // the knob to that metric's default.
  const prevBody = useRef(body);
  useEffect(() => {
    if (prevBody.current !== body) {
      prevBody.current = body;
      setMetricChoice(null);
    }
  }, [body]);
  useEffect(() => {
    const slider = METRICS[metricChoice ?? PHENOMENA[body].metric].slider;
    if (slider) setThreshold(slider.default);
  }, [body, metricChoice]);

  const displayIndex = useCountUp(report?.index ?? NaN);

  if (fatal) {
    return (
      <div className="text-center py-24">
        <h1 className="font-display text-3xl text-gold mb-4">The stars are silent.</h1>
        <p className="text-ink-2">{fatal}</p>
        <p className="text-ink-3 text-sm mt-4">
          (Is the username right? Is the profile public? Is LASTFM_API_KEY set?)
        </p>
        <p className="text-ink-3 text-sm mt-2">
          If it was just Last.fm having a moment, refresh; syncs resume where they
          left off.
        </p>
      </div>
    );
  }

  if (!report) return <SyncScreen username={username} sync={sync} />;

  const r = report;
  const meta = PHENOMENA[r.body];
  const metric = METRICS[r.metric];
  const isShare = metric.kind === "share";

  if (showStory) {
    return <StoryIntro report={r} onDone={() => setShowStory(false)} />;
  }
  const pctMore = Math.round(Math.abs(r.index - 1) * 100);
  const oneInRetro = r.retroRate > 0 ? Math.round(1 / r.retroRate) : null;
  const oneInDirect = r.directRate > 0 ? Math.round(1 / r.directRate) : null;
  const fmtMonth = (m: string) =>
    new Date(m + "-15T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short" });
  const rangeLabel =
    r.fromMonth || r.toMonth
      ? `${r.fromMonth ? fmtMonth(r.fromMonth) : "the beginning"} – ${r.toMonth ? fmtMonth(r.toMonth) : "now"}`
      : null;

  return (
    <div className={recomputing ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {recomputing && (
        <div className="fixed inset-0 z-50 bg-[rgba(11,16,38,0.72)] backdrop-blur-[2px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 rounded-xl bg-surface-1 border border-[var(--hairline)] px-10 py-8 shadow-2xl">
            <Spinner variant="primary" size="lg" />
            <p className="font-display text-xl text-gold">Consulting the ephemeris&hellip;</p>
            <p className="text-ink-3 text-xs">re-running the trial with your new settings</p>
          </div>
        </div>
      )}
      {/* ---- Hero: a question and a plain answer ---- */}
      <header className="text-center mb-8 rise">
        <p className="text-ink-3 tracking-[0.3em] uppercase text-xs mb-3">
          {r.username}
          {rangeLabel && <> · {rangeLabel}</>}
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-ink mb-6 max-w-xl mx-auto leading-snug">
          {metric.question(meta.qSubject)}
        </h1>
        {(() => {
          const tier = verdictTier(r);
          const seed = phraseSeed(r);
          const d = Number.isFinite(r.index) ? Math.round((r.index - 1) * 100) : 0;
          const dStr = `${d > 0 ? "+" : ""}${d}%`;
          const beats = Number.isFinite(r.p) ? Math.round(r.p * r.iterations) : 0;

          const big =
            tier === "unclear"
              ? "Unclear."
              : tier === "confirmed"
                ? r.index > 1
                  ? pickPhrase(seed, 1, [`Yes, ${dStr}`, `Oh yes, ${dStr}`, `Confirmed: ${dStr}`])
                  : pickPhrase(seed, 2, [`Backwards, ${dStr}`, `Inverted: ${dStr}`])
                : tier === "lead"
                  ? pickPhrase(seed, 3, [`Maybe, ${dStr}`, `Hmm… ${dStr}`, `Possibly, ${dStr}`])
                  : d === 0
                    ? pickPhrase(seed, 4, ["No, dead flat.", "No, flatline.", "No, not a hair."])
                    : pickPhrase(seed, 5, [`No, just ${dStr}`, `Nah, ${dStr}`, `Not really, ${dStr}`]);

          const sub =
            tier === "confirmed"
              ? metric.plainTerms(meta.when, r.index > 1, pctMore)
              : tier === "unclear"
                ? r.verdict.detail
                : tier === "lead"
                  ? pickPhrase(seed, 6, [
                      `${dStr} is a real-looking lean, but your ${metric.tagNoun} are rare enough that chance faked a swing this size in ${beats.toLocaleString()} of ${r.iterations.toLocaleString()} scrambles. Not convicted. Definitely a suspect.`,
                      `A ${pctMore}% lean is worth raising an eyebrow at; chance matched it in ${beats.toLocaleString()} of ${r.iterations.toLocaleString()} scrambles, so no conviction yet. Keep the file open.`,
                      `${dStr} isn't nothing. It also isn't proof: ${beats.toLocaleString()} of ${r.iterations.toLocaleString()} shuffled calendars did the same. Call it a lead.`,
                    ])
                  : pickPhrase(seed, 7, [
                      `That ${pctMore}% drift is well inside what pure chance produces in your data. ${r.verdict.headline}`,
                      `Shuffle the calendar and swings like ${dStr} show up on their own, no planets required. ${r.verdict.headline}`,
                      `A library this size throws off ${pctMore}% blips constantly. ${r.verdict.headline}`,
                    ]);

          return (
            <>
              <div className="font-display text-6xl sm:text-7xl text-gold leading-none">{big}</div>
              <p className="text-ink-2 mt-5 max-w-lg mx-auto text-lg">{sub}</p>
              <div className="mt-5 flex flex-col items-center gap-2">
                <GripMeter
                  index={r.index}
                  significant={r.verdict.significant}
                  suggestive={tier === "lead"}
                />
                <p className="text-ink-3 text-xs">the sky&rsquo;s grip on this habit</p>
              </div>
              {tier === "lead" && (
                <p className="text-ink-3 text-sm mt-4 max-w-md mx-auto">
                  Sharpen the test: zoom into an era where it happened, or adjust the knobs
                  below; leads become convictions in focused slices.
                </p>
              )}
              {tier === "null" && (
                <p className="text-ink-3 text-sm mt-4 max-w-md mx-auto">
                  But something clearly runs your listening. Scroll down for your actual
                  fingerprints, or scan all 25 trials to hunt where the sky <em>does</em>{" "}
                  get a grip.
                </p>
              )}
            </>
          );
        })()}
        <p className="text-ink-3 text-xs mt-4 tabular opacity-70">
          for the record: index{" "}
          {Number.isFinite(displayIndex) ? displayIndex.toFixed(2) : "—"}&times;. The
          nerd numbers live in the skeptic&rsquo;s panel
        </p>
      </header>

      {/* ---- The lab: pick your phenomenon ---- */}
      <nav
        className="mb-12 rise flex flex-col items-center gap-2"
        style={{ "--rise-delay": "0.06s" } as React.CSSProperties}
        aria-label="Choose a sky phenomenon"
      >
        <p className="text-ink-3 text-xs uppercase tracking-[0.2em]">Put another sky on trial</p>
        <LiquidTabs
          tabs={PHENOMENON_KEYS.map((k) => ({
            id: k,
            label: `${PHENOMENA[k].glyph} ${PHENOMENA[k].title}`,
          }))}
          activeTab={body}
          onChange={(id) => setBody(id as PhenomenonKey)}
          variant="pill"
          className="max-w-full overflow-x-auto"
        />
        <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
          <span className="text-ink-3 text-xs mr-1">measuring:</span>
          {(Object.keys(METRICS) as MetricKey[]).map((k) => {
            const active = (metricChoice ?? PHENOMENA[body].metric) === k;
            const classic = PHENOMENA[body].metric === k;
            return (
              <Button
                key={k}
                size="xs"
                colorScheme="primary"
                variant={active ? "solid" : "ghost"}
                onClick={() => setMetricChoice(classic ? null : k)}
                aria-pressed={active}
              >
                {METRICS[k].name.replace(" Index", "")}
                {classic && " ✦"}
              </Button>
            );
          })}
        </div>
        <p className="text-ink-3 text-xs italic max-w-md text-center">
          {PHENOMENA[body].lore} (✦ = the classic pairing, but any sky can be tried on any
          measure)
        </p>
      </nav>

      {/* ---- The full sweep ---- */}
      <section
        className="mb-6 rise"
        style={{ "--rise-delay": "0.08s" } as React.CSSProperties}
      >
        <SkyScan
          username={username}
          excludeNoise={excludeNoise}
          onPick={(b, m) => {
            setBody(b);
            prevBody.current = b; // don't let the body-change effect clear the metric
            setMetricChoice(m);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </section>

      {/* ---- The guaranteed payoff: sky-independent fingerprints ---- */}
      <section
        className="mb-6 rise"
        style={{ "--rise-delay": "0.085s" } as React.CSSProperties}
      >
        <ListeningProfile username={username} excludeNoise={excludeNoise} />
      </section>

      {/* ---- Focus on an era ---- */}
      <section
        className="mb-12 rise rounded-lg bg-surface-1 border border-[var(--hairline)] p-5"
        style={{ "--rise-delay": "0.09s" } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-sm">
            <h3 className="text-ink text-sm font-medium mb-1">Focus on an era</h3>
            <p className="text-ink-3 text-xs leading-relaxed">
              Really going through it from May 2023 to the end of that year? Zoom the whole
              trial into just that stretch and ask whether something celestial was involved.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <input
              type="month"
              value={fromMonth}
              min={`${r.historyStartYear}-01`}
              max={toMonth || `${r.historyEndYear}-12`}
              onChange={(e) => setFromMonth(e.target.value)}
              aria-label="Era start month"
              className="rounded-md bg-surface-2 border border-[var(--hairline)] px-2 py-1.5 text-ink outline-none focus:border-gold"
            />
            <span className="text-ink-3">&ndash;</span>
            <input
              type="month"
              value={toMonth}
              min={fromMonth || `${r.historyStartYear}-01`}
              max={`${r.historyEndYear}-12`}
              onChange={(e) => setToMonth(e.target.value)}
              aria-label="Era end month"
              className="rounded-md bg-surface-2 border border-[var(--hairline)] px-2 py-1.5 text-ink outline-none focus:border-gold"
            />
            {(fromMonth || toMonth) && (
              <Button
                size="xs"
                variant="ghost"
                colorScheme="neutral"
                onClick={() => {
                  setFromMonth("");
                  setToMonth("");
                }}
              >
                all time
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ---- What we actually did ---- */}
      <section className="mb-12 rise" style={{ "--rise-delay": "0.12s" } as React.CSSProperties}>
        <h3 className="font-display text-xl text-gold mb-4">What just happened here?</h3>
        <ol className="grid sm:grid-cols-2 gap-4">
          <Step n={1} title="We read your listening diary.">
            All {r.scrobbleCount.toLocaleString()} songs you scrobbled
            {rangeLabel ? ` in ${rangeLabel}` : ` since ${fmtDate(r.firstScrobbleUts)}`},
            straight from Last.fm.
          </Step>
          <Step n={2} title="We asked the sky what it was doing.">
            {PHENOMENA[r.body].explainer} {r.windowCount} windows overlap your history. No
            horoscope column involved.
          </Step>
          <Step n={3} title={metric.defineTitle}>
            {metric.defineBody(r.thresholdDays)}
            {metric.slider && " (You can change this below.)"}
          </Step>
          <Step n={4} title="We compared, then tried to debunk ourselves.">
            Your {metric.tagNoun} inside the windows vs. the rest of the time. That ratio
            is your{" "}
            <strong className="text-ink">
              {Number.isFinite(r.index) ? r.index.toFixed(2) : "—"}&times;
            </strong>{" "}
            up top.
            Then we re-ran it {r.iterations.toLocaleString()}{" times "}with a scrambled
            event calendar to check it isn&rsquo;t dumb luck.
          </Step>
        </ol>
      </section>

      {/* ---- The two rates ---- */}
      <section
        className="grid sm:grid-cols-2 gap-4 mb-12 rise"
        style={{ "--rise-delay": "0.2s" } as React.CSSProperties}
      >
        <StatTile
          label={meta.tileLabel}
          value={isShare ? `${(r.retroRate * 100).toFixed(1)}%` : `${r.retroRate.toFixed(1)}/day`}
          sub={
            isShare
              ? oneInRetro
                ? `of your listening was ${metric.tagNoun}, about 1 in ${oneInRetro} of ${r.retroN.toLocaleString()} plays`
                : `of ${r.retroN.toLocaleString()} plays were ${metric.tagNoun}`
              : `${r.retroN.toLocaleString()} plays across all the windows`
          }
        />
        <StatTile
          label="The rest of the time"
          value={isShare ? `${(r.directRate * 100).toFixed(1)}%` : `${r.directRate.toFixed(1)}/day`}
          sub={
            isShare
              ? oneInDirect
                ? `of your listening was ${metric.tagNoun}, about 1 in ${oneInDirect} of ${r.directN.toLocaleString()} plays`
                : `of ${r.directN.toLocaleString()} plays were ${metric.tagNoun}`
              : `${r.directN.toLocaleString()} plays everywhere else`
          }
        />
      </section>

      {/* ---- Fun payoff ---- */}
      <section
        className="grid sm:grid-cols-2 gap-4 mb-12 rise"
        style={{ "--rise-delay": "0.28s" } as React.CSSProperties}
      >
        {r.retroAnthem && (
          <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
            <p className="text-ink-3 text-xs uppercase tracking-[0.2em] mb-3">
              {PHENOMENA[r.body].anthemLabel}
            </p>
            <AlbumArt
              artist={r.retroAnthem.artist}
              track={r.retroAnthem.track}
              alt={`Album art for ${r.retroAnthem.track} by ${r.retroAnthem.artist}`}
              className="w-full aspect-square"
            />
            <p className="font-display text-2xl text-ink leading-snug mt-4">
              {r.retroAnthem.track}
            </p>
            <p className="text-ink-2 mt-1">{r.retroAnthem.artist}</p>
            <p className="text-ink-3 text-xs mt-3">
              Played {r.retroAnthem.plays.toLocaleString()} times{" "}
              {PHENOMENA[r.body].when.replace(/^when /, "while ")}. The song you reach
              for when the sky gets weird.
            </p>
          </div>
        )}
        {r.mostNostalgicDay && (
          <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
            <p className="text-ink-3 text-xs uppercase tracking-[0.2em] mb-3">
              {metric.peakDayLabel}
            </p>
            <p className="font-display text-2xl text-ink leading-snug">
              {fmtDay(r.mostNostalgicDay.date)}
            </p>
            <p className="text-ink-3 text-xs mt-3">
              {metric.peakDayBody(r.mostNostalgicDay.count)}
            </p>
            <Apod
              date={r.mostNostalgicDay.date}
              caption="And while you were deep in the archives, the universe looked like this."
            />
          </div>
        )}
      </section>

      {/* ---- Genres × the sky ---- */}
      <section className="mb-12 rise" style={{ "--rise-delay": "0.3s" } as React.CSSProperties}>
        <GenresPanel username={username} body={r.body} />
      </section>

      {/* ---- Birth chart + astrology deep-dive ---- */}
      <section className="mb-4 rise" style={{ "--rise-delay": "0.3s" } as React.CSSProperties}>
        <BirthChartPanel onChart={setNatal} />
      </section>
      <section className="mb-12 rise" style={{ "--rise-delay": "0.32s" } as React.CSSProperties}>
        <AstrologyCorner
          bySign={r.bySign}
          eventNoun={r.body === "fullmoon" ? "full moons" : r.body === "eclipse" ? "eclipses" : "retrogrades"}
          natal={natal}
        />
      </section>

      {/* ---- Timeline ---- */}
      <section
        className="mb-12 rounded-lg bg-surface-1 border border-[var(--hairline)] p-5 rise"
        style={{ "--rise-delay": "0.36s" } as React.CSSProperties}
      >
        <h3 className="text-ink text-sm font-medium mb-1">
          Your {r.scrobbleCount.toLocaleString()} scrobbles, {fmtDate(r.firstScrobbleUts)}{" "}
          &ndash; {fmtDate(r.lastScrobbleUts)}
        </h3>
        <p className="text-ink-3 text-xs mb-4">
          Each bar is a year of listening. The thin ochre stripes are {PHENOMENA[r.body].title}{" "}
          periods. Notice how much of your life has happened inside them.
        </p>
        <Timeline
          yearly={r.yearlyCounts}
          windows={r.windows}
          firstUts={r.firstScrobbleUts}
          lastUts={r.lastScrobbleUts}
        />
      </section>

      {/* ---- Skeptic panel ---- */}
      <section
        className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5 rise"
        style={{ "--rise-delay": "0.44s" } as React.CSSProperties}
      >
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
          <h3 className="text-ink text-sm font-medium">The skeptic&rsquo;s panel</h3>
          <span className="text-xs text-ink-3 tabular">
            {Number.isFinite(r.p) ? (
              <>
                {Math.round(r.p * r.iterations).toLocaleString()} of{" "}
                {r.iterations.toLocaleString()} scrambled skies beat yours
                <span className="opacity-60"> (p={r.p < 0.001 ? "<0.001" : r.p.toFixed(3)})</span>
              </>
            ) : (
              "not enough data"
            )}
          </span>
        </div>
        <p className="text-ink-3 text-xs mb-4 max-w-xl leading-relaxed">
          Could your number be a coincidence? We scrambled the retrograde calendar{" "}
          {r.iterations.toLocaleString()} times and re-measured you against each fake sky.
          The indigo pile is what pure chance produces. The ochre line is the real you:{" "}
          {pctMore}% {r.index > 1 ? "more" : "fewer"} {metric.tagNoun}.{" "}
          <strong className="text-ink-2">
            Inside the pile = coincidence. Out on the edge = the sky has your number.
          </strong>
        </p>
        <Histogram samples={r.nullSamples} observed={r.index} />

        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-[var(--hairline)] pt-4">
          {metric.slider && (
            <label className="flex items-center gap-3 text-xs text-ink-2">
              {metric.slider.label}
              <input
                type="range"
                min={metric.slider.min}
                max={metric.slider.max}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-36 accent-[var(--gold)]"
              />
              <span className="tabular text-ink w-16">
                {threshold >= 365 ? `${(threshold / 365).toFixed(1)} yr` : `${threshold} d`}
              </span>
              ago
            </label>
          )}

          {metric.hasLevelToggle && (
            <div className="flex items-center gap-1 text-xs" role="group" aria-label="Nostalgia level">
              {(["track", "artist"] as const).map((l) => (
                <Button
                  key={l}
                  size="xs"
                  colorScheme="primary"
                  variant={level === l ? "solid" : "ghost"}
                  onClick={() => setLevel(l)}
                  aria-pressed={level === l}
                >
                  by {l}
                </Button>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <Checkbox checked={excludeNoise} onChange={setExcludeNoise} />
            🌧 ignore sleep &amp; noise tracks
            {r.noiseRemoved > 0 && (
              <span className="text-ink-3 tabular">
                (&minus;{r.noiseRemoved.toLocaleString()})
              </span>
            )}
          </label>

        </div>
        <p className="text-ink-3 text-xs mt-3">
          (However you slice it, &ldquo;first heard&rdquo; is always judged against your
          whole history; the era picker up top narrows the trial, not your memory.)
        </p>
      </section>

      <footer className="text-center text-xs text-ink-3 mt-10 leading-relaxed rise"
        style={{ "--rise-delay": "0.52s" } as React.CSSProperties}
      >
        Retrograde dates computed from real planetary positions (astronomy-engine) &middot;
        picture of the day courtesy of NASA &middot; entertainment with error bars &middot;{" "}
        <button className="underline hover:text-ink-2" onClick={() => setShowStory(true)}>
          ↺ replay the reveal
        </button>
      </footer>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5 flex gap-4">
      <span className="font-display text-3xl text-gold leading-none">{n}</span>
      <div>
        <p className="text-ink text-sm font-medium mb-1">{title}</p>
        <p className="text-ink-3 text-xs leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-surface-1 border border-[var(--hairline)] p-5">
      <p className="text-ink-3 text-xs mb-2">{label}</p>
      <p className="font-display text-4xl text-ink tabular">{value}</p>
      <p className="text-ink-3 text-xs mt-1 leading-relaxed">{sub}</p>
    </div>
  );
}

