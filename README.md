<p align="center">
  <img src="public/retrospect-logo-tp.PNG" alt="Retrospect" width="120" />
</p>

<h1 align="center">Retrospect</h1>

<p align="center"><em>Your music taste vs. the actual sky. Entertainment with error bars.</em></p>

Retrospect turns your Last.fm history into a music horoscope backed by real math.
It cross-references every scrobble you've ever logged with real astronomical
events (Mercury, Venus, and Mars retrogrades, full moons, and eclipses, all
computed from planetary positions with [astronomy-engine](https://github.com/cosinekitty/astronomy))
and asks, honestly: does the sky change what you play?

Every claim survives a circular permutation test: your listening is re-measured
against thousands of scrambled event calendars, and an effect only counts when
chance can't fake it. Astrology is the question; statistics is the answer.

## What it does

- **Five skies on trial**: Mercury/Venus/Mars retrograde, full moons, eclipses,
  with real ephemeris windows and zodiac signs computed to the minute.
- **Five measures**, freely mixable: Nostalgia (old favorites), Old Flames
  (artist reunions), Intensity (listening volume), Night Owl (after-midnight
  plays), Discovery (first listens).
- **Plain-English verdicts**: "Does a full moon keep you up past midnight?
  No, just +2%." A grip meter instead of a p-value; the nerd numbers live in
  the skeptic's panel.
- **The 25-trial sweep**: scan every sky × measure combination and surface
  only convictions and leads.
- **Genres & the sky**: your top artists' tags become genre affinities per
  phenomenon ("your emo rises 30% under full moons"), plus rising genres and
  a personal forecast for upcoming events.
- **Listener fingerprints**: archetypes, golden hour, streaks, and rhythms
  computed from your data, interesting even when the sky is innocent.
- **Birth charts, in-browser**: sun, moon, and rising sign (ascendant validated
  against sunrise) computed client-side; birth data never touches a server.
- **Head-to-head**: two usernames, whose sky is stronger.
- Wrapped-style reveal, share cards, NASA's Astronomy Picture of the Day for
  your most nostalgic date, and a planetary loading screen where colliding
  planets explode.

## Run it locally

```bash
npm install
cp .env.example .env.local   # add your Last.fm API key (free: last.fm/api)
npm run dev
```

Open http://localhost:3000 and type a Last.fm username. The first sync of a
big library takes a few minutes (Last.fm rate limits); everything is cached in
`.data/` after that.

```bash
npm test             # analysis + store unit tests
npm run lint
npm run ephemeris    # regenerate retrograde/full-moon/eclipse windows
```

## Deploy (free tier, on purpose)

Retrospect is built to cost $0: Vercel Hobby for the app, Cloudflare R2 for
storage. R2 was chosen specifically because it has **zero egress fees**, so
the app's read-heavy access pattern can't generate a surprise bill, and
Vercel Hobby pauses rather than charges when limits are hit.

1. Create an R2 bucket (Cloudflare dashboard → R2 → Create bucket).
2. Create an R2 API token with read/write on that bucket; note the Account ID,
   Access Key ID, and Secret Access Key.
3. Import the repo into Vercel and set the environment variables below.
4. Deploy. Histories are stored as gzipped blobs (a 500k-scrobble library is
   ~7MB), so the 10GB free tier holds roughly a thousand heavy users.

| Variable | Required | Purpose |
|---|---|---|
| `LASTFM_API_KEY` | yes | Last.fm API access ([create one](https://www.last.fm/api/account/create)) |
| `R2_ACCOUNT_ID` | prod | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | prod | R2 API token key |
| `R2_SECRET_ACCESS_KEY` | prod | R2 API token secret |
| `R2_BUCKET` | prod | R2 bucket name |
| `NASA_API_KEY` | no | APOD card (DEMO_KEY fallback works) |
| `NEXT_PUBLIC_BASE_URL` | prod | Absolute URL for share cards |

Without the R2 variables, storage falls back to the local filesystem
(`.data/`), which is exactly right for development and self-hosting on a
normal server. Upgrading from an older checkout? Run
`node scripts/migrate-store.mjs` once to convert flat `.data` files to the
blob layout.

## How the math works

Scrobble timestamps are joined against precomputed event windows (see
`scripts/`), and each measure tags plays (old favorite? first listen?
after midnight?) or counts volume. The index is the tagged rate inside
windows over the rate outside. Significance comes from rotating the event
calendar to thousands of random offsets, which preserves both the calendar's
structure and your listening's autocorrelation, and asking how often chance
beats you. Rare-event measures get a "lead" tier for effects that are large
but unconfirmed. Sleep-noise artists (rain sounds, ASMR) can be excluded so
eight hours of Rolling Thunder doesn't drown your actual taste.

## Credits

Listening data from the [Last.fm API](https://www.last.fm/api); astronomy from
[astronomy-engine](https://github.com/cosinekitty/astronomy); space photos from
[NASA APOD](https://api.nasa.gov); UI atoms from
[@blakesteve/roster](https://www.npmjs.com/package/@blakesteve/roster).
Not affiliated with Last.fm. For entertainment purposes; the planets are not
responsible for your taste.

MIT © Blake Ball
