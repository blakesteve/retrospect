# Retrospect — Design Doc

*Does Mercury retrograde actually change what you listen to? Type your Last.fm username and find out — with a p-value.*

**Status:** Draft v1 · July 2026
**Stack:** Next.js (App Router) · TypeScript · Postgres (Supabase) · astronomy-engine

---

## 1. Concept

Retrospect joins a listener's complete Last.fm scrobble history against the real, computed positions of the planets. The v1 product is a single hero statistic — the **Mercury Retrograde Nostalgia Index** — wrapped in a natal-chart aesthetic and backed by honest statistics. Astrology says retrograde is when you revisit the past; Retrospect measures whether you actually do.

The tone is the product: it plays the horoscope completely straight in its visual language and copy, then shows its work like a physics paper. A horoscope that reports confidence intervals is the joke, and the joke is load-bearing.

Later features (moon-phase dashboard, sun-season sounds, the music natal chart wheel, Venus/Mars retrogrades) all reuse the same two ingredients — a cached scrobble store and a precomputed daily ephemeris — so v1's architecture is built for them even though v1 doesn't ship them.

## 2. The Nostalgia Index

### Definition

For a user with scrobbles `S`:

1. **First-listen time** — for each track key (`lowercase(artist) + " " + lowercase(title)`), the timestamp of the user's earliest scrobble of it.
2. **Nostalgic scrobble** — a scrobble whose track was first heard more than `T` ago (default `T = 365 days`, user-adjustable 90d–5y).
3. **Warm-up exclusion** — ignore the user's first `T` of history entirely; nothing can be nostalgic yet, and including it adds noise.
4. **Index** — `P(nostalgic | Mercury retrograde) / P(nostalgic | direct)`.

An index of 1.00 means the planets do nothing. 1.23 renders as "You revisit old music **23% more** when Mercury is retrograde."

### Statistical treatment

A naive comparison is confounded: retrogrades cluster unevenly across the calendar, and so does listening (holidays, life eras, library growth). We therefore report a **circular permutation test**: rotate the retrograde-window mask along the user's timeline by a uniform random offset (mod the history span), recompute the index, repeat ~2,000×. This preserves window count, durations, spacing, and the listening series' own autocorrelation. The two-tailed p-value is the fraction of rotations at least as extreme (in |log index|) as the observed value.

Three verdict states, all shareable:

* `p < 0.05, index > 1` — "The heavens have a measurable grip on you."
* `p < 0.05, index < 1` — "Reverse-cursed: you flee the past when Mercury turns."
* otherwise — "Mercury is innocent (p=0.61)."

**Skeptic mode** (a toggle, on by default for the stats panel): shows the permutation distribution as a histogram with the user's value marked, the n for each condition, and the threshold slider. This is a feature, not a footnote — the audience for this app appreciates being shown the null distribution.

### Edge cases

* **Short histories** (< ~2 years): too few retrograde windows for power. Show the index but badge it "insufficient data for a verdict" below a minimum-n threshold.
* **Artist-level nostalgia** — a second toggle: re-listen defined by artist first-heard rather than track. Looser, catches "returned to an old band via a new album" — arguably wrong, definitely interesting. Compute both; default to track.
* **Scrobble gaps** (user stopped scrobbling for years): handled naturally — rates are per-scrobble, not per-day; the rotation test rotates the mask, not the data.

## 3. Ephemeris

All sky math is `astronomy-engine` (MIT, ~100KB, no network). Retrograde detection: sample Mercury's geocentric ecliptic longitude daily (aberration-corrected), find apparent-motion sign changes via symmetric differences, bisect stations to the minute.

**Validated in the spike** (`scripts/retrograde-windows.mjs`): 2002–2026 yields **79 windows, avg 22.2 days, 3.16/year**, and the 2025–26 dates match published astronomical tables exactly (e.g. 2025: Mar 15–Apr 7, Jul 18–Aug 11, Nov 9–29). Runtime: 0.3s for the full 25-year scan.

Windows are identical for all users → computed at build time, shipped as static JSON (`data/mercury-retrogrades.json`), imported like any constant. No runtime ephemeris in v1. When the moon/seasons features land, the same build step emits a daily ephemeris table (~9k rows).

## 4. Architecture

```
Browser (Next.js app)
  │  types username → GET /api/user/:name/status
  ▼
Next.js API routes (Vercel)
  ├─ sync worker: walks Last.fm user.getRecentTracks (200/page, from=<cursor>)
  ├─ analysis: index + permutation test (pure fns, shared with spike scripts)
  └─ /api/og — Satori-rendered share card
  ▼
Postgres (Supabase) — scrobble cache + sync state
```

* **Fully server-computed.** The analysis is cheap (one pass + 2k rotations over tagged timestamps — sub-second for 100k scrobbles in Node). No web workers needed in v1; keep the pure analysis functions isomorphic anyway so a client-side fallback stays possible.
* **Last.fm key** lives server-side only. One shared key: Last.fm's informal budget (~5 req/s) is enforced by a token-bucket in the sync worker.
* **Long syncs vs serverless timeouts:** a first-time pull of a 200k-scrobble history is ~1,000 pages ≈ 4–5 min — longer than a Vercel function slot. The sync worker is therefore **resumable by design**: each invocation pulls pages for up to ~50s, advances the cursor in `sync_state`, and exits; the polling client's next `/status` call re-kicks it if unfinished. (Cleaner later: a small always-on worker or Supabase queue — don't build until it hurts.)

### Data model

```sql
create table scrobbles (
  username    text not null,
  uts         bigint not null,
  artist      text not null,
  track       text not null,
  primary key (username, uts, artist, track)   -- idempotent re-sync
);
create index on scrobbles (username, uts);

create table sync_state (
  username      text primary key,
  status        text not null,        -- 'syncing' | 'ready' | 'error'
  oldest_uts    bigint,               -- backfill cursor
  newest_uts    bigint,               -- incremental cursor
  total_pages   int,
  pages_done    int,
  updated_at    timestamptz not null default now()
);

create table results_cache (
  username      text,
  threshold_days int,
  level         text,                 -- 'track' | 'artist'
  index_value   double precision,
  p_value       double precision,
  retro_n       int, direct_n int,
  computed_uts  bigint,               -- newest scrobble included
  primary key (username, threshold_days, level)
);
```

Sync strategy: **backfill backwards** (newest → oldest) so partial results exist immediately — the UI streams "2024 analyzed… 2023 analyzed…" while older pages land. Incremental refresh uses `from=newest_uts`. Histories re-sync at most once per hour per user (guard in `sync_state.updated_at`).

### Privacy / ToS

Public profiles only (private ones simply return no data). A footer "remove my data" flow deletes a username's rows. Cache raw scrobbles no longer than needed; show attribution and link back to Last.fm per their API ToS.

## 5. UX

* **/** — one input, big type, natal-chart iconography. Recently computed public verdicts scroll by as social proof.
* **/u/[username]** — the report. Hero: the index as a huge number with the verdict line. Below: the two rates, the permutation histogram (skeptic mode), threshold slider and track/artist toggle (recompute server-side, cached per combination), and a timeline strip of the user's listening with retrograde bands overlaid.
* **Sync screen** is a designed moment: Mercury orbiting a retrograde loop as a progress meter, partial stats streaming in — "consulting the ephemeris" beats a spinner.
* **Share card** — `/api/og?u=…`: username, index, verdict, Mercury glyph, star-chart background. The URL *is* the share; OG image makes it unfurl everywhere.

Visual language: deep-sky navy, gold hairlines, engraved-almanac serif for display copy, tabular numerals for stats. (Run the dataviz pass when building the histogram/timeline.)

## 6. Build order

1. **Spike (done / in progress)** — `scripts/retrograde-windows.mjs` ✅ validated · `scripts/nostalgia-index.mjs` ready, needs `LASTFM_API_KEY` + username. **Gate: is the number interesting on real data?**
2. **Scaffold** — `create-next-app` (TS, App Router). Port spike fns to `lib/` as pure, tested modules (Vitest). No DB yet: JSON-file cache behind the same interface.
3. **Supabase** — *create the project here, not before.* Swap the cache interface to Postgres. Resumable sync worker + status polling.
4. **Report UI** — hero stat, verdict, skeptic panel, sync experience.
5. **Share card** — Satori OG route. This is launch.
6. **v1.x** — threshold slider server variants, artist-level toggle, Venus/Mars retrogrades ("do you replay music tied to exes?"), shadow-period analysis, then the moon dashboard and natal wheel as sibling pages.
7. **Natal charts (SHIPPED, client-side)** — birth date/time/UTC-offset/coords → sun, moon, rising (ascendant validated against sunrise), Mercury/Venus/Mars signs. Computed and stored entirely in the browser (localStorage); natal signs highlighted in the per-sign breakdown with a "personal resonance" comparison. Accounts remain future work only if cross-device sync is wanted.
8. **v2: genre & era astrology** — the Last.fm tag pipeline. Server route fetches `artist.getTopTags` for the user's top ~200 artists (one-time, cached in the store), mapping artists → genres. Then: (a) *genre affinity per phenomenon* — "your metal is immune to Mercury but your emo spikes 30% under full moons"; (b) *current-trends reading* — last 90 days' rising genres/artists cross-referenced against upcoming sky events ("Venus retrograde starts Friday; historically that's when your shoegaze comes back"); (c) *era fingerprints* — release-era of what you play (via album tags/dates where available) vs. sky state. Big feature; deserves its own round.

## 7. Open questions

* One shared Last.fm API key will eventually rate-limit under load — apply for a higher tier, or queue syncs globally? (Fine at friends-scale; revisit if it spreads.)
* Track identity is string-matched; remasters/features fragment keys ("Song (2011 Remaster)"). MusicBrainz IDs come in the payload when Last.fm has them — worth using as primary key with string fallback?
* Does the permutation test need stratification by year for users whose libraries grew 100× over time? (Rotation handles trend under the null, but check empirically against synthetic data in step 2.)
* Name/domain: **retrospect** is taken widely — `retrospect.fm`? `mercurymademe.do`?
