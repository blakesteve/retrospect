"use client";

import { useEffect, useState, type ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Spinner } from "@blakesteve/roster";
import { wantsSample } from "./sampleUrls";
import type { SampleHostProps } from "./SampleHost";

/* Where the landing's samples open (spec 8.1). The sheets, the listener
   views they reuse and the sample data all load on demand, so none of it
   weighs on the landing's first load (13): this module only watches the URL
   and, once it asks for a sheet, brings in the host. A tile hovered,
   focused or touched starts that download early. */

type Host = ComponentType<SampleHostProps>;
let hostLoad: Promise<Host> | null = null;

/** Start loading the sample sheets; safe to call any number of times. */
export function preloadSamples(): Promise<Host> {
  hostLoad ??= import("./SampleHost").then((m) => m.default);
  hostLoad.catch(() => (hostLoad = null));
  return hostLoad;
}

const INVALID = "That link points to something that isn't in this history.";

export function SampleMount() {
  const params = useSearchParams();
  const wanted = wantsSample(params);
  const [Host, setHost] = useState<Host | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [invalid, setInvalid] = useState(false);

  const loading = wanted && !Host && !failed;
  useEffect(() => {
    if (!wanted || Host) return;
    let live = true;
    preloadSamples().then(
      (h) => live && setHost(() => h),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [wanted, Host, attempt]);
  // A dimmed page and a spinner only if the sheets take a moment to arrive,
  // so a quick load doesn't flash.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 200);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [loading]);

  return (
    <>
      {/* An invalid sheet parameter opens nothing and says so (8.7); a sample
          that couldn't load says that (8.1). */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {invalid && !failed && <p className="mt-3 text-sm text-ink-2">{INVALID}</p>}
        {failed && wanted && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-ink">The sample didn&rsquo;t load.</p>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
      {loading && slow && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" style={{ background: "var(--roster-sheet-backdrop)", paddingBottom: 96 }}>
          <Spinner size="md" />
        </div>
      )}
      {Host && <Host onInvalid={() => setInvalid(true)} onValid={() => setInvalid(false)} />}
    </>
  );
}
